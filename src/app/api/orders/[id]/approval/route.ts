import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireRole, isDenied } from "@/lib/guards";
import { parseBody, orderApprovalDecisionSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { canResolveApproval, type ApprovalStatus } from "@/domain/purchaseApproval";

/**
 * PATCH /api/orders/[id]/approval
 *
 * Bekleyen (PENDING_APPROVAL) bir siparişi onaylar/reddeder. Genel sipariş
 * PATCH'inden (route.ts) BİLİNÇLİ OLARAK ayrı: approvalStatus asla oradaki
 * beyaz listeye eklenmedi — eklenirse bir STORE_USER kendi eşik-aşan
 * siparişini kendi kendine onaylayabilirdi. Bu uç nokta yalnız ADMIN/MANAGER
 * içindir (requireRole ile zorlanır).
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireRole("ADMIN", "MANAGER");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { id } = await context.params;
    const parsed = await parseBody(req, orderApprovalDecisionSchema);
    if ("response" in parsed) return parsed.response;
    const { decision } = parsed.data;

    const existing = await db
      .select()
      .from(orders)
      .where(eq(orders.id, Number(id)))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    }
    const current = existing[0];

    if (!canResolveApproval(current.approvalStatus as ApprovalStatus)) {
      return NextResponse.json(
        {
          error: `Bu sipariş onay bekleyen durumda değil (şu an: ${current.approvalStatus}). Yalnız PENDING_APPROVAL siparişler onaylanabilir/reddedilebilir.`,
        },
        { status: 409 }
      );
    }

    const [updated] = await db
      .update(orders)
      .set({
        approvalStatus: decision,
        approvedBy: currentUser.name,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, Number(id)))
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: current.buyerStore,
      actionType: decision === "APPROVED" ? "ORDER_APPROVED" : "ORDER_REJECTED",
      targetEntity: `${current.orderNumber} - ${current.productTitle.slice(0, 28)}`,
      beforeState: "PENDING_APPROVAL",
      afterState: decision,
      details: `${currentUser.name} bu siparişi ${decision === "APPROVED" ? "onayladı" : "reddetti"} (tutar: $${current.totalCost}).`,
    });

    return NextResponse.json({
      message: decision === "APPROVED" ? "Sipariş onaylandı." : "Sipariş reddedildi.",
      order: updated,
    });
  } catch (error: unknown) {
    return handleRouteError("PATCH /api/orders/[id]/approval", error);
  }
}
