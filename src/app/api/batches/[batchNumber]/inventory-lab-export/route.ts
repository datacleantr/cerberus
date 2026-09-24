import { NextResponse } from "next/server";
import { db } from "@/db";
import { pshBatches, orders, auditLogs } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { buildInventoryLabExportCsv } from "@/features/orders/inventoryLabExport";

/**
 * Inventory Lab köprüsü — Adım 2 (denetim raporu §13/§14).
 *
 * Kolon düzeni artık kullanıcının paylaştığı GERÇEK Inventory Lab
 * dosyasından (`IL-FBA198Z678P1_Tue_Mar_24_2026.csv`) alınıyor — bkz.
 * `src/features/orders/inventoryLabExport.ts`. Bu uç batch'in sevk
 * edilmiş satırlarını bu gerçek şablona döker ve `inventoryLabStatus=
 * GIRILDI` + `psh_batches.inventoryLabSynced=true` işaretler.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ batchNumber: string }> }
) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { batchNumber } = await context.params;

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

    // Yalnızca fiilen Amazona sevk edilmiş satırlar dışa aktarılır —
    // henüz depoda sayılmamış veya tamamen eksik gelen sipariş Inventory
    // Lab'a "sevk edildi" gibi yazılmaz.
    const shippedOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.pshBatchNo, batchNumber), gt(orders.shippedToAmazon, 0)));

    if (!shippedOrders.length) {
      return NextResponse.json(
        { error: "Bu batch'te henüz Amazona sevk edilmiş sipariş yok." },
        { status: 422 }
      );
    }

    const csv = buildInventoryLabExportCsv(shippedOrders);

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ inventoryLabStatus: "GIRILDI", updatedAt: new Date() })
        .where(and(eq(orders.pshBatchNo, batchNumber), gt(orders.shippedToAmazon, 0)));

      await tx
        .update(pshBatches)
        .set({ inventoryLabSynced: true, updatedAt: new Date() })
        .where(eq(pshBatches.batchNumber, batchNumber));

      await tx.insert(auditLogs).values({
        actorName: currentUser.name,
        storeCode: batch.storeCode,
        actionType: "PSH_BATCH_INVENTORY_LAB_EXPORTED",
        targetEntity: batchNumber,
        beforeState: "GIRILMEDI",
        afterState: "GIRILDI",
        details: `${shippedOrders.length} sipariş satırı Inventory Lab CSV'sine aktarıldı (geçici genel format).`,
      });
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${batchNumber}-inventory-lab.csv"`,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/batches/[batchNumber]/inventory-lab-export", error);
  }
}
