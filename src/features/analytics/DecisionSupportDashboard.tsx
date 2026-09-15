"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, DollarSign, Package, Truck, RefreshCw } from "lucide-react";

interface Kpis {
  totalOrders: number; totalUnits: number; totalSpend: number; totalShipped: number; fulfillmentRate: number;
  totalRefunds: number; refundRate: number; netRevenue: number; grossProfit: number; avgUnitCost: number;
  problemRate: number; p1: number; p2: number; p3: number; p4: number; unbatchedCount: number; inTransitCount: number;
}
interface TrendPoint { period: string; orders: number; units: number; spend: number; shipped: number; refunds: number; netProfit: number; }
interface StoreComparison { storeCode: string; orders: number; units: number; spend: number; shippedRate: number; problemRate: number; refunds: number; }
interface OppItem { asin: string; title: string; firstPrice: number | null; latestPrice: number | null; changePercent: number | null; }
interface PnlItem { asin: string; title: string; netProfit: number; roi: number | null; fulfillmentRate: number; }
interface AlertItem { severity: string; text: string; metric: string; }

interface AnalyticsData {
  kpis: Kpis;
  trend: TrendPoint[];
  storeComparison: StoreComparison[];
  opportunities: { buying: OppItem[]; all: OppItem[]; total: number; buyingCount: number };
  pnl: { topProfitable: PnlItem[]; topLossmaking: PnlItem[] };
  alerts: AlertItem[];
  sample: { orders: number; products: number; offers: number };
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} /></div>;
}

