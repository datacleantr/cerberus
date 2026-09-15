import { NextResponse } from "next/server";
import { db } from "@/db";
import { pshBatches, orders, auditLogs } from "@/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireUser, isDenied, resolveStoreScope, canAccessStore } from "@/lib/guards";
import { parseBody, batchCreateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";

export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { searchParams } = new URL(req.url);
    const storeCode = resolveStoreScope(currentUser, searchParams.get("storeCode"));

    const allBatches = storeCode && storeCode !== "ALL"
      ? await db.select().from(pshBatches).where(eq(pshBatches.storeCode, storeCode)).orderBy(desc(pshBatches.createdAt))
      : await db.select().from(pshBatches).orderBy(desc(pshBatches.createdAt));

    return NextResponse.json({ batches: allBatches });
  } catch (error: unknown) {
    return handleRouteError("GET /api/batches", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, batchCreateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const {
      batchNumber,
      title,
      orderIds = [],
      notes = "",
    } = body;

    // Mağaza kapsamı ve aktör oturumdan zorlanır (F-11, audit spoofing engeli)
    const storeCode = resolveStoreScope(currentUser, body.storeCode || "HRN");
    const actorName = currentUser.name;


    const uniqueOrderIds = [...new Set(orderIds)];
    if (uniqueOrderIds.length !== orderIds.length) {
      return NextResponse.json(
        { error: "Aynı sipariş batch listesinde birden fazla kez gönderilemez." },
        { status: 422 }
      );
    }

    // Batch ve sipariş atamaları atomiktir. Önceki akışta batch insert'i başarılı,
    // sipariş update'i başarısız olduğunda boş/yetim bir batch kalabiliyordu.
    const created = await db.transaction(async (tx) => {
      const selectedOrders = uniqueOrderIds.length
        ? await tx.select().from(orders).where(inArray(orders.id, uniqueOrderIds))
        : [];

      if (selectedOrders.length !== uniqueOrderIds.length) {
        return { error: "Seçilen siparişlerden en az biri bulunamadı.", status: 404 as const };
      }
      if (selectedOrders.some((order) => !canAccessStore(currentUser, order.buyerStore))) {
        return { error: "Başka bir mağazanın siparişi bu batch'e eklenemez.", status: 403 as const };
      }
      if (selectedOrders.some((order) => order.buyerStore !== storeCode)) {
        return { error: "Bir batch yalnızca tek mağazanın siparişlerini içerebilir.", status: 422 as const };
      }
      if (selectedOrders.some((order) => Boolean(order.pshBatchNo))) {
        return { error: "Seçilen siparişlerden en az biri zaten başka bir batch'e atanmış.", status: 409 as const };
      }

      const totalUnitsCount = selectedOrders.reduce(
        (sum, order) => sum + Number(order.quantity || 0),
        0
      );
      const [batch] = await tx
        .insert(pshBatches)
        .values({
          batchNumber: batchNumber.trim(),
          storeCode,
          title,
          totalItemsCount: uniqueOrderIds.length,
          totalUnitsCount,
          notes,
        })
        .returning();

      if (uniqueOrderIds.length > 0) {
        const assigned = await tx
          .update(orders)
          .set({
            pshBatchNo: batchNumber.trim(),
            pshStatus: "BATCH_OLUSTURULDU",
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(orders.id, uniqueOrderIds),
              eq(orders.buyerStore, storeCode),
              isNull(orders.pshBatchNo)
            )
          )
          .returning({ id: orders.id });
        if (assigned.length !== uniqueOrderIds.length) {
          throw new Error("BATCH_ASSIGNMENT_CONFLICT");
        }
      }

      await tx.insert(auditLogs).values({
        actorName,
        storeCode,
        actionType: "PSH_BATCH_CREATED",
        targetEntity: batchNumber.trim(),
        beforeState: "YOK",
        afterState: "HAZIRLANIYOR",
        details: `${title} - ${uniqueOrderIds.length} sipariş / ${totalUnitsCount} adet bu batch altına bağlandı.`,
      });

      return { batch };
    });

    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }

    return NextResponse.json({
      message: "PSH Envanter Batch başarıyla oluşturuldu",
      batch: created.batch,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "BATCH_ASSIGNMENT_CONFLICT") {
      return NextResponse.json(
        { error: "Siparişlerden biri eşzamanlı olarak başka bir batch'e atandı. Listeyi yenileyip tekrar deneyin." },
        { status: 409 }
      );
    }
    return handleRouteError("POST /api/batches", error);
  }
}
