"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw, HeartPulse } from "lucide-react";

interface WeekMetrics {
  weekKey: string;
  orders: number;
  units: number;
  spend: number;
  shippedUnits: number;
  refundAmount: number;
  netProfit: number;
  fulfillmentRate: number | null;
  problemRate: number | null;
  refundRate: number | null;
}
interface WeekOverWeekDelta {
  ordersDeltaPercent: number;
  spendDeltaPercent: number;
  fulfillmentRateDeltaPoints: number | null;
  problemRateDeltaPoints: number | null;
}
interface HealthBreakdownItem {
  axis: string;
  weight: number;
  score: number;
  detail: string;
}
interface SilenceAlert {
  severity: "INFO" | "WARN" | "CRITICAL";
  text: string;
  daysSinceLastOrder: number | null;
}
interface StoreWeeklyHealth {
  storeCode: string;
  storeName: string;
  status: string;
  currentWeek: WeekMetrics;
  previousWeek: WeekMetrics;
  weekOverWeek: WeekOverWeekDelta | null;
  isActiveThisWeek: boolean;
  healthScore: number | null;
  grade: string;
  breakdown: HealthBreakdownItem[];
  silenceAlert: SilenceAlert | null;
}
interface StoreHealthData {
  generatedAt: string;
  storeScope: string;
  stores: StoreWeeklyHealth[];
  summary: { totalStores: number; activeThisWeek: number; criticalSilence: number; measured: number };
}

const GRADE_TONE: Record<string, string> = {
  GÜÇLÜ: "text-positive border-positive/30 bg-positive/10",
  İYİ: "text-positive border-positive/30 bg-positive/10",
  İZLEMEDE: "text-caution border-caution/30 bg-caution/10",
  ZAYIF: "text-caution border-caution/30 bg-caution/10",
  KRİTİK: "text-danger border-danger/30 bg-danger/10",
  ÖLÇÜLEMEDİ: "text-ink-faint border-line bg-surface-2",
};

function DeltaBadge({ value, suffix = "%", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value === null) return <span className="text-ink-faint text-[11px] font-mono-tech">yeni</span>;
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value === 0 ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-mono-tech ${good ? "text-positive" : "text-danger"}`}>
      <Icon className="h-3 w-3" />
      {value > 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="text-xs font-bold text-ink tabular">{value}</div>
    </div>
  );
}

export function StoreHealthScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StoreHealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/store-health", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Mağaza sağlığı yüklenemedi");
      setData(j as StoreHealthData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-soft" />
        <span className="mt-2 text-xs font-mono-tech text-ink-faint">Haftalık mağaza sağlığı hesaplanıyor…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {error}
        <button onClick={load} className="ml-auto rounded bg-danger/20 px-3 py-1 text-xs font-bold hover:bg-danger/30">
          Tekrar dene
        </button>
      </div>
    );
  }
  if (!data) return null;

  const { stores, summary } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-brand-soft" /> Haftalık Mağaza/Hesap Sağlığı
          </h2>
          <p className="text-xs text-ink-muted font-mono-tech">
            Gerçek sipariş verisinden bu hafta/geçen hafta kıyası — sipariş yoksa skor uydurulmaz, &quot;Ölçülemedi&quot; gösterilir.
          </p>
        </div>
        <button onClick={load} className="rounded-xl border border-line bg-surface-1 p-2 text-ink-muted hover:text-ink">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Toplam Mağaza</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{summary.totalStores}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Bu Hafta Aktif</div>
          <div className="mt-1 text-lg font-bold tabular text-positive">{summary.activeThisWeek}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Ölçülen Skor</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{summary.measured}</div>
        </div>
        <div className="rounded-2xl border border-danger/20 bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Kritik Sessizlik</div>
          <div className={`mt-1 text-lg font-bold tabular ${summary.criticalSilence > 0 ? "text-danger" : "text-ink"}`}>
            {summary.criticalSilence}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {stores.map((s) => (
          <div key={s.storeCode} className="rounded-2xl border border-line bg-surface-1 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono-tech text-sm font-bold text-brand-soft">{s.storeCode}</span>
                <span className="text-xs text-ink-muted">{s.storeName}</span>
                {s.status !== "ACTIVE" && (
                  <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-faint">PASİF</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${GRADE_TONE[s.grade] || GRADE_TONE.ÖLÇÜLEMEDİ}`}>
                  {s.healthScore !== null ? `${s.healthScore} / 100 · ${s.grade}` : s.grade}
                </span>
                <button
                  onClick={() => setExpanded(expanded === s.storeCode ? null : s.storeCode)}
                  className="text-[11px] font-mono-tech text-ink-faint hover:text-ink"
                >
                  {expanded === s.storeCode ? "kapat" : "kırılım"}
                </button>
              </div>
            </div>

            {s.silenceAlert && (
              <div
                className={`mt-3 flex gap-2 rounded-lg border px-3 py-2 text-xs ${
                  s.silenceAlert.severity === "CRITICAL"
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : s.silenceAlert.severity === "WARN"
                      ? "border-caution/30 bg-caution/10 text-caution"
                      : "border-line bg-surface-2 text-ink-muted"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{s.silenceAlert.text}</span>
              </div>
            )}

            {s.isActiveThisWeek && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Metric label="Sipariş (bu hafta)" value={`${s.currentWeek.orders}`} />
                  <DeltaBadge value={s.weekOverWeek?.ordersDeltaPercent ?? null} />
                </div>
                <div>
                  <Metric label="FBA Sevk" value={s.currentWeek.fulfillmentRate !== null ? `%${s.currentWeek.fulfillmentRate}` : "—"} />
                  <DeltaBadge value={s.weekOverWeek?.fulfillmentRateDeltaPoints ?? null} suffix="p" />
                </div>
                <div>
                  <Metric label="Problem Oranı" value={s.currentWeek.problemRate !== null ? `%${s.currentWeek.problemRate}` : "—"} />
                  <DeltaBadge value={s.weekOverWeek?.problemRateDeltaPoints ?? null} suffix="p" invert />
                </div>
                <div>
                  <Metric label="Net Kâr (bu hafta)" value={`$${s.currentWeek.netProfit.toLocaleString("tr-TR")}`} />
                  <DeltaBadge value={s.weekOverWeek?.spendDeltaPercent ?? null} invert />
                </div>
              </div>
            )}

            {expanded === s.storeCode && s.breakdown.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                {s.breakdown.map((b) => (
                  <div key={b.axis} className="flex items-center justify-between gap-2 text-[11px] font-mono-tech">
                    <span className="text-ink-muted">
                      {b.axis} <span className="text-ink-faint">(%{Math.round(b.weight * 100)})</span>
                    </span>
                    <span className="text-ink-faint">{b.detail}</span>
                    <span className={`font-bold ${b.score >= 70 ? "text-positive" : b.score >= 40 ? "text-caution" : "text-danger"}`}>
                      {b.score}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!stores.length && <div className="text-xs text-ink-faint">Mağaza yok</div>}
      </div>

      <div className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-[11px] font-mono-tech text-ink-faint">
        <span className="font-bold text-ink-muted">Not:</span> Hafta anahtarı ISO 8601 (Pazartesi–Pazar), sistem saatine göre hesaplanır.
        Bir mağazada bu hafta sipariş yoksa skor &quot;Ölçülemedi&quot; olur ve sessizlik gün sayısı ayrıca raporlanır — eski sabit 98
        varsayılan &quot;hesap sağlığı&quot; alanının yerini bu canlı hesap aldı.
      </div>
    </div>
  );
}