export function DecisionSupportDashboard({ storeCode }: { storeCode: string }) {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/analytics/decision-support?storeCode=${encodeURIComponent(storeCode)}&period=${period}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Analitik yüklenemedi");
      setData(j as AnalyticsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [storeCode, period]);

  if (loading) {
    return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-soft" /><span className="mt-2 text-xs font-mono-tech text-ink-faint">Karar destek hesaplanıyor…</span></div>;
  }
  if (error) {
    return <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"><AlertTriangle className="h-4 w-4 shrink-0" />{error}<button onClick={load} className="ml-auto rounded bg-danger/20 px-3 py-1 text-xs font-bold hover:bg-danger/30">Tekrar dene</button></div>;
  }
  if (!data) return null;

  const { kpis, trend, storeComparison, opportunities, pnl, alerts } = data;
  const maxSpend = Math.max(...trend.map((t: TrendPoint) => t.spend), 1);
  const maxProfit = Math.max(...trend.map((t: TrendPoint) => Math.abs(t.netProfit)), 1);

  return (
    <div className="space-y-5">
      {/* Kontroller */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink">Karar Destek Analitik</h2>
          <p className="text-xs text-ink-muted font-mono-tech">Yüklenen verilerden canlı hesap — XLS’ten kurtuluşun ispatı. {data.sample.orders} sipariş • {data.sample.products} ürün • {data.sample.offers} fiyat gözlemi</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface-1 p-1">
            {(["7d", "30d", "90d", "all"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${period === p ? "bg-brand text-white" : "text-ink-muted hover:text-ink"}`}>{p === "all" ? "Tümü" : p}</button>
            ))}
          </div>
          <button onClick={load} className="rounded-xl border border-line bg-surface-1 p-2 text-ink-muted hover:text-ink"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      {/* KPI şeridi */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint flex items-center gap-1"><DollarSign className="h-3 w-3" /> Net Kâr</div>
          <div className={`mt-1 text-lg font-bold tabular ${kpis.grossProfit >= 0 ? "text-positive" : "text-danger"}`}>${kpis.grossProfit.toLocaleString("tr-TR")}</div>
          <div className="text-[11px] font-mono-tech text-ink-faint">Gelir ${kpis.netRevenue.toLocaleString("tr-TR")} • Harcama ${kpis.totalSpend.toLocaleString("tr-TR")}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint flex items-center gap-1"><Package className="h-3 w-3" /> Sipariş / Adet</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{kpis.totalOrders} <span className="text-sm font-normal text-ink-muted">/ {kpis.totalUnits}</span></div>
          <div className="text-[11px] font-mono-tech text-ink-faint">Ort. birim ${kpis.avgUnitCost}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint flex items-center gap-1"><Truck className="h-3 w-3" /> FBA Sevk</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">%{kpis.fulfillmentRate}</div>
          <MiniBar value={kpis.fulfillmentRate} max={100} color={kpis.fulfillmentRate >= 85 ? "#34D399" : kpis.fulfillmentRate >= 60 ? "#FBBF24" : "#FB7185"} />
          <div className="text-[11px] font-mono-tech text-ink-faint">{kpis.totalShipped} sevkedildi • {kpis.unbatchedCount} batch’siz</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Fire & Problem</div>
          <div className="mt-1 text-lg font-bold tabular text-danger">%{kpis.problemRate}</div>
          <MiniBar value={kpis.problemRate} max={100} color={kpis.problemRate > 20 ? "#FB7185" : kpis.problemRate > 10 ? "#FBBF24" : "#34D399"} />
          <div className="text-[11px] font-mono-tech text-ink-faint">P1 {kpis.p1} • P2 {kpis.p2} • P3 {kpis.p3} • P4 {kpis.p4}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Tedarikçi İadesi</div>
          <div className="mt-1 text-lg font-bold tabular text-caution">${kpis.totalRefunds.toLocaleString("tr-TR")}</div>
          <div className="text-[11px] font-mono-tech text-ink-faint">Harcamanın %{kpis.refundRate} kadarı geri kazanıldı</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Fırsat Sinyali</div>
          <div className="mt-1 text-lg font-bold tabular text-positive">{opportunities.buyingCount}</div>
          <div className="text-[11px] font-mono-tech text-ink-faint">{opportunities.total} ürün izleniyor • fiyat düşenler</div>
        </div>
      </div>

      {/* Trend grafikleri (basit SVG çubuklar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="text-xs font-bold text-ink">Harcama Trendi ({period})</div>
          <div className="mt-3 flex items-end gap-1 h-24">
            {trend.length ? trend.map((t: TrendPoint) => (
              <div key={t.period} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t bg-caution/70" style={{ height: `${Math.max(4, (t.spend / maxSpend) * 80)}px` }} title={`${t.period}: $${t.spend.toFixed(0)}`} />
                <span className="text-[9px] font-mono-tech text-ink-faint truncate w-full text-center">{t.period.slice(5)}</span>
              </div>
            )) : <span className="text-xs text-ink-faint">Veri yok</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="text-xs font-bold text-ink">Net Kâr Trendi</div>
          <div className="mt-3 flex items-end gap-1 h-24">
            {trend.length ? trend.map((t: TrendPoint) => (
              <div key={t.period} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full rounded-t ${t.netProfit >= 0 ? "bg-positive/70" : "bg-danger/70"}`} style={{ height: `${Math.max(4, (Math.abs(t.netProfit) / maxProfit) * 80)}px` }} title={`${t.period}: $${t.netProfit.toFixed(0)}`} />
                <span className="text-[9px] font-mono-tech text-ink-faint truncate w-full text-center">{t.period.slice(5)}</span>
              </div>
            )) : <span className="text-xs text-ink-faint">Veri yok</span>}
          </div>
        </div>
      </div>

      {/* Mağaza kıyas + PnL */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-4 xl:col-span-2">
          <div className="text-xs font-bold text-ink">Mağaza Kıyaslama</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[11px] font-mono-tech text-ink-faint uppercase">
                <tr><th className="text-left py-2">Mağaza</th><th className="text-right">Sipariş</th><th className="text-right">Harcama</th><th className="text-right">Sevk %</th><th className="text-right">Problem %</th><th className="text-right">Refund</th></tr>
              </thead>
              <tbody className="font-mono-tech">
                {storeComparison.map((s: StoreComparison) => (
                  <tr key={s.storeCode} className="border-t border-line/60">
                    <td className="py-2 font-bold text-brand-soft">{s.storeCode}</td>
                    <td className="text-right text-ink">{s.orders}</td>
                    <td className="text-right text-caution tabular">${s.spend.toLocaleString("tr-TR")}</td>
                    <td className={`text-right ${s.shippedRate >= 85 ? "text-positive" : s.shippedRate >= 60 ? "text-caution" : "text-danger"}`}>%{s.shippedRate}</td>
                    <td className={`text-right ${s.problemRate > 20 ? "text-danger" : s.problemRate > 10 ? "text-caution" : "text-positive"}`}>%{s.problemRate}</td>
                    <td className="text-right text-ink-faint">${s.refunds}</td>
                  </tr>
                ))}
                {!storeComparison.length && <tr><td colSpan={6} className="py-6 text-center text-ink-faint">Mağaza verisi yok</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-positive/20 bg-surface-1 p-4">
            <div className="text-xs font-bold text-positive flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> En Kârlı 5 Ürün</div>
            <div className="mt-2 space-y-2">
              {pnl.topProfitable.length ? pnl.topProfitable.map((p: PnlItem) => (
                <div key={p.asin} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ink">{p.title.slice(0, 42)}</div>
                    <div className="font-mono-tech text-[11px] text-ink-faint">{p.asin} • %{p.fulfillmentRate} sevk</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-positive tabular">+${p.netProfit.toFixed(0)}</div>
                    <div className="text-[11px] font-mono-tech text-ink-faint">{p.roi !== null ? `%${p.roi} ROI` : "—"}</div>
                  </div>
                </div>
              )) : <div className="text-xs text-ink-faint">Kârlı ürün yok</div>}
            </div>
          </div>
          <div className="rounded-2xl border border-danger/20 bg-surface-1 p-4">
            <div className="text-xs font-bold text-danger flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> Zararda 5 Ürün</div>
            <div className="mt-2 space-y-2">
              {pnl.topLossmaking.length ? pnl.topLossmaking.map((p: PnlItem) => (
                <div key={p.asin} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ink">{p.title.slice(0, 42)}</div>
                    <div className="font-mono-tech text-[11px] text-ink-faint">{p.asin}</div>
                  </div>
                  <div className="text-sm font-bold text-danger tabular">${p.netProfit.toFixed(0)}</div>
                </div>
              )) : <div className="text-xs text-ink-faint">Zararda ürün yok — iyi!</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Fırsatlar + Alarmlar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-positive/20 bg-surface-1 p-4">
          <div className="text-xs font-bold text-positive">Fiyatı Düşen Fırsatlar (Keepa benzeri)</div>
          <div className="text-[11px] font-mono-tech text-ink-faint">supplier_offers zaman serisinden — %5+ düşüş arbitraj sinyali</div>
          <div className="mt-3 space-y-2">
            {opportunities.buying.length ? opportunities.buying.map((o: OppItem) => (
              <div key={o.asin} className="flex items-center justify-between rounded-lg border border-positive/20 bg-positive/5 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-ink">{o.title.slice(0, 48)}</div>
                  <div className="font-mono-tech text-[11px] text-ink-faint">{o.asin} • {o.firstPrice !== null ? `$${o.firstPrice}` : "—"} → {o.latestPrice !== null ? `$${o.latestPrice}` : "—"}</div>
                </div>
                <span className="shrink-0 rounded-full bg-positive px-2 py-1 text-xs font-bold text-white">{o.changePercent !== null ? `${o.changePercent}%` : "—"}</span>
              </div>
            )) : <div className="text-xs text-ink-faint">Şu an fırsat sinyali yok — veri biriktikçe burada görünecek.</div>}
          </div>
        </div>
        <div className="rounded-2xl border border-caution/20 bg-surface-1 p-4">
          <div className="text-xs font-bold text-caution">Aksiyon Alarmları</div>
          <div className="mt-3 space-y-2">
            {alerts.map((a: AlertItem, i: number) => (
              <div key={i} className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${a.severity === "CRITICAL" ? "border-danger/30 bg-danger/10 text-danger" : a.severity === "WARN" ? "border-caution/30 bg-caution/10 text-caution" : "border-line bg-surface-2 text-ink-muted"}`}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{a.text}</span>
                <span className="font-mono-tech text-[10px] opacity-60">{a.metric}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-[11px] font-mono-tech text-ink-faint">
        <span className="font-bold text-ink-muted">Not:</span> Tüm metrikler canlı DB aggregate’tan hesaplanır; XLS’te filtre/pivot yapmaya gerek kalmaz. Mağaza izolasyonu sunucuda zorlanır — STORE_USER yalnızca kendi mağazasını görür.
      </div>
    </div>
  );
}
