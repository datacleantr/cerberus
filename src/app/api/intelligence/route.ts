import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  productMasters,
  researchers,
  researchSessions,
  auditLogs,
  orders,
} from "@/db/schema";
import { count, desc, eq, sql } from "drizzle-orm";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { calculateLandedCostAndProfit, computeDecisionEngine } from "@/domain/decisionEngine";
import { buildMorningBriefing } from "@/domain/briefing";
import { computeRealizedRoi, computeRoiVariance } from "@/domain/realizedRoi";
import { computeResearcherScorecards } from "@/domain/researcherScorecard";
import { computeFreshness, summarizeFreshness } from "@/domain/dataFreshness";
import { parseBody, intelligenceCreateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";


export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Mağaza kapsamı sunucuda çözülür (F-11): STORE_USER kendi mağazasının
    // brifingini görür, yönetici seçtiği kapsamı görür.
    const { searchParams } = new URL(req.url);
    const effectiveStore = resolveStoreScope(currentUser, searchParams.get("storeCode") || "ALL");
    const storeFilter = effectiveStore !== "ALL" ? eq(orders.buyerStore, effectiveStore) : undefined;

    // T8.2 — Brifing artık sabit metinlerden değil, SQL aggregate'lerinden üretilir.
    // Satırlar belleğe çekilmez; maliyet veri hacminden bağımsızdır.
    const orderFactsQuery = db
      .select({
        totalOrders: count(),
        totalUnits: sql<string>`coalesce(sum(${orders.quantity}), 0)`,
        totalSpend: sql<string>`coalesce(sum(${orders.totalCost}), 0)`,
        totalShippedToAmazon: sql<string>`coalesce(sum(${orders.shippedToAmazon}), 0)`,
        totalRefunds: sql<string>`coalesce(sum(${orders.refundAmount}), 0)`,
        p1CancelTotal: sql<string>`coalesce(sum(${orders.p1CancelQty}), 0)`,
        p2MissingTotal: sql<string>`coalesce(sum(${orders.p2MissingQty}), 0)`,
        p3DefectiveTotal: sql<string>`coalesce(sum(${orders.p3DefectiveQty}), 0)`,
        p4ExpiredTotal: sql<string>`coalesce(sum(${orders.p4ExpiredQty}), 0)`,
        estimatedRevenue: sql<string>`coalesce(sum(${orders.sellingPrice} * ${orders.quantity}), 0)`,
        unbatchedOrders: sql<string>`count(*) filter (where ${orders.pshBatchNo} is null or ${orders.pshBatchNo} = '')`,
        inTransitOrders: sql<string>`count(*) filter (where ${orders.cargoStatus} = 'Yolda')`,
        problemOrdersCount: sql<string>`count(*) filter (where
          ${orders.cargoStatus} = 'İPTAL'
          or ${orders.p1CancelQty} > 0
          or ${orders.p2MissingQty} > 0
          or ${orders.p3DefectiveQty} > 0
          or ${orders.p4ExpiredQty} > 0
          or ${orders.refundAmount} > 0)`,
      })
      .from(orders);

    const masterFactsQuery = db
      .select({
        totalMasters: count(),
        avgRoi: sql<string>`coalesce(avg(${productMasters.roiPercent}), 0)`,
        duplicateAlerts: sql<string>`count(*) filter (where ${productMasters.duplicateScore} >= 80)`,
        pendingPolicyApprovals: sql<string>`count(*) filter (where ${productMasters.policyStatus} = 'REQUIRES_MANAGER_APPROVAL')`,
      })
      .from(productMasters);

    const [masters, team, sessions, [orderFacts], [masterFacts], decisionRows, realizedRows] =
      await Promise.all([
        db.select().from(productMasters).orderBy(desc(productMasters.discoveredAt)),
        db.select().from(researchers).orderBy(desc(researchers.researcherScore)),
        db.select().from(researchSessions).orderBy(desc(researchSessions.startedAt)),
        storeFilter ? orderFactsQuery.where(storeFilter) : orderFactsQuery,
        masterFactsQuery,
        db
          .select({ key: productMasters.decisionAction, n: count() })
          .from(productMasters)
          .groupBy(productMasters.decisionAction),
        // Tazelik artık kayıtlı metin alanından değil, observedAt damgasından
        // hesaplanır (aşağıda). Bu sorgu yalnızca ASIN bazlı gerçekleşen ROI
        // için sipariş gerçeklerini toplar.
        db
          .select({
            asin: orders.asin,
            quantity: orders.quantity,
            unitCost: orders.unitCost,
            sellingPrice: orders.sellingPrice,
            totalCost: orders.totalCost,
            shippedToAmazon: orders.shippedToAmazon,
            p1CancelQty: orders.p1CancelQty,
            p2MissingQty: orders.p2MissingQty,
            p3DefectiveQty: orders.p3DefectiveQty,
            p4ExpiredQty: orders.p4ExpiredQty,
            refundAmount: orders.refundAmount,
            cargoStatus: orders.cargoStatus,
          })
          .from(orders),
      ]);

    const toCounts = (rows: Array<{ key: string; n: number }>) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.key] = Number(r.n);
        return acc;
      }, {});

    const now = new Date();

    // --- Gerçekleşen ROI: ASIN bazında fiili siparişlerden hesaplanır ---
    // Sabit katsayıyla (roiPercent * 0.96) uydurma dönemi bitti.
    const rowsByAsin = new Map<string, typeof realizedRows>();
    for (const r of realizedRows) {
      const key = (r.asin || "").toUpperCase();
      if (!key) continue;
      const bucket = rowsByAsin.get(key);
      if (bucket) bucket.push(r);
      else rowsByAsin.set(key, [r]);
    }

    // Her ASIN için bir kez hesapla, hem ürün kartlarında hem araştırmacı
    // skor kartında yeniden kullan (çift hesap yok).
    const realizedRoiByAsin = new Map<string, ReturnType<typeof computeRealizedRoi>>();
    for (const [asinKey, rowsForAsin] of rowsByAsin) {
      realizedRoiByAsin.set(
        asinKey,
        computeRealizedRoi(
          rowsForAsin.map((r) => ({
            quantity: Number(r.quantity) || 0,
            unitCost: Number(r.unitCost) || 0,
            sellingPrice: Number(r.sellingPrice) || 0,
            totalCost: Number(r.totalCost) || 0,
            shippedToAmazon: Number(r.shippedToAmazon) || 0,
            p1CancelQty: Number(r.p1CancelQty) || 0,
            p2MissingQty: Number(r.p2MissingQty) || 0,
            p3DefectiveQty: Number(r.p3DefectiveQty) || 0,
            p4ExpiredQty: Number(r.p4ExpiredQty) || 0,
            refundAmount: Number(r.refundAmount) || 0,
            cargoStatus: r.cargoStatus || "",
          }))
        )
      );
    }

    const { getThresholds } = await import("@/lib/settings");
    const thresholds = await getThresholds();
    const enrichedMasters = masters.map((m) => {
      const asinKey = (m.asin || "").toUpperCase();
      const realized = realizedRoiByAsin.get(asinKey) ?? computeRealizedRoi([]);

      const variance = computeRoiVariance(Number(m.roiPercent), realized.realizedRoiPercent);

      // Kanıt şeffaflığı: skorun hangi kısmı ölçüm, hangi kısmı varsayım?
      // Saf hesap, ucuz; DB'de saklamak yerine her istekte türetilir.
      const engine = computeDecisionEngine(
        Number(m.roiPercent) || 0,
        m.sourceDomain || "",
        Number(m.duplicateScore) || 0,
        thresholds
      );
      const freshness = computeFreshness(m.observedAt, now);

      return {
        ...m,
        // Ölçülemiyorsa null kalır — arayüz "henüz ölçülmedi" gösterir.
        actualRoiPercent:
          realized.realizedRoiPercent === null
            ? null
            : realized.realizedRoiPercent.toFixed(2),
        realizedRoi: realized,
        roiVariance: variance,
        // Kayıtlı metni değil, hesaplanan tazeliği döndürüyoruz.
        dataFreshnessStatus: freshness.status,
        freshness,
        evidenceCoverage: engine.evidenceCoverage,
        assumedAxes: engine.assumedAxes,
        signals: engine.signals,
      };
    });

    // Sağlık skorunun tazelik ekseni artık canlı hesaptan beslenir.
    const freshnessCounts = summarizeFreshness(
      masters.map((m) => m.observedAt),
      now
    );

    const morningBriefing = buildMorningBriefing(
      {
        totalOrders: Number(orderFacts?.totalOrders || 0),
        totalUnits: Number(orderFacts?.totalUnits || 0),
        totalSpend: Number(orderFacts?.totalSpend || 0),
        totalShippedToAmazon: Number(orderFacts?.totalShippedToAmazon || 0),
        totalRefunds: Number(orderFacts?.totalRefunds || 0),
        problemOrdersCount: Number(orderFacts?.problemOrdersCount || 0),
        p1CancelTotal: Number(orderFacts?.p1CancelTotal || 0),
        p2MissingTotal: Number(orderFacts?.p2MissingTotal || 0),
        p3DefectiveTotal: Number(orderFacts?.p3DefectiveTotal || 0),
        p4ExpiredTotal: Number(orderFacts?.p4ExpiredTotal || 0),
        estimatedRevenue: Number(orderFacts?.estimatedRevenue || 0),
        unbatchedOrders: Number(orderFacts?.unbatchedOrders || 0),
        inTransitOrders: Number(orderFacts?.inTransitOrders || 0),
      },
      {
        totalMasters: Number(masterFacts?.totalMasters || 0),
        avgRoiPercent: Number(masterFacts?.avgRoi || 0),
        decisionCounts: toCounts(decisionRows),
        freshnessCounts,
        duplicateAlerts: Number(masterFacts?.duplicateAlerts || 0),
        pendingPolicyApprovals: Number(masterFacts?.pendingPolicyApprovals || 0),
      }
    );

    // T.Faz1 — araştırmacı skor kartı artık seed sabitlerinden değil,
    // gerçek product_masters + sipariş verisinden hesaplanır (bkz.
    // src/domain/researcherScorecard.ts).
    const researcherScorecards = computeResearcherScorecards(
      team.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        specialtyDomain: r.specialtyDomain,
        avatar: r.avatar,
      })),
      masters.map((m) => ({
        researcherCode: m.researcherCode,
        asin: m.asin,
        decisionAction: m.decisionAction,
      })),
      realizedRoiByAsin
    );

    return NextResponse.json({
      storeScope: effectiveStore,
      productMasters: enrichedMasters,
      researchers: researcherScorecards,
      researchSessions: sessions,
      morningBriefing,
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/intelligence", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, intelligenceCreateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const {
      sourceUrl,
      title,
      brand = "GENERIC BRAND",
      category = "General Retail",
      upc = "000000000000",
      asin = "B0" + Math.random().toString(36).substring(2, 10).toUpperCase(),
      sourcePrice = 45,
      sellingPrice = 79.99,
      prepCost = 1.35,
      researcherName = "Ahmet Kaya (SRC-01)",
      supplierName = "US Sourcing Vendor",
      notes = "",
    } = body;

    let sourceDomain = "us-retail.com";
    try {
      if (sourceUrl) {
        const u = new URL(sourceUrl);
        sourceDomain = u.hostname.replace("www.", "");
      }
    } catch {
      // fallback
    }

    const existingMasters = await db.select().from(productMasters);
    let duplicateScore = 12;
    let duplicateStatus = "CLEAR";
    for (const item of existingMasters) {
      if (
        (upc && upc.length > 5 && item.upc === upc) ||
        (asin && item.asin.toUpperCase() === asin.toUpperCase()) ||
        (sourceUrl && item.sourceUrl === sourceUrl)
      ) {
        duplicateScore = 96;
        duplicateStatus = "EXACT_DUPLICATE";
        break;
      }
    }

    const numericSourcePrice = Number(sourcePrice) || 1;
    const numericSellingPrice = Number(sellingPrice) || numericSourcePrice * 1.6;

    const landed = calculateLandedCostAndProfit(
      numericSourcePrice,
      numericSellingPrice,
      Number(prepCost) || 1.35
    );

    const { getThresholds: getThresholdsPost } = await import("@/lib/settings");
    const thresholdsPost = await getThresholdsPost();
    const radar = computeDecisionEngine(landed.roiPercent, sourceDomain, duplicateScore, thresholdsPost);
    const productCode = `CRB-2026-${Math.floor(9055 + Math.random() * 900)}`;

    const [inserted] = await db
      .insert(productMasters)
      .values({
        productCode,
        title,
        brand: brand.toUpperCase(),
        category,
        upc,
        asin: asin.toUpperCase(),
        msku: `${brand.slice(0, 3).toUpperCase()}-${Math.floor(100 + Math.random() * 899)}`,
        sourceUrl: sourceUrl || "https://www.homedepot.com",
        sourceDomain,
        supplierName,
        researcherCode: researcherName.includes("(")
          ? researcherName.split("(")[1].replace(")", "")
          : "SRC-01",
        researcherName,
        lifecycleStage: duplicateStatus === "EXACT_DUPLICATE" ? "DUPLICATE_CHECK" : "APPROVED",
        dataQualityStatus: duplicateStatus === "EXACT_DUPLICATE" ? "CONFLICTING" : "VALID",
        // Tazelik elle "FRESH" ilan edilmez; observedAt'ten hesaplanır.
        // Yeni kayıt için yaş 0 gündür, dolayısıyla doğal olarak FRESH çıkar.
        dataFreshnessStatus: computeFreshness(new Date()).status,
        observedAt: new Date(),
        decisionAction: radar.decisionAction,
        confidenceScore: radar.confidenceScore,
        riskLevel: radar.riskLevel,
        policyStatus: radar.policyStatus,
        sourcePrice: numericSourcePrice.toFixed(2),
        prepCost: Number(prepCost).toFixed(2),
        marketplaceFee: landed.marketplaceFee.toFixed(2),
        fulfillmentFee: landed.fulfillmentFee.toFixed(2),
        landedCost: landed.landedCost.toFixed(2),
        sellingPrice: numericSellingPrice.toFixed(2),
        estimatedNetProfit: landed.estimatedNetProfit.toFixed(2),
        roiPercent: landed.roiPercent.toFixed(2),
        // Gerçekleşen ROI burada UYDURULMAZ. Ürün henüz satılmadığı için
        // ölçülecek veri yoktur; null kalır ve ilk sevkiyat kapandığında
        // computeRealizedRoi() ile gerçek siparişlerden hesaplanır.
        actualRoiPercent: null,
        duplicateScore,
        duplicateStatus,
        profitabilityScore: radar.profitabilityScore,
        demandScore: radar.demandScore,
        competitionScore: radar.competitionScore,
        priceStabilityScore: radar.priceStabilityScore,
        supplierRiskScore: radar.supplierRiskScore,
        operationalRiskScore: radar.operationalRiskScore,
        opportunityScore: radar.opportunityScore,
        evidenceChain: [
          {
            claim: `Landed Cost $${landed.landedCost} ve %${landed.roiPercent} tahmini net ROI ile Decision Engine önerisi: ${radar.decisionAction}`,
            source: `${sourceDomain} Sourcing Feed`,
            observedAt: new Date().toISOString(),
            confidence: `${radar.confidenceScore}%`,
          },
        ],
        channelListings: [
          {
            storeCode: "HRN",
            storeName: "HRN Amazon US Storefront",
            price: numericSellingPrice,
            status: "ACTIVE",
            stock: 45,
          },
        ],
        costHistory: [
          {
            date: new Date().toISOString().split("T")[0],
            sourcePrice: numericSourcePrice,
            landedCost: landed.landedCost,
            sellingPrice: numericSellingPrice,
            roi: landed.roiPercent,
          },
        ],
        notes,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: currentUser.storeCode === "ALL" ? "HRN" : currentUser.storeCode,
      actionType: "DECISION_ENGINE_CAPTURE",
      targetEntity: `${productCode} (${title.slice(0, 32)})`,
      beforeState: "NEW_CAPTURE",
      afterState: `${radar.decisionAction} (${radar.confidenceScore}% Conf)`,
      details: `Decision Engine kararı: ${radar.decisionAction}. ROI: %${landed.roiPercent}, Dup Score: %${duplicateScore}`,
    });

    return NextResponse.json({
      message: `Product Master oluşturuldu. Decision Engine Kararı: ${radar.decisionAction}`,
      master: inserted,
    });
  } catch (error: unknown) {
    return handleRouteError("POST /api/intelligence", error);
  }
}
