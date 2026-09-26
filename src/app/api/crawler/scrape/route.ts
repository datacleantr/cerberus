import { NextResponse } from "next/server";
import { db } from "@/db";
import { scrapeJobs, scrapedProducts } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { parseBody, crawlerScrapeSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { scrapeUrl } from "@/lib/crawler/scraper";
import { desc, eq, and, gte, inArray } from "drizzle-orm";

/**
 * POST /api/crawler/scrape — URL'i çek, ürünleri çıkar, DB'ye yaz
 * Cache: aynı URL 6 saat içinde tekrar tarandıysa DB'den dön (kotayı korur)
 */
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const parsed = await parseBody(req, crawlerScrapeSchema);
    if ("response" in parsed) return parsed.response;
    const { url, storeCode: requestedStore } = parsed.data;
    const storeCode = resolveStoreScope(user, requestedStore || "HRN");

    // Basit rate-limit: IP başına 10/dk (bellek içi, Vercel'de prod'da Redis gerekir — şimdilik DB ile)
    // Burada yalnızca DB cache kontrolü yapıyoruz; gerçek rate limit faz 2
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recent = await db
      .select()
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.sourceUrl, url),
          eq(scrapeJobs.storeCode, storeCode),
          gte(scrapeJobs.createdAt, sixHoursAgo)
        )
      )
      .orderBy(desc(scrapeJobs.createdAt))
      .limit(1);

    if (recent.length && recent[0].status === "DONE") {
      const cached = await db.select().from(scrapedProducts).where(eq(scrapedProducts.jobId, recent[0].id));
      return NextResponse.json({
        jobId: recent[0].id,
        sourceUrl: recent[0].sourceUrl,
        sourceDomain: recent[0].sourceDomain,
        products: cached,
        warnings: ["Bu URL 6 saat içinde taranmıştı — önbellekten döndü."],
        cached: true,
        fetchedAt: recent[0].completedAt?.toISOString() || new Date().toISOString(),
        isListingPage: cached.length > 3,
      });
    }

    // DB tabanlı sayaç serverless instance'lar arasında da çalışır. Cache hit'leri
    // outbound istek üretmediği için limite dahil edilmez.
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentAttempts = await db
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.createdBy, user.email),
          gte(scrapeJobs.createdAt, oneMinuteAgo)
        )
      )
      .limit(5);
    if (recentAttempts.length >= 5) {
      return NextResponse.json(
        { error: "Crawler hız sınırı aşıldı. Bir dakika sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Yeni iş kaydı
    const normalizedDomain = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
    })();

    const [job] = await db.insert(scrapeJobs).values({
      sourceUrl: url,
      sourceDomain: normalizedDomain,
      storeCode,
      status: "PENDING",
      // E-posta oturumun benzersiz kimliğidir; görünen adlar çakışabilir.
      createdBy: user.email,
    }).returning();

    try {
      const result = await scrapeUrl(url);
      const now = new Date();

      // Fiyat geçmişi: her taramada yeni satır açmak yerine GTIN bazlı mevcut
      // kaydı güncelle. "İndirimi erken görmek" ancak kesintisiz seri varsa
      // çalışır; her taramada ayrı satır açmak geçmişi parçalar ve
      // indirim anını kaybettirir.
      const gtins = result.products.map((p) => p.gtin).filter((g): g is string => Boolean(g));
      const existing = gtins.length
        ? await db
            .select()
            .from(scrapedProducts)
            .where(and(inArray(scrapedProducts.gtin, gtins), eq(scrapedProducts.sourceDomain, result.sourceDomain)))
        : [];

      const byGtin = new Map(existing.map((row) => [row.gtin as string, row]));

      const toInsert: (typeof scrapedProducts.$inferInsert)[] = [];
      const toUpdate: Array<{
        id: number;
        patch: Partial<typeof scrapedProducts.$inferInsert>;
        priceDrop: { title: string; from: string; to: string; pct: number } | null;
      }> = [];

      for (const p of result.products) {
        const price = p.price !== null ? p.price.toFixed(2) : null;
        const prior = p.gtin ? byGtin.get(p.gtin) : undefined;

        if (prior) {
          // Kesintisiz seri kuralı: fiyat baseline'ın altına inerse indirim
          // anı bir kez kaydedilir; baseline'ın üstine çıkılırsa seri sıfırlanır.
          const priorBaseline = prior.baselinePrice !== null ? Number(prior.baselinePrice) : null;
          const nextBaseline =
            priorBaseline === null ? p.price : p.price !== null && p.price > priorBaseline ? p.price : priorBaseline;

          const belowBaseline =
            nextBaseline !== null && p.price !== null && p.price < nextBaseline ? nextBaseline : null;

          const patch: Partial<typeof scrapedProducts.$inferInsert> = {
            sourceUrl: p.sourceUrl,
            title: p.title,
            brand: p.brand,
            price,
            currency: p.currency,
            imageUrl: p.imageUrl,
            availability: p.availability,
            asinCandidate: p.asinCandidate,
            sourceSku: p.sourceSku,
            mpn: p.mpn,
            baselinePrice: nextBaseline !== null ? nextBaseline.toFixed(2) : null,
            baselineAt: priorBaseline === null ? (p.price !== null ? now : prior.baselineAt) : prior.baselineAt,
            firstBelowBaselineAt: belowBaseline !== null ? (prior.firstBelowBaselineAt ?? now) : prior.firstBelowBaselineAt,
            lastPriceChangeAt: prior.price !== null && price !== null && Number(prior.price) !== p.price ? now : prior.lastPriceChangeAt,
          };

          toUpdate.push({
            id: prior.id,
            patch,
            priceDrop:
              belowBaseline !== null && prior.price !== null && Number(prior.price) !== p.price
                ? {
                    title: p.title,
                    from: Number(prior.price).toFixed(2),
                    to: p.price!.toFixed(2),
                    pct: Math.round(((Number(prior.price) - p.price!) / Number(prior.price)) * 100),
                  }
                : null,
          });
        } else {
          toInsert.push({
            jobId: job.id,
            sourceUrl: p.sourceUrl,
            sourceDomain: p.sourceDomain,
            title: p.title,
            brand: p.brand,
            price,
            currency: p.currency,
            imageUrl: p.imageUrl,
            availability: p.availability,
            asinCandidate: p.asinCandidate,
            sourceSku: p.sourceSku,
            gtin: p.gtin,
            mpn: p.mpn,
            // İlk gözlem kesintisiz serinin başıdır; sonradan düşerse
            // firstBelowBaselineAt dolar.
            baselinePrice: p.price !== null ? p.price.toFixed(2) : null,
            baselineAt: p.price !== null ? now : null,
            lastPriceChangeAt: now,
            status: "PENDING",
          });
        }
      }

      if (toInsert.length) {
        // Aynı GTIN bu tarama içinde iki kez geçerse ikincisi elenir.
        const seenGtin = new Set<string>();
        for (const row of toInsert) {
          if (row.gtin) {
            if (seenGtin.has(row.gtin)) continue;
            seenGtin.add(row.gtin);
          }
        }
        const deduped = toInsert.filter((row, i) => {
          if (!row.gtin) return true;
          return toInsert.findIndex((r) => r.gtin === row.gtin) === i;
        });
        await db.insert(scrapedProducts).values(deduped);
      }

      const priceDrops: Array<{ title: string; from: string; to: string; pct: number }> = [];
      for (const update of toUpdate) {
        await db.update(scrapedProducts).set(update.patch).where(eq(scrapedProducts.id, update.id));
        if (update.priceDrop) priceDrops.push(update.priceDrop);
      }

      // Sonuçları okuma: güncellenen + yeni.
      const allGtin = result.products.map((p) => p.gtin).filter((g): g is string => Boolean(g));
      const rows = allGtin.length
        ? await db
            .select()
            .from(scrapedProducts)
            .where(and(inArray(scrapedProducts.gtin, allGtin), eq(scrapedProducts.sourceDomain, result.sourceDomain)))
        : [];

      const inserted = rows;

      await db.update(scrapeJobs).set({
        status: "DONE",
        productCount: inserted.length,
        completedAt: now,
      }).where(eq(scrapeJobs.id, job.id));

      const warnings = [...result.warnings];
      if (priceDrops.length) {
        warnings.unshift(
          `🔻 ${priceDrops.length} üründe fiyat düştü: ` +
            priceDrops
              .slice(0, 3)
              .map((d) => `${d.title.slice(0, 40)} $${d.from}→$${d.to} (%${d.pct})`)
              .join(", ") +
            (priceDrops.length > 3 ? ` +${priceDrops.length - 3} tane daha` : "")
        );
      }

      // Audit
      const { auditLogs } = await import("@/db/schema");
      await db.insert(auditLogs).values({
        actorName: user.name,
        storeCode,
        actionType: "CRAWL_CAPTURE",
        targetEntity: `${normalizedDomain} (${inserted.length} ürün)`,
        beforeState: url,
        afterState: "SCRAPED",
        details: `Crawler: ${url} → ${inserted.length} ürün, ${priceDrops.length} fiyat düşüşü, ${warnings.length} uyarı`,
      });

      return NextResponse.json({
        jobId: job.id,
        sourceUrl: result.sourceUrl,
        sourceDomain: result.sourceDomain,
        products: inserted,
        warnings,
        priceDrops,
        engine: result.engine,
        blockedBy: result.blockedBy,
        cached: false,
        fetchedAt: result.fetchedAt,
        isListingPage: result.isListingPage,
      });
    } catch (scrapeErr: unknown) {
      const typedError = scrapeErr as Error & { status?: number; blockedBy?: string };
      const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
      await db.update(scrapeJobs).set({ status: "FAILED", error: msg.slice(0, 1000), completedAt: new Date() }).where(eq(scrapeJobs.id, job.id));
      const status =
        typedError.status ??
        (msg.includes("taranamadı") || msg.includes("çıkarılamadı") ? 422 : 502);
      return NextResponse.json(
        { error: msg, jobId: job.id, blockedBy: typedError.blockedBy ?? null },
        { status }
      );
    }
  } catch (error: unknown) {
    return handleRouteError("POST /api/crawler/scrape", error);
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;
    const { searchParams } = new URL(req.url);
    const requestedStore = searchParams.get("storeCode") || "ALL";
    const effectiveStore = resolveStoreScope(user, requestedStore);
    const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 10));

    const where = effectiveStore !== "ALL" ? eq(scrapeJobs.storeCode, effectiveStore) : undefined;
    const jobs = where
      ? await db.select().from(scrapeJobs).where(where).orderBy(desc(scrapeJobs.createdAt)).limit(limit)
      : await db.select().from(scrapeJobs).orderBy(desc(scrapeJobs.createdAt)).limit(limit);

    // Her job için ürün count zaten var, ama detay da lazım olabilir
    const jobIds = jobs.map((j) => j.id);
    const products = jobIds.length
      ? await db.select().from(scrapedProducts).where(eq(scrapedProducts.jobId, jobIds[0]))
      : [];

    return NextResponse.json({ storeScope: effectiveStore, jobs, recentProducts: products });
  } catch (error: unknown) {
    return handleRouteError("GET /api/crawler/scrape", error);
  }
}
