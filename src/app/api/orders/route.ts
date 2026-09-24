import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, stores, pshBatches, auditLogs, users } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { resolveProduct, normalizeAsin } from "@/db/resolveProduct";
import { parseBody, orderCreateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { maskOrderForRole, minimizeUsersForRole } from "@/lib/privacy";
import { evaluatePurchaseApproval } from "@/domain/purchaseApproval";
import { desc, eq, and, inArray, count, sql, ilike, or, type SQL } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    // Kimlik doğrulama zorunlu (F-02/F-05): anonim istek 401 alır.
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;


    const { searchParams } = new URL(req.url);
    const requestedStore = searchParams.get("storeCode") || "ALL";
    const cargoStatus = searchParams.get("cargoStatus");
    const pshBatchNo = searchParams.get("pshBatchNo");
    const search = (searchParams.get("search") || "").trim().slice(0, 120);

    // Kontrollü sayfalama: NaN/Infinity ve aşırı DOM/yanıt boyutları engellenir.
    const requestedPage = Number(searchParams.get("page"));
    const requestedPageSize = Number(searchParams.get("pageSize"));
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize =
      Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(200, requestedPageSize)
        : 50;

    // Mağaza izolasyonu sunucuda, oturum claim'inden zorlanır (F-11):
    // istemciden gelen storeCode parametresi STORE_USER için yok sayılır.
    const effectiveStore = resolveStoreScope(currentUser, requestedStore);

    const conditions: SQL[] = [];
    if (effectiveStore && effectiveStore !== "ALL") {
      conditions.push(eq(orders.buyerStore, effectiveStore));
    }
    if (cargoStatus && cargoStatus !== "ALL") {
      conditions.push(eq(orders.cargoStatus, cargoStatus));
    }
    if (pshBatchNo && pshBatchNo !== "ALL") {
      conditions.push(eq(orders.pshBatchNo, pshBatchNo));
    }
    if (search) {
      const pattern = `%${search}%`;
      const searchCondition = or(
        ilike(orders.orderNumber, pattern),
        ilike(orders.asin, pattern),
        ilike(orders.msku, pattern),
        ilike(orders.productTitle, pattern),
        ilike(orders.brandName, pattern),
        ilike(orders.supplierName, pattern),
        ilike(orders.orderEmail, pattern)
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const ordersBase = db.select().from(orders);
    const allOrders = await (conditions.length > 0
      ? ordersBase
          .where(and(...conditions))
          .orderBy(desc(orders.orderDate), desc(orders.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
      : ordersBase
          .orderBy(desc(orders.orderDate), desc(orders.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize));

    // KPI seçimi SQL tarafında aggregate ile hesaplanir (T2.6):
    // bellekte tum tabloyu reduce etmek yok; sayfa boyutu buyurse bile sabit maliyet
    const kpiSelect = {
      totalOrdersCount: count(),
      totalUnits: sql<string>`coalesce(sum(${orders.quantity}), 0)`,
      totalSpend: sql<string>`coalesce(sum(${orders.totalCost}), 0)`,
      totalShippedToAmazon: sql<string>`coalesce(sum(${orders.shippedToAmazon}), 0)`,
      p1CancelTotal: sql<string>`coalesce(sum(${orders.p1CancelQty}), 0)`,
      p2MissingTotal: sql<string>`coalesce(sum(${orders.p2MissingQty}), 0)`,
      p3DefectiveTotal: sql<string>`coalesce(sum(${orders.p3DefectiveQty}), 0)`,
      p4ExpiredTotal: sql<string>`coalesce(sum(${orders.p4ExpiredQty}), 0)`,
      totalRefunds: sql<string>`coalesce(sum(${orders.refundAmount}), 0)`,
      estimatedRevenue: sql<string>`coalesce(sum(
        ${orders.sellingPrice} * greatest(
          ${orders.quantity} - ${orders.p1CancelQty} - ${orders.p2MissingQty}
          - ${orders.p3DefectiveQty} - ${orders.p4ExpiredQty},
          0
        )
      ), 0)`,
      problemOrdersCount: sql<string>`count(*) filter (where
        ${orders.cargoStatus} = 'İPTAL'
        or ${orders.p1CancelQty} > 0
        or ${orders.p2MissingQty} > 0
        or ${orders.p3DefectiveQty} > 0
        or ${orders.p4ExpiredQty} > 0
        or ${orders.refundAmount} > 0)`,
    };

    const kpiBase = db.select(kpiSelect).from(orders);
    const kpiQuery =
      conditions.length > 0 ? kpiBase.where(and(...conditions)) : kpiBase;

    const [[kpi], allStores, allBatches, allAuditLogs, allUsers] = await Promise.all([
      kpiQuery,
      currentUser.role === "STORE_USER" && effectiveStore !== "ALL"
        ? db.select().from(stores).where(eq(stores.storeCode, effectiveStore)).orderBy(stores.storeCode)
        : db.select().from(stores).orderBy(stores.storeCode),
      effectiveStore && effectiveStore !== "ALL"
        ? db.select().from(pshBatches).where(eq(pshBatches.storeCode, effectiveStore)).orderBy(desc(pshBatches.createdAt))
        : db.select().from(pshBatches).orderBy(desc(pshBatches.createdAt)),
      currentUser.role === "STORE_USER"
        ? Promise.resolve([])
        : effectiveStore !== "ALL"
          ? db.select().from(auditLogs).where(eq(auditLogs.storeCode, effectiveStore)).orderBy(desc(auditLogs.createdAt)).limit(40)
          : db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40),
      // Kullanıcı dizini sipariş ekranının ihtiyacı değildir; yalnız ADMIN'e
      // güvenli alanlarla döner. Mağaza kullanıcılarına personel envanteri sızmaz.
      currentUser.role === "ADMIN"
        ? db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              storeCode: users.storeCode,
              avatar: users.avatar,
              createdAt: users.createdAt,
            })
            .from(users)
        : Promise.resolve([]),
    ]);

    const totalOrdersCount = Number(kpi?.totalOrdersCount || 0);
    const totalUnits = Number(kpi?.totalUnits || 0);
    const totalSpend = Number(kpi?.totalSpend || 0);
    const totalShippedToAmazon = Number(kpi?.totalShippedToAmazon || 0);
    const p1CancelTotal = Number(kpi?.p1CancelTotal || 0);
    const p2MissingTotal = Number(kpi?.p2MissingTotal || 0);
    const p3DefectiveTotal = Number(kpi?.p3DefectiveTotal || 0);
    const p4ExpiredTotal = Number(kpi?.p4ExpiredTotal || 0);
    const totalRefunds = Number(kpi?.totalRefunds || 0);
    const estimatedRevenue = Number(kpi?.estimatedRevenue || 0);
    const problemOrdersCount = Number(kpi?.problemOrdersCount || 0);
    const effectiveCost = Math.max(0, totalSpend - totalRefunds);
    const estimatedNet = estimatedRevenue - effectiveCost;

    return NextResponse.json({
      // T7.2 (KVKK): yanıt role göre minimize edilir — kart son-4 ve alıcı e-postası
      // ADMIN dışında maskelenir; kullanıcı listesi yalnız ADMIN'e tam döner
      orders: allOrders.map((o) => maskOrderForRole(o, currentUser)),
      stores: allStores,
      batches: allBatches,
      auditLogs: allAuditLogs,
      users: minimizeUsersForRole(allUsers, currentUser),
      // Anonim fallback kaldırıldı: oturum bu noktada garanti edilir (F-02/F-05)
      currentUser,
      pagination: {
        page,
        pageSize,
        total: totalOrdersCount,
        pageCount: Math.ceil(totalOrdersCount / pageSize),
      },
      kpis: {
        totalOrdersCount,
        totalUnits,
        totalSpend: totalSpend.toFixed(2),
        totalShippedToAmazon,
        problemOrdersCount,
        p1CancelTotal,
        p2MissingTotal,
        p3DefectiveTotal,
        p4ExpiredTotal,
        totalRefunds: totalRefunds.toFixed(2),
        estimatedRevenue: estimatedRevenue.toFixed(2),
        estimatedNet: estimatedNet.toFixed(2),
        estimatedRoi: effectiveCost > 0 ? ((estimatedNet / effectiveCost) * 100).toFixed(1) : "—",
        fulfillmentRate: totalUnits > 0 ? Math.round((totalShippedToAmazon / totalUnits) * 100) : 0,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/orders", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1): 40 kolonluk sözleşme tek şemada merkezileşti
    const parsed = await parseBody(req, orderCreateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;

    // Mağaza kapsamı oturumdan zorlanır (F-11): STORE_USER başka mağazaya yazamaz
    const targetStore = resolveStoreScope(currentUser, body.buyerStore || "HRN");

    const {
      orderDate = new Date().toISOString().split("T")[0],
      imageUrl = "",
      fulfillmentType = "FBA",
      productTitle,
      asin,
      msku,
      supplierName = "THE VITAMINSHOPPE",
      supplierCode = "A198",
      supplierUrl = "",
      amazonUrl = "",
      orderNumber,
      driveLink = "",
      packCount = 1,
      quantity = 1,
      unitCost = 0,
      sellingPrice = 0,
      totalCost = 0,
      orderEmail = "cerberusnisan@gmail.com",
      cargoStatus = "Tam Geldi",
      shippedToAmazon = 0,
      p1CancelQty = 0,
      p2MissingQty = 0,
      p3DefectiveQty = 0,
      p4ExpiredQty = 0,
      problemAction = "",
      problemResult = "",
      refundAmount = 0,
      creditCard = "",
      isFragile = "NO",
      isMultiPack = "NO",
      isBundle = "NO",
      countPerBundle = null,
      condition = "New",
      brandName = "General",
      description1 = "",
      description2 = "",
      auditNote = "",
      periodCode = "Ş26",
      correctedCost = 0,
      pshBatchNo = "",
      pshStatus = "BEKLIYOR",
      inventoryLabStatus = "GIRILMEDI",
    } = body;

    // Aktör adı istemciden değil oturumdan alınır (audit spoofing engeli)
    const actorName = currentUser.name;

    const calculatedTotal = Number(totalCost) || Number(unitCost) * Number(quantity);
    const calculatedCorrected = Number(correctedCost) || calculatedTotal;

    // Satın alma onay eşiği (F-06 / N-6 takip bulgusu): eşik aşılırsa sipariş
    // ENGELLENMEZ, PENDING_APPROVAL olarak işaretlenir (bkz. domain/purchaseApproval.ts).
    const [targetStoreRow] = await db
      .select({ purchaseApprovalThreshold: stores.purchaseApprovalThreshold })
      .from(stores)
      .where(eq(stores.storeCode, targetStore))
      .limit(1);
    const approvalDecision = evaluatePurchaseApproval({
      totalCost: calculatedTotal,
      creatorRole: currentUser.role,
      threshold:
        targetStoreRow?.purchaseApprovalThreshold != null
          ? Number(targetStoreRow.purchaseApprovalThreshold)
          : null,
    });

    // AŞAMA 1.2: Sipariş bir ürüne bağlanır; ürün yoksa katalogda oluşturulur.
    // Tek transaction: ürün yaratılıp sipariş yazılamazsa ikisi de geri alınır.
    const normalizedAsin = normalizeAsin(asin);
    if (!normalizedAsin) {
      return NextResponse.json(
        { error: "ASIN zorunludur: her sipariş bir ürüne bağlanmalıdır." },
        { status: 400 }
      );
    }

    const inserted = await db.transaction(async (tx) => {
      const { productId } = await resolveProduct(tx, {
        asin: normalizedAsin,
        productTitle,
        brandName,
        imageUrl,
        amazonUrl,
        packCount: Number(packCount) || 1,
        isFragile,
        isMultiPack,
        isBundle,
        countPerBundle,
        supplierName,
        supplierCode,
        supplierUrl,
        unitCost,
        observedAt: orderDate,
        sourceType: "MANUAL",
      });

      const [row] = await tx
      .insert(orders)
      .values({
        productId,
        buyerStore: targetStore,
        orderDate,
        imageUrl: imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=200&auto=format&fit=crop&q=80",
        fulfillmentType,
        productTitle,
        asin: normalizedAsin,
        msku: msku ? msku.trim() : `${targetStore}-${asin.trim()}`,
        supplierName,
        supplierCode,
        supplierUrl: supplierUrl || `https://www.vitaminshoppe.com/search?q=${encodeURIComponent(productTitle)}`,
        amazonUrl: amazonUrl || `https://www.amazon.com/dp/${asin.trim()}`,
        orderNumber: orderNumber.trim(),
        driveLink,
        packCount: Number(packCount) || 1,
        quantity: Number(quantity) || 1,
        unitCost: Number(unitCost).toFixed(2),
        sellingPrice: Number(sellingPrice).toFixed(2),
        totalCost: calculatedTotal.toFixed(2),
        orderEmail,
        cargoStatus,
        shippedToAmazon: Number(shippedToAmazon) || 0,
        p1CancelQty: Number(p1CancelQty) || 0,
        p2MissingQty: Number(p2MissingQty) || 0,
        p3DefectiveQty: Number(p3DefectiveQty) || 0,
        p4ExpiredQty: Number(p4ExpiredQty) || 0,
        problemAction,
        problemResult,
        refundAmount: Number(refundAmount).toFixed(2),
        creditCard,
        isFragile,
        isMultiPack,
        isBundle,
        countPerBundle,
        condition,
        brandName,
        description1,
        description2,
        auditNote,
        periodCode,
        correctedCost: calculatedCorrected.toFixed(2),
        pshBatchNo: pshBatchNo || null,
        pshStatus,
        inventoryLabStatus,
        approvalStatus: approvalDecision.status,
      })
      .returning();

      return row;
    });

    // Audit log
    await db.insert(auditLogs).values({
      actorName,
      storeCode: targetStore,
      actionType: "ORDER_CREATED",
      targetEntity: `${orderNumber} - ${productTitle.slice(0, 32)}`,
      beforeState: "YENI_GIRIS",
      afterState: cargoStatus,
      details: `${targetStore} mağazasına ${quantity} adet (${unitCost}$) sipariş girildi.`,
    });

    if (approvalDecision.status === "PENDING_APPROVAL") {
      await db.insert(auditLogs).values({
        actorName,
        storeCode: targetStore,
        actionType: "ORDER_APPROVAL_REQUIRED",
        targetEntity: `${orderNumber} - ${productTitle.slice(0, 32)}`,
        beforeState: "AUTO_APPROVED",
        afterState: "PENDING_APPROVAL",
        details: approvalDecision.reason,
      });
    }

    return NextResponse.json({
      message:
        approvalDecision.status === "PENDING_APPROVAL"
          ? `Sipariş kaydedildi, ancak mağaza eşiğini aştığı için ADMIN/MANAGER onayı bekliyor. ${approvalDecision.reason}`
          : "Sipariş Google Drive XLS veritabanına başarıyla kaydedildi.",
      order: inserted,
    });
  } catch (error: unknown) {
    return handleRouteError("POST /api/orders", error);
  }
}
