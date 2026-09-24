import { NextResponse } from "next/server";
import { db } from "@/db";
import { storeAssets, auditLogs } from "@/db/schema";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { parseBody, assetCreateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { computeAssetBoard, type AssetFact } from "@/domain/assetTracker";
import { isNull, or, eq } from "drizzle-orm";

/**
 * GET/POST /api/operations/assets
 *
 * Araç/abonelik/alan adı/Shopify site takibi (F-07, ikinci bölüm — bkz.
 * src/domain/assetTracker.ts). storeCode NULL = şirket geneli varlık
 * (ör. paylaşılan ASINZEN/Keepa üyeliği). STORE_USER kendi mağazasının
 * varlıklarını + şirket geneli varlıkları görür; şirket geneli varlık
 * OLUŞTURAMAZ (yalnız ADMIN/MANAGER).
 */
export async function GET() {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const isScoped = user.role === "STORE_USER";

    const rows = isScoped
      ? await db
          .select()
          .from(storeAssets)
          .where(or(eq(storeAssets.storeCode, user.storeCode), isNull(storeAssets.storeCode)))
      : await db.select().from(storeAssets);

    const facts: AssetFact[] = rows.map((r) => ({
      id: r.id,
      storeCode: r.storeCode,
      assetType: r.assetType as AssetFact["assetType"],
      name: r.name,
      provider: r.provider,
      url: r.url,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      renewalCost: r.renewalCost !== null ? Number(r.renewalCost) : null,
      notes: r.notes,
      lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
      lastCheckedBy: r.lastCheckedBy,
    }));

    const board = computeAssetBoard(facts);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storeScope: isScoped ? user.storeCode : "ALL",
      assets: board,
      summary: {
        total: board.length,
        expired: board.filter((a) => a.status === "EXPIRED").length,
        expiringSoon: board.filter((a) => a.status === "EXPIRING_SOON").length,
        notTracked: board.filter((a) => a.status === "NOT_TRACKED").length,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/operations/assets", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const parsed = await parseBody(req, assetCreateSchema);
    if ("response" in parsed) return parsed.response;
    const data = parsed.data;

    const targetStore = data.storeCode ?? null;
    if (targetStore === null) {
      if (user.role === "STORE_USER") {
        return NextResponse.json(
          { error: "Şirket geneli varlık eklemek için ADMIN/MANAGER yetkisi gerekir." },
          { status: 403 }
        );
      }
    } else if (!canAccessStore(user, targetStore)) {
      return NextResponse.json({ error: "Bu mağaza için işlem yetkiniz yok." }, { status: 403 });
    }

    const [created] = await db
      .insert(storeAssets)
      .values({
        storeCode: targetStore,
        assetType: data.assetType,
        name: data.name,
        provider: data.provider || null,
        url: data.url || null,
        expiresAt: data.expiresAt ?? null,
        renewalCost:
          data.renewalCost !== null && data.renewalCost !== undefined ? data.renewalCost.toFixed(2) : null,
        notes: data.notes || null,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorName: user.name,
      storeCode: targetStore ?? "ALL",
      actionType: "ASSET_CREATED",
      targetEntity: `${data.assetType}: ${data.name}`,
      afterState: "TAKIP_BASLADI",
      details: `${user.name} yeni varlık ekledi: ${data.name} (${targetStore ?? "şirket geneli"}).`,
    });

    return NextResponse.json({ message: "Varlık eklendi.", asset: created }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteError("POST /api/operations/assets", error);
  }
}
