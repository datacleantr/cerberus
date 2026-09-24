import { NextResponse } from "next/server";
import { db } from "@/db";
import { stores, auditLogs, orders } from "@/db/schema";
import { requireUser, requireRole, isDenied } from "@/lib/guards";
import { parseBody, storeCreateSchema, storeUpdateSchema } from "@/lib/validation";
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
