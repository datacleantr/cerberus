import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, orders } from "@/db/schema";
import { requireRole, isDenied } from "@/lib/guards";
import { parseBody, masterCrudDeleteSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { eq } from "drizzle-orm";

/**
 * Legacy endpoint kept for the admin order table.
 *
 * It used to accept arbitrary table names and allowed MANAGER users to delete
 * users/stores/products or a whole store's orders without an audit record.
 * The contract is now deliberately narrow: ADMIN + one order id + append-only
 * audit event in the same transaction.
 */
export async function DELETE(req: Request) {
  try {
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;

    const parsed = await parseBody(req, masterCrudDeleteSchema);
    if ("response" in parsed) return parsed.response;
    const { id } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!existing) return null;

      await tx.insert(auditLogs).values({
        actorName: gate.user.name,
        storeCode: existing.buyerStore,
        actionType: "ORDER_DELETED",
        targetEntity: `${existing.orderNumber} - ${existing.asin}`,
        beforeState: JSON.stringify({
          id: existing.id,
          quantity: existing.quantity,
          totalCost: existing.totalCost,
          cargoStatus: existing.cargoStatus,
        }),
        afterState: "DELETED",
        details: "Admin sipariş yönetimi ekranından tek satır silindi.",
      });
      await tx.delete(orders).where(eq(orders.id, id));
      return existing;
    });

    if (!result) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Sipariş #${id} kalıcı olarak silindi ve denetim izine kaydedildi.`,
    });
  } catch (error: unknown) {
    return handleRouteError("DELETE /api/admin/master-crud", error);
  }
}
