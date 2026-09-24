import { NextResponse } from "next/server";
import { db } from "@/db";
import { routineCompletions } from "@/db/schema";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { parseBody, routineCompleteSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { routineById } from "@/domain/routineCatalog";
import { isoWeekKey } from "@/domain/storeHealth";
import { dailyKey, monthKey } from "@/domain/storeRoutines";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/operations/routines/complete
 *
 * Bir rutini o dönem (gün/hafta/ay) için işaretler. STORE_USER yalnız kendi
 * mağazası için işaretleyebilir (canAccessStore); ADMIN/MANAGER herhangi
 * bir mağaza için işaretleyebilir (ör. o mağazanın operatörü izinliyken) —
 * ama `completedBy` her zaman GERÇEK işaretleyen kişinin adı olur, asla
 * mağazanın STORE_USER'ının adına uydurulmaz.
 *
 * Aynı dönem için tekrar işaretleme, yeni satır değil GÜNCELLEME yapar
 * (routine_completions_uq benzersiz kısıtı) — not/zaman düzeltmesi içindir.
 */
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const parsed = await parseBody(req, routineCompleteSchema);
    if ("response" in parsed) return parsed.response;
    const { storeCode, routineId, note } = parsed.data;

    if (!canAccessStore(user, storeCode)) {
      return NextResponse.json({ error: "Bu mağaza için işlem yetkiniz yok." }, { status: 403 });
    }

    const routine = routineById(routineId);
    if (!routine) {
      return NextResponse.json({ error: "Bilinmeyen rutin kimliği." }, { status: 422 });
    }

    const now = new Date();
    const periodKey =
      routine.frequency === "DAILY"
        ? dailyKey(now)
        : routine.frequency === "WEEKLY"
          ? isoWeekKey(now)
          : monthKey(now);

    const existing = await db
      .select()
      .from(routineCompletions)
      .where(
        and(
          eq(routineCompletions.storeCode, storeCode),
          eq(routineCompletions.routineId, routineId),
          eq(routineCompletions.periodKey, periodKey)
        )
      )
      .limit(1);

    let saved;
    if (existing.length) {
      [saved] = await db
        .update(routineCompletions)
        .set({ completedBy: user.name, completedAt: now, note: note ?? null })
        .where(eq(routineCompletions.id, existing[0].id))
        .returning();
    } else {
      [saved] = await db
        .insert(routineCompletions)
        .values({
          storeCode,
          routineId,
          frequency: routine.frequency,
          periodKey,
          completedBy: user.name,
          completedAt: now,
          note: note ?? null,
        })
        .returning();
    }

    return NextResponse.json({ message: `${routine.title} işaretlendi.`, completion: saved });
  } catch (error: unknown) {
    return handleRouteError("POST /api/operations/routines/complete", error);
  }
}
