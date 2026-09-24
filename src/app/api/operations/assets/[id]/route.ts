import { NextResponse } from "next/server";
import { db } from "@/db";
import { storeAssets, auditLogs } from "@/db/schema";
import { requireUser, requireRole, isDenied, canAccessStore } from "@/lib/guards";
import { parseBody, assetUpdateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/operations/assets/[id]
 *
 * Varlık güncelleme (süre, not, "kontrol edildi" işareti). Şirket geneli
 * varlıklar (storeCode NULL) yalnız ADMIN/MANAGER tarafından güncellenebilir.
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const { id } = await context.params;
    const existing = await db.select().from(storeAssets).where(eq(storeAssets.id, Number(id))).limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: "Varlık bulunamadı." }, { status: 404 });
    }
    const current = existing[0];

    if (current.storeCode === null) {
      if (user.role === "STORE_USER") {
        return NextResponse.json(
          { error: "Şirket geneli varlığı yalnız ADMIN/MANAGER güncelleyebilir." },
          { status: 403 }
        );
      }
    } else if (!canAccessStore(user, current.storeCode)) {
      return NextResponse.json({ error: "Bu varlık için işlem yetkiniz yok." }, { status: 403 });
    }

    const parsed = await parseBody(req, assetUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const data = parsed.data;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.assetType !== undefined) updateData.assetType = data.assetType;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.provider !== undefined) updateData.provider = data.provider || null;
    if (data.url !== undefined) updateData.url = data.url || null;
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
    if (data.renewalCost !== undefined) {
      updateData.renewalCost = data.renewalCost !== null ? data.renewalCost.toFixed(2) : null;
    }
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.markChecked) {
      updateData.lastCheckedAt = new Date();
      updateData.lastCheckedBy = user.name;
    }

    const [updated] = await db
      .update(storeAssets)
      .set(updateData)
      .where(eq(storeAssets.id, Number(id)))
      .returning();

    return NextResponse.json({ message: "Varlık güncellendi.", asset: updated });
  } catch (error: unknown) {
    return handleRouteError("PATCH /api/operations/assets/[id]", error);
  }
}

/** DELETE — yalnız ADMIN/MANAGER; yanlışlıkla mağaza operatörünün takip kaydını silmesini engeller. */
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole("ADMIN", "MANAGER");
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const { id } = await context.params;
    const existing = await db.select().from(storeAssets).where(eq(storeAssets.id, Number(id))).limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: "Varlık bulunamadı." }, { status: 404 });
    }
    const current = existing[0];

    await db.delete(storeAssets).where(eq(storeAssets.id, Number(id)));

    await db.insert(auditLogs).values({
      actorName: user.name,
      storeCode: current.storeCode ?? "ALL",
      actionType: "ASSET_DELETED",
      targetEntity: `${current.assetType}: ${current.name}`,
      beforeState: "TAKIP_EDILIYORDU",
      details: `${user.name} varlık kaydını sildi: ${current.name}.`,
    });

    return NextResponse.json({ message: "Varlık silindi." });
  } catch (error: unknown) {
    return handleRouteError("DELETE /api/operations/assets/[id]", error);
  }
}
