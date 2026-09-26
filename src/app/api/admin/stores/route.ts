import { NextResponse } from "next/server";
import { db } from "@/db";
import { stores, auditLogs, orders, routineCompletions, storeAssets, pshBatches, scrapeJobs, users } from "@/db/schema";
import { requireUser, requireRole, isDenied } from "@/lib/guards";
import { parseBody, storeCreateSchema, storeUpdateSchema, storeDeleteSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { maskCreditCard, maskEmail } from "@/lib/privacy";
import { eq, count, sum } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    // STORE_USER yalnız kendi mağazasını görür. Eski uygulama tüm mağazaların
    // iletişim/kart metadata'sını ve harcama toplamlarını açığa çıkarıyordu.
    const storeQuery = db.select().from(stores);
    const scopedStores =
      user.role === "STORE_USER"
        ? await storeQuery.where(eq(stores.storeCode, user.storeCode)).orderBy(stores.storeCode)
        : await storeQuery.orderBy(stores.storeCode);

    // N mağaza için N sorgu yerine tek GROUP BY; mağaza sayısı büyüdüğünde de
    // sabit sorgu sayısı korunur.
    const summaryQuery = db
      .select({
        storeCode: orders.buyerStore,
        orderCount: count(),
        totalSpend: sum(orders.totalCost),
      })
      .from(orders);
    const summaries =
      user.role === "STORE_USER"
        ? await summaryQuery
            .where(eq(orders.buyerStore, user.storeCode))
            .groupBy(orders.buyerStore)
        : await summaryQuery.groupBy(orders.buyerStore);
    const summariesByStore = new Map(summaries.map((row) => [row.storeCode, row]));

    const storeStats = scopedStores.map((store) => {
      const summary = summariesByStore.get(store.storeCode);
      return {
        ...store,
        // Yalnız ADMIN hassas mağaza varsayılanlarını görür. MANAGER ve
        // STORE_USER operasyon istatistiklerini kişisel/ödeme verisi olmadan alır.
        defaultCard: user.role === "ADMIN" ? store.defaultCard : maskCreditCard(store.defaultCard),
        defaultEmail: user.role === "ADMIN" ? store.defaultEmail : maskEmail(store.defaultEmail),
        totalOrdersCount: Number(summary?.orderCount || 0),
        totalSpend: Number(summary?.totalSpend || 0).toFixed(2),
      };
    });

    return NextResponse.json({ stores: storeStats });
  } catch (error: unknown) {
    return handleRouteError("admin/stores", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireRole("ADMIN", "MANAGER");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, storeCreateSchema);
    if ("response" in parsed) return parsed.response;
    if (
      currentUser.role !== "ADMIN" &&
      (parsed.data.defaultCard !== undefined || parsed.data.defaultEmail !== undefined)
    ) {
      return NextResponse.json(
        { error: "Ödeme ve sipariş e-postası varsayılanlarını yalnız ADMIN yönetebilir." },
        { status: 403 }
      );
    }
    const {
      storeCode,
      storeName,
      marketplace = "AMAZON",
      buyerName = currentUser.name,
      currency = "USD",
      defaultCard = "",
      defaultEmail = "",
      notes = "",
      purchaseApprovalThreshold = null,
    } = parsed.data;

    const cleanCode = storeCode.trim().toUpperCase();

    // Check existing
    const existing = await db
      .select()
      .from(stores)
      .where(eq(stores.storeCode, cleanCode))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: `Bu mağaza kodu (${cleanCode}) zaten tanımlı.` }, { status: 400 });
    }

    const [created] = await db
      .insert(stores)
      .values({
        storeCode: cleanCode,
        storeName: storeName.trim(),
        marketplace,
        buyerName: buyerName.trim(),
        currency,
        status: "ACTIVE",
        defaultCard,
        defaultEmail,
        notes,
        purchaseApprovalThreshold:
          purchaseApprovalThreshold === null ? null : purchaseApprovalThreshold.toFixed(2),
        totalOrdersCount: 0,
        totalSpend: "0.00",
      })
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: cleanCode,
      actionType: "STORE_CREATED",
      targetEntity: `${cleanCode} - ${storeName}`,
      beforeState: "YOK",
      afterState: "ACTIVE",
      details: `Yeni mağaza tanımlandı: ${storeName} (${marketplace}). Alıcı: ${buyerName}`,
    });

    return NextResponse.json({
      message: `${cleanCode} mağazası başarıyla oluşturuldu.`,
      store: created,
    });
  } catch (error: unknown) {
    return handleRouteError("admin/stores", error);
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireRole("ADMIN", "MANAGER");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, storeUpdateSchema);
    if ("response" in parsed) return parsed.response;
    if (
      currentUser.role !== "ADMIN" &&
      (parsed.data.defaultCard !== undefined || parsed.data.defaultEmail !== undefined)
    ) {
      return NextResponse.json(
        { error: "Ödeme ve sipariş e-postası varsayılanlarını yalnız ADMIN yönetebilir." },
        { status: 403 }
      );
    }
    const { id, storeName, buyerName, status, defaultCard, defaultEmail, notes, purchaseApprovalThreshold } =
      parsed.data;

    const existing = await db
      .select()
      .from(stores)
      .where(eq(stores.id, Number(id)))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json({ error: "Mağaza bulunamadı" }, { status: 404 });
    }

    const updateData: Record<string, any> = {};
    if (storeName !== undefined) updateData.storeName = storeName;
    if (buyerName !== undefined) updateData.buyerName = buyerName;
    if (status !== undefined) updateData.status = status;
    if (defaultCard !== undefined) updateData.defaultCard = defaultCard;
    if (defaultEmail !== undefined) updateData.defaultEmail = defaultEmail;
    if (notes !== undefined) updateData.notes = notes;
    if (purchaseApprovalThreshold !== undefined) {
      updateData.purchaseApprovalThreshold =
        purchaseApprovalThreshold === null ? null : purchaseApprovalThreshold.toFixed(2);
    }

    const [updated] = await db
      .update(stores)
      .set(updateData)
      .where(eq(stores.id, Number(id)))
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: updated.storeCode,
      actionType: "STORE_UPDATED",
      targetEntity: `${updated.storeCode} - ${updated.storeName}`,
      beforeState: existing[0].status,
      afterState: updated.status,
      details: `Mağaza güncellendi. Durum: ${updated.status}`,
    });

    return NextResponse.json({
      message: "Mağaza güncellendi",
      store: updated,
    });
  } catch (error: unknown) {
    return handleRouteError("admin/stores", error);
  }
}

