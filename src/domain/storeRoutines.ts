/**
 * CERBERUS — Mağaza Rutin Kontrol Listesi Motoru
 *
 * Kaynak: kullanıcının yüklediği "Amazon Mağaza Ekibi Rutin" belgesi ve
 * kendi notu — gerçek yapı belgedeki 5 rol şablonu DEĞİL, mağaza başına TEK
 * operatör (bkz. ./routineCatalog.ts). Katalog konsolide ve statik;
 * burada yalnız TAMAMLANMA durumu (kim, ne zaman, hangi dönem) hesaplanır.
 *
 * TASARIM (kullanıcı onayı, 2026-09-25): her mağazanın kendi STORE_USER'ı
 * kendi rutinini işaretler; ADMIN/MANAGER filo genelinde roll-up görür.
 *
 * DÜRÜSTLÜK İLKESİ (computeRealizedRoi / computeWeeklyStoreHealth ile aynı):
 * bir rutin hiç işaretlenmemişse "tamamlandı" denmez — `done: false` kalır.
 * Geçmiş dönemlerdeki eksik işaretlemeler "gecikmiş" sayacına yansır ama bu
 * sayaç ÖZELLİĞİN DEVREYE GİRDİĞİ TARİHTEN ÖNCEKİ dönemleri asla saymaz
 * (bkz. ROUTINE_TRACKING_STARTED_AT) — yoksa ilk gün her mağaza sahte bir
 * "geçmişte kaçırılmış görev" listesiyle karşılaşır.
 */

import { ROUTINE_CATALOG, ROUTINE_TRACKING_STARTED_AT, type RoutineDefinition, type RoutineFrequency } from "./routineCatalog";
import { isoWeekKey } from "./storeHealth";

const MS_PER_DAY = 86_400_000;

export interface RoutineCompletionFact {
  storeCode: string;
  routineId: string;
  periodKey: string;
  completedBy: string;
  completedAt: string; // ISO
  note: string | null;
}

export interface RoutineIdentity {
  storeCode: string;
  storeName: string;
  status: string;
}

export interface RoutineItemStatus {
  routine: RoutineDefinition;
  currentPeriodKey: string;
  done: boolean;
  completedBy: string | null;
  completedAt: string | null;
  note: string | null;
}

export interface StoreRoutineBoard {
  storeCode: string;
  storeName: string;
  status: string;
  daily: RoutineItemStatus[];
  weekly: RoutineItemStatus[];
  monthly: RoutineItemStatus[];
  /** Bugünün günlük + bu haftanın haftalık + bu ayın aylık kalemleri birleşik oranı (0-100) */
  completionRatePercent: number | null;
  /** Takip başlangıcından bu yana, geçmiş (mevcut hariç) dönemlerde işaretlenmemiş kalem sayısı */
  overdueCount: number;
}

/** Gün anahtarı — UTC, isoWeekKey ile aynı zaman tabanı */
export function dailyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ay anahtarı — takvim ayı, UTC */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodKeyFor(frequency: RoutineFrequency, date: Date): string {
  if (frequency === "DAILY") return dailyKey(date);
  if (frequency === "WEEKLY") return isoWeekKey(date);
  return monthKey(date);
}

const MAX_LOOKBACK: Record<RoutineFrequency, number> = {
  DAILY: 6,
  WEEKLY: 3,
  MONTHLY: 2,
};

/**
 * Kaç geçmiş dönemin gecikme sayımına dahil edileceğini belirler —
 * hem MAX_LOOKBACK ile hem de takip başlangıç tarihinden bu yana geçen
 * gerçek dönem sayısıyla sınırlıdır (bkz. dosya başı DÜRÜSTLÜK İLKESİ notu).
 */
function effectiveLookback(frequency: RoutineFrequency, now: Date): number {
  const trackingStart = new Date(ROUTINE_TRACKING_STARTED_AT);
  const daysSinceLaunch = Math.floor((now.getTime() - trackingStart.getTime()) / MS_PER_DAY);
  if (daysSinceLaunch <= 0) return 0;

  if (frequency === "DAILY") return Math.min(MAX_LOOKBACK.DAILY, daysSinceLaunch);
  if (frequency === "WEEKLY") return Math.min(MAX_LOOKBACK.WEEKLY, Math.floor(daysSinceLaunch / 7));
  return Math.min(MAX_LOOKBACK.MONTHLY, Math.floor(daysSinceLaunch / 30));
}

function previousPeriodKeys(frequency: RoutineFrequency, now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    let ref: Date;
    if (frequency === "DAILY") {
      ref = new Date(now.getTime() - i * MS_PER_DAY);
    } else if (frequency === "WEEKLY") {
      ref = new Date(now.getTime() - i * 7 * MS_PER_DAY);
    } else {
      ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    }
    keys.push(periodKeyFor(frequency, ref));
  }
  return keys;
}

/**
 * Her mağaza için rutin panosunu hesaplar. `completions` yalnız ilgili
 * mağaza(lar)ın kayıtlarını içermelidir (API katmanı STORE_USER için zaten
 * kendi mağazasına filtreler) — burada çapraz mağaza karışması olmaz.
 */
export function computeRoutineBoards(
  identities: RoutineIdentity[],
  completions: RoutineCompletionFact[],
  now: Date = new Date()
): StoreRoutineBoard[] {
  const byStore = new Map<string, Map<string, RoutineCompletionFact>>();
  for (const c of completions) {
    let m = byStore.get(c.storeCode);
    if (!m) {
      m = new Map();
      byStore.set(c.storeCode, m);
    }
    m.set(`${c.routineId}:${c.periodKey}`, c);
  }

  return identities.map((identity) => {
    const storeCompletions = byStore.get(identity.storeCode) || new Map<string, RoutineCompletionFact>();

    const groups: Record<RoutineFrequency, RoutineItemStatus[]> = { DAILY: [], WEEKLY: [], MONTHLY: [] };
    let overdueCount = 0;
    let doneCurrent = 0;
    let totalCurrent = 0;

    for (const routine of ROUTINE_CATALOG) {
      const currentPeriodKey = periodKeyFor(routine.frequency, now);
      const currentFact = storeCompletions.get(`${routine.id}:${currentPeriodKey}`) ?? null;

      totalCurrent += 1;
      if (currentFact) doneCurrent += 1;

      groups[routine.frequency].push({
        routine,
        currentPeriodKey,
        done: !!currentFact,
        completedBy: currentFact?.completedBy ?? null,
        completedAt: currentFact?.completedAt ?? null,
        note: currentFact?.note ?? null,
      });

      const lookback = effectiveLookback(routine.frequency, now);
      for (const pastKey of previousPeriodKeys(routine.frequency, now, lookback)) {
        if (!storeCompletions.has(`${routine.id}:${pastKey}`)) overdueCount += 1;
      }
    }

    return {
      storeCode: identity.storeCode,
      storeName: identity.storeName,
      status: identity.status,
      daily: groups.DAILY,
      weekly: groups.WEEKLY,
      monthly: groups.MONTHLY,
      completionRatePercent: totalCurrent > 0 ? Math.round((doneCurrent / totalCurrent) * 100) : null,
      overdueCount,
    };
  });
}
