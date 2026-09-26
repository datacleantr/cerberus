import { NextResponse } from "next/server";
import { db } from "@/db";
import { scrapedProducts, products, supplierOffers, auditLogs, productLifecycleEvents } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { parseBody, crawlerImportSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { inArray, eq } from "drizzle-orm";

/**
 * POST /api/crawler/import — seçilen scraped ürünleri sisteme aktar
 * Her ürün: products + supplierOffers + lifecycle event oluşturur
 */
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const parsed = await parseBody(req, crawlerImportSchema);
    if ("response" in parsed) return parsed.response;
    const { scrapedIds, storeCode: requestedStore } = parsed.data;
    const storeCode = resolveStoreScope(user, requestedStore || "HRN");

    const rows = await db.select().from(scrapedProducts).where(inArray(scrapedProducts.id, scrapedIds));
    if (!rows.length) return NextResponse.json({ error: "Seçilen ürünler bulunamadı." }, { status: 404 });

    const pending = rows.filter((r) => r.status === "PENDING");
    if (!pending.length) return NextResponse.json({ error: "Seçilen ürünlerin hepsi zaten aktarıldı veya reddedildi." }, { status: 409 });

    const results: Array<{ scrapedId: number; productId: number; asin: string; title: string }> = [];
    const warnings: string[] = [];

    for (const sp of pending) {
      // Ürün kimliği önceliği: gerçek ASIN > GTIN ile mevcut ürün > yeni kayıt.
      //
      // ASIN YALNIZ Amazon kaynaklı URL'den kabul edilir. Perakende slug'ı
      // ("omega-3-fish-oil" → "OMEGA3FIS") ASIN DEĞİLDİR; 10 karakterli her
      // slug bu yüzden ürün kataloğunda sahte ASIN olarak yazılıyordu.
      const realAsin = sp.asinCandidate && /^[A-Z0-9]{10}$/.test(sp.asinCandidate) ? sp.asinCandidate : null;

      // GTIN varsa: daha önce bu fiziksel ürünü Amazon tarafında eşleştirdi miyiz?
      // `product_source_keys` benzeri bir tablo yerine, mevcut üründe saklanan
      // `supplier_offers` üzerinden GTIN geçmişi aranır.
      let matchedProductId: number | null = null;
      if (realAsin) {
        const byAsin = await db.select().from(products).where(eq(products.asin, realAsin)).limit(1);
        if (byAsin.length) matchedProductId = byAsin[0].id;
      }
      if (matchedProductId === null && sp.gtin) {
        // GTIN → ürün eşleştirmesi. `products.upc` alanı bu iş için zaten var
        // (Amazon katalogundaki `gtin` ile aynı fiziksel ürünü gösterir) ve
        // `api/intelligence` UPC üzerinden eşleştirme yapıyor.
        const byGtin = await db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.upc, sp.gtin))
          .limit(1);
        if (byGtin.length) matchedProductId = byGtin[0].id;
      }

      let productId: number;
      if (matchedProductId !== null) {
        productId = matchedProductId;
        warnings.push(
          `${sp.title.slice(0, 40)} — mevcut ürüne bağlandı${realAsin ? ` (ASIN ${realAsin})` : ` (GTIN ${sp.gtin})`}, fiyat gözlemi eklendi.`
        );
      } else {
        const asin = realAsin ?? `SC${String(sp.id).padStart(8, "0")}`;
        if (!realAsin) {
          warnings.push(
            `${sp.title.slice(0, 40)} — kaynak site perakende olduğu için ASIN bulunamadı; geçici kimlik (${asin}) atandı. GTIN ile Amazon eşleştirmesi yapılmalı.`
          );
        }
        const [created] = await db.insert(products).values({
          asin,
          title: sp.title,
          brand: sp.brand || "General",
          category: "UNCATEGORIZED",
          imageUrl: sp.imageUrl,
          amazonUrl: sp.sourceUrl,
          // GTIN varsa `upc` alanına yazılır: aynı fiziksel ürünün Amazon
          // katalogundaki kalıcı kimliği budur. GTIN yoksa NULL kalır ve
          // eşleştirme yapılamaz — bu bilerek sessizce uydurulmaz.
          upc: sp.gtin,
          lifecycleStage: "DISCOVERED",
          isActive: true,
        }).returning();
        productId = created.id;
        await db.insert(productLifecycleEvents).values({
          productId,
          fromStage: null,
          toStage: "DISCOVERED",
          actorName: user.name,
          reason: `Crawler: ${sp.sourceDomain} keşfi`,
          contextSnapshot: {
            sourceUrl: sp.sourceUrl,
            price: sp.price,
            storeCode,
            gtin: sp.gtin,
            sourceSku: sp.sourceSku,
          },
        });
      }

      // Fiyat gözlemi
      if (sp.price !== null) {
        await db.insert(supplierOffers).values({
          productId,
          supplierName: sp.brand || sp.sourceDomain,
          sourceUrl: sp.sourceUrl,
          sourceDomain: sp.sourceDomain,
          unitPrice: Number(sp.price).toFixed(2),
          currency: sp.currency || "USD",
          inStock: sp.availability === "IN_STOCK",
          sourceType: "SCRAPER",
        });
      }

      await db.update(scrapedProducts).set({ status: "IMPORTED" }).where(eq(scrapedProducts.id, sp.id));
      const [product] = await db
        .select({ asin: products.asin })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      results.push({ scrapedId: sp.id, productId, asin: product?.asin ?? "", title: sp.title });
    }

    await db.insert(auditLogs).values({
      actorName: user.name,
      storeCode,
      actionType: "CRAWL_IMPORT",
      targetEntity: `${results.length} ürün aktarıldı`,
      beforeState: `scrapedIds: ${scrapedIds.join(",")}`,
      afterState: "IMPORTED",
      details: `${results.length} crawler ürünü ürün kataloğuna aktarıldı.`,
    });

    return NextResponse.json({ imported: results.length, results, warnings });
  } catch (error: unknown) {
    return handleRouteError("POST /api/crawler/import", error);
  }
}
