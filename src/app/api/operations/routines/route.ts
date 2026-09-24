import { NextResponse } from "next/server";
import { db } from "@/db";
import { routineCompletions, stores } from "@/db/schema";
import { requireUser, isDenied } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { computeRoutineBoards } from "@/domain/storeRoutines";
import { eq } from "drizzle-orm";

/**
 * GET /api/operations/routines
 *
 * Mağaza rutin kontrol listesi panosu (F-07, bkz. src/domain/storeRoutines.ts).
 * STORE_USER yalnız kendi mağazasını görür; ADMIN/MANAGER tüm filoyu görür
 * ve en çok gecikmiş/en düşük tamamlanma oranına sahip mağaza en üstte
 * sıralanır (StoreHealthScreen ile aynı "en kritik önce" konvansiyonu).
 */
export async function GET() {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const isScoped = user.role === "STORE_USER";

    const [storeRows, completionRows] = await Promise.all([
      isScoped
        ? db.select().from(stores).where(eq(stores.storeCode, user.storeCode))
        : db.select().from(stores).orderBy(stores.storeCode),
      isScoped
        ? db.select().from(routineCompletions).where(eq(routineCompletions.storeCode, user.storeCode))
        : db.select().from(routineCompletions),
    ]);

    const identities = storeRows.map((s) => ({
      storeCode: s.storeCode,
      storeName: s.storeName,
      status: s.status,
    }));

    const completions = completionRows.map((c) => ({
      storeCode: c.storeCode,
      routineId: c.routineId,
      periodKey: c.periodKey,
      completedBy: c.completedBy,
      completedAt: c.completedAt.toISOString(),
      note: c.note,
    }));

    const boards = computeRoutineBoards(identities, completions);

    const sorted = [...boards].sort((a, b) => {
      if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
      return (a.completionRatePercent ?? 0) - (b.completionRatePercent ?? 0);
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storeScope: isScoped ? user.storeCode : "ALL",
      boards: sorted,
      summary: {
        totalStores: sorted.length,
        totalOverdue: sorted.reduce((sum, b) => sum + b.overdueCount, 0),
        avgCompletionRate:
          sorted.length > 0
            ? Math.round(sorted.reduce((sum, b) => sum + (b.completionRatePercent ?? 0), 0) / sorted.length)
            : null,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/operations/routines", error);
  }
}
