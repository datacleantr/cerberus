import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireUser, isDenied } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { getThresholds } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { parseBody, settingsUpdateSchema } from "@/lib/validation";

export async function GET() {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const thresholds = await getThresholds();
    const hasEnvKey = Boolean(process.env.KEEPA_API_KEY?.trim());
    let hasDbKey = false;
    try {
      const rows = await db.select().from(appSettings).where(eq(appSettings.key, "keepa_api_key")).limit(1);
      hasDbKey = rows.length > 0 && Boolean(rows[0].value?.trim());
    } catch {}
    return NextResponse.json({ thresholds, keepa: { hasEnvKey, hasDbKey, effectiveHasKey: hasEnvKey || hasDbKey } });
  } catch (e: unknown) {
    return handleRouteError("GET /api/settings", e);
  }
}

export async function PUT(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    if (gate.user.role !== "ADMIN" && gate.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Yalnızca ADMIN/MANAGER eşikleri değiştirebilir." }, { status: 403 });
    }
    const parsed = await parseBody(req, settingsUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const { rejectRoi, testRoi, keepaKey } = parsed.data;

    const val = JSON.stringify({ rejectRoi, testRoi });
    const existing = await db.select().from(appSettings).where(eq(appSettings.key, "roi_thresholds")).limit(1);
    if (existing.length) {
      await db.update(appSettings).set({ value: val, updatedBy: gate.user.name, updatedAt: new Date() }).where(eq(appSettings.key, "roi_thresholds"));
    } else {
      await db.insert(appSettings).values({ key: "roi_thresholds", value: val, updatedBy: gate.user.name });
    }
    if (keepaKey !== undefined) {
      if (keepaKey === "") {
        await db.delete(appSettings).where(eq(appSettings.key, "keepa_api_key"));
      } else if (keepaKey) {
        const ek = await db.select().from(appSettings).where(eq(appSettings.key, "keepa_api_key")).limit(1);
        if (ek.length) await db.update(appSettings).set({ value: keepaKey, updatedBy: gate.user.name, updatedAt: new Date() }).where(eq(appSettings.key, "keepa_api_key"));
        else await db.insert(appSettings).values({ key: "keepa_api_key", value: keepaKey, updatedBy: gate.user.name });
      }
    }

    const { auditLogs } = await import("@/db/schema");
    await db.insert(auditLogs).values({
      actorName: gate.user.name,
      storeCode: gate.user.storeCode === "ALL" ? "HRN" : gate.user.storeCode,
      actionType: "SETTINGS_UPDATE",
      targetEntity: `ROI ${rejectRoi}/${testRoi}` + (keepaKey !== undefined ? (keepaKey ? " +Keepa" : " -Keepa") : ""),
      beforeState: "SETTINGS",
      afterState: `reject<${rejectRoi} test<${testRoi}`,
      details: `Eşikler güncellendi: REJECT < ${rejectRoi}%, TEST < ${testRoi}%` + (keepaKey !== undefined ? `, Keepa ${keepaKey ? "ayarlandı" : "silindi"}` : ""),
    });

    return NextResponse.json({ ok: true, thresholds: { rejectRoi, testRoi }, keepaUpdated: keepaKey !== undefined });
  } catch (e: unknown) {
    return handleRouteError("PUT /api/settings", e);
  }
}
