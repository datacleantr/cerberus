import { describe, it, expect } from "vitest";
import { computeRoutineBoards, dailyKey, monthKey } from "./storeRoutines";
import { isoWeekKey } from "./storeHealth";
import { ROUTINE_CATALOG, ROUTINE_TRACKING_STARTED_AT } from "./routineCatalog";

const LAUNCH = new Date(ROUTINE_TRACKING_STARTED_AT);
const STORE_A = { storeCode: "HRN", storeName: "HRN Mağaza", status: "ACTIVE" };
const STORE_B = { storeCode: "SEL", storeName: "SEL Mağaza", status: "ACTIVE" };

describe("computeRoutineBoards", () => {
  it("hiç tamamlanma yoksa tüm kalemler done:false döner, lansman gününde overdue sıfırdır", () => {
    const [board] = computeRoutineBoards([STORE_A], [], LAUNCH);
    expect(board.daily.every((d) => !d.done)).toBe(true);
    expect(board.weekly.every((d) => !d.done)).toBe(true);
    expect(board.monthly.every((d) => !d.done)).toBe(true);
    expect(board.overdueCount).toBe(0);
    expect(board.completionRatePercent).toBe(0);
  });

  it("bir günlük rutin bugün için işaretlenirse yalnız o kalem done olur", () => {
    const routine = ROUTINE_CATALOG.find((r) => r.frequency === "DAILY")!;
    const completions = [
      {
        storeCode: "HRN",
        routineId: routine.id,
        periodKey: dailyKey(LAUNCH),
        completedBy: "Ayşe",
        completedAt: LAUNCH.toISOString(),
        note: null,
      },
    ];
    const [board] = computeRoutineBoards([STORE_A], completions, LAUNCH);
    const item = board.daily.find((d) => d.routine.id === routine.id)!;
    expect(item.done).toBe(true);
    expect(item.completedBy).toBe("Ayşe");
    const otherDaily = board.daily.filter((d) => d.routine.id !== routine.id);
    expect(otherDaily.every((d) => !d.done)).toBe(true);
  });

  it("haftalık rutin işaretlemesi isoWeekKey ile eşleşen dönemde done sayılır", () => {
    const routine = ROUTINE_CATALOG.find((r) => r.frequency === "WEEKLY")!;
    const completions = [
      {
        storeCode: "HRN",
        routineId: routine.id,
        periodKey: isoWeekKey(LAUNCH),
        completedBy: "Mehmet",
        completedAt: LAUNCH.toISOString(),
        note: "haftalık kontrol yapıldı",
      },
    ];
    const [board] = computeRoutineBoards([STORE_A], completions, LAUNCH);
    const item = board.weekly.find((w) => w.routine.id === routine.id)!;
    expect(item.done).toBe(true);
    expect(item.note).toBe("haftalık kontrol yapıldı");
  });

  it("lansmandan 40 gün sonra hiç işaretleme yoksa overdueCount MAX_LOOKBACK sınırında pozitif olur", () => {
    const future = new Date(LAUNCH.getTime() + 40 * 86_400_000);
    const [board] = computeRoutineBoards([STORE_A], [], future);
    // 6 günlük + 3 haftalık + 2 aylık geçmiş dönem = en fazla (6+3+2) * ilgili rutin sayısı
    expect(board.overdueCount).toBeGreaterThan(0);
    const dailyCount = ROUTINE_CATALOG.filter((r) => r.frequency === "DAILY").length;
    const weeklyCount = ROUTINE_CATALOG.filter((r) => r.frequency === "WEEKLY").length;
    const monthlyCount = ROUTINE_CATALOG.filter((r) => r.frequency === "MONTHLY").length;
    const maxPossible = dailyCount * 6 + weeklyCount * 3 + monthlyCount * 2;
    expect(board.overdueCount).toBeLessThanOrEqual(maxPossible);
  });

  it("iki mağaza birbirine karışmaz", () => {
    const routine = ROUTINE_CATALOG.find((r) => r.frequency === "DAILY")!;
    const completions = [
      {
        storeCode: "HRN",
        routineId: routine.id,
        periodKey: dailyKey(LAUNCH),
        completedBy: "Ayşe",
        completedAt: LAUNCH.toISOString(),
        note: null,
      },
    ];
    const [boardA, boardB] = computeRoutineBoards([STORE_A, STORE_B], completions, LAUNCH);
    expect(boardA.daily.find((d) => d.routine.id === routine.id)!.done).toBe(true);
    expect(boardB.daily.find((d) => d.routine.id === routine.id)!.done).toBe(false);
  });

  it("aylık dönem anahtarı takvim ayına göre üretilir", () => {
    const d = new Date(Date.UTC(2026, 8, 25)); // Eylül 2026
    expect(monthKey(d)).toBe("2026-09");
  });
});