/**
 * Mağaza kalıcı silme (admin panelinde eksik olan işlem, kullanıcı talebi
 * üzerine eklendi). Gerçek sipariş/rutin/varlık geçmişi olan bir mağaza
 * ASLA kalıcı silinmez — dürüstlük ilkesiyle aynı mantık: gerçek finansal
 * geçmişi yok saymak/kaybetmek olmaz. Böyle bir mağaza için doğru işlem
 * zaten var olan AKTİF/PASİF durum değişimidir (PATCH .status). Kalıcı
 * silme yalnızca hiç sipariş/rutin/varlık kaydı olmayan (yanlışlıkla
 * oluşturulmuş veya hiç kullanılmamış) mağazalar için izinlidir; bu yüzden
 * yalnız ADMIN (PATCH'teki ADMIN+MANAGER'dan daha dar kapsam).
 */
export async function DELETE(req: Request) {
  try {
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const parsed = await parseBody(req, storeDeleteSchema);
    if ("response" in parsed) return parsed.response;
    const { id } = parsed.data;

    const [target] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (!target) {
      return NextResponse.json({ error: "Mağaza bulunamadı" }, { status: 404 });
    }

    const [[orderRow], [routineRow], [assetRow], [batchRow], [scrapeRow], [userRow]] = await Promise.all([
      db.select({ n: count() }).from(orders).where(eq(orders.buyerStore, target.storeCode)),
      db
        .select({ n: count() })
        .from(routineCompletions)
        .where(eq(routineCompletions.storeCode, target.storeCode)),
      db.select({ n: count() }).from(storeAssets).where(eq(storeAssets.storeCode, target.storeCode)),
      db.select({ n: count() }).from(pshBatches).where(eq(pshBatches.storeCode, target.storeCode)),
      db.select({ n: count() }).from(scrapeJobs).where(eq(scrapeJobs.storeCode, target.storeCode)),
      db.select({ n: count() }).from(users).where(eq(users.storeCode, target.storeCode)),
    ]);
    const orderCount = Number(orderRow?.n || 0);
    const routineCount = Number(routineRow?.n || 0);
    const assetCount = Number(assetRow?.n || 0);
    const batchCount = Number(batchRow?.n || 0);
    const scrapeCount = Number(scrapeRow?.n || 0);
    const userCount = Number(userRow?.n || 0);

    if (orderCount > 0 || routineCount > 0 || assetCount > 0 || batchCount > 0 || scrapeCount > 0) {
      return NextResponse.json(
        {
          error: `${target.storeCode} mağazasının gerçek geçmişi var (${orderCount} sipariş, ${routineCount} rutin kaydı, ${assetCount} varlık, ${batchCount} PSH batch, ${scrapeCount} tarama işi) — kalıcı silinemez. Bunun yerine mağazayı PASİF yapın.`,
        },
        { status: 409 }
      );
    }
    if (userCount > 0) {
      return NextResponse.json(
        {
          error: `${target.storeCode} mağazasına ${userCount} kullanıcı atanmış — önce o kullanıcıları başka bir mağazaya atayın ya da silin, sonra tekrar deneyin.`,
        },
        { status: 409 }
      );
    }

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: target.storeCode,
      actionType: "STORE_DELETED",
      targetEntity: `${target.storeCode} - ${target.storeName}`,
      beforeState: target.status,
      afterState: "SİLİNDİ",
      details: "Geçmişi olmayan mağaza kalıcı olarak silindi.",
    });

    await db.delete(stores).where(eq(stores.id, id));

    return NextResponse.json({
      message: `${target.storeCode} mağazası kalıcı olarak silindi.`,
    });
  } catch (error: unknown) {
    return handleRouteError("admin/stores", error);
  }
}
