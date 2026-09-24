import { NextResponse } from "next/server";
import { db } from "@/db";
import { pshBatches, orders, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { parseBody, prepshipImportSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { computeInventoryLabSyncPreview } from "@/domain/prepshipReconciliation";

/**
 * PrepShip → CERBERUS Inventory Lab senkron teyidi (denetim raporu §17).
 *
 * DÜZELTME (bkz. `src/domain/prepshipReconciliation.ts` başlığı): kullanıcının
 * paylaştığı dosyadaki QUANTITY, depoya fiilen GELEN adet değil, sipariş
 * verilirken girilen adet. Gerçek depo teslimat/fire miktarları
 * (`shippedToAmazon`, `p2MissingQty` vb.) hâlâ, doğru şekilde,
 * `WarehouseReconciliationModal` üzerinden elle giriliyor — bu uç ONLARA
 * ASLA DOKUNMAZ.
 *
 * Bu uç yalnızca şunu yapar: PrepShip'in Inventory Lab'a gönderdiği dosya
 * ile batch'in siparişlerini MSKU bazında eşleştirir. `commit=false`
 * (varsayılan): yalnızca önizleme döner. `commit=true`: eşleşen
 * siparişlerin `inventoryLabStatus`'unu `GIRILDI` yapar; batch'teki TÜM
 * siparişler eşleştiyse `psh_batches.inventoryLabSynced=true` işaretler.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ batchNumber: string }> }
) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { batchNumber } = await context.params;

    const parsed = await parseBody(req, prepshipImportSchema);
    if ("response" in parsed) return parsed.response;
    const { rows, commit } = parsed.data;

    const existingBatch = await db
      .select()
      .from(pshBatches)
      .where(eq(pshBatches.batchNumber, batchNumber))
      .limit(1);

    if (!existingBatch.length) {
      return NextResponse.json({ error: "PSH batch bulunamadı." }, { status: 404 });
    }
    const batch = existingBatch[0];

    if (!canAccessStore(currentUser, batch.storeCode)) {
      return NextResponse.json(
        { error: "Bu batch sizin mağaza kapsamınızda değil." },
        { status: 403 }
      );
    }

    const batchOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.pshBatchNo, batchNumber));

    if (!batchOrders.length) {
      return NextResponse.json({ error: "Bu batch'e atanmış sipariş yok." }, { status: 422 });
    }

    const preview = computeInventoryLabSyncPreview(
      batchOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        msku: o.msku,
        quantity: Number(o.quantity) || 0,
      })),
      rows
    );

    if (!commit) {
      return NextResponse.json({ preview, committed: false });
    }

    const allMatched = preview.perOrder.every((o) => o.matched);

    await db.transaction(async (tx) => {
      for (const line of preview.perOrder) {
        if (!line.matched) continue;
        await tx
          .update(orders)
          .set({ inventoryLabStatus: "GIRILDI", updatedAt: new Date() })
          .where(eq(orders.id, line.orderId));
      }

      if (allMatched) {
        await tx
          .update(pshBatches)
          .set({ inventoryLabSynced: true, updatedAt: new Date() })
          .where(eq(pshBatches.batchNumber, batchNumber));
      }

      await tx.insert(auditLogs).values({
        actorName: currentUser.name,
        storeCode: batch.storeCode,
        actionType: "PSH_BATCH_INVENTORY_LAB_SYNC_CONFIRMED",
        targetEntity: batchNumber,
        beforeState: "GIRILMEDI",
        afterState: "GIRILDI",
        details: `PrepShip dosyasıyla ${preview.matchedCount} sipariş Inventory Lab'a ulaştı olarak teyit edildi (${preview.unmatchedCount} eşleşmedi, ${preview.warnings.length} uyarı).`,
      });
    });

    return NextResponse.json({ preview, committed: true });
  } catch (error: unknown) {
    return handleRouteError("POST /api/batches/[batchNumber]/prepship-import", error);
  }
}
