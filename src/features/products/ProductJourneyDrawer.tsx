"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  History,
  LineChart,
  Truck,
  Wallet,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Building2,
  CheckCircle2,
} from "lucide-react";
import type { ProductDetailView, ProductView } from "../types";
import {
  money,
  percent,
  shortDate,
  trendTone,
  trendLabel,
  VERDICT_TONE,
  VERDICT_LABEL,
  STAGE_LABEL,
  TONE_CLASS,
  JOURNEY_ORDER,
  journeyIndex,
} from "./productFormat";
import { clientLog } from "@/lib/clientLogger";

/**
 * Aşama 2 — Ürün Yolculuğu Çekmecesi.
 *
 * Tek ürünün TÜM hikâyesi: kimlik, fiyat serisi, tedarikçi karşılaştırması,
 * operasyon, kâr/zarar, sipariş geçmişi ve olay defteri. Ayrıca yolculuğun
 * bir sonraki durağına geçiş buradan yapılır — gerekçe zorunludur.
 */

function Section({
  title,
  icon: Icon,
  children,
  right,
}: {
  title: string;
  icon: typeof History;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-mono-tech text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          <Icon className="h-3.5 w-3.5 text-brand-soft" />
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_CLASS;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-base p-3">
      <p className="font-mono-tech text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 font-display text-lg font-bold tabular ${TONE_CLASS[tone].text}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 font-mono-tech text-[10px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Fiyat serisini bağımlılıksız, saf SVG ile çizer */
function PriceSparkline({
  series,
}: {
  series: Array<{ unitPrice: number; observedAt: string }>;
}) {
  if (series.length < 2) {
    return (
      <p className="py-6 text-center font-mono-tech text-[11px] text-ink-faint">
        Trend için en az iki fiyat gözlemi gerekir (şu an {series.length}).
      </p>
    );
  }

  const w = 560;
  const h = 120;
  const pad = 8;
  const prices = series.map((s) => s.unitPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  const pts = series.map((s, i) => {
    const x = pad + (i * (w - pad * 2)) / (series.length - 1);
    const y = pad + (h - pad * 2) * (1 - (s.unitPrice - min) / span);
    return { x, y, ...s };
  });

  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const falling = prices[prices.length - 1] < prices[0];
  const stroke = falling ? "var(--color-positive)" : "var(--color-danger)";

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Fiyat serisi: ${money(prices[0])} değerinden ${money(prices[prices.length - 1])} değerine`}
      >
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={stroke} />
        ))}
      </svg>
      <div className="flex justify-between font-mono-tech text-[10px] text-ink-faint">
        <span>
          {shortDate(series[0].observedAt)} · {money(prices[0])}
        </span>
        <span>
          {shortDate(series[series.length - 1].observedAt)} ·{" "}
          {money(prices[prices.length - 1])}
        </span>
      </div>
    </div>
  );
}

/** Yolculuk ilerleme göstergesi — dikey, olay defterinin üstünde */
function JourneyProgress({ stage }: { stage: string }) {
  const idx = journeyIndex(stage);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {JOURNEY_ORDER.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const current = i === idx;
        return (
          <span
            key={s}
            className={`rounded-md px-2 py-1 font-mono-tech text-[10px] font-bold transition ${
              current
                ? "bg-brand text-white"
                : done
                  ? "bg-brand/15 text-brand-soft"
                  : "bg-surface-3 text-ink-faint"
            }`}
          >
            {STAGE_LABEL[s]}
          </span>
        );
      })}
      {idx === -1 && (
        <span
          className={`rounded-md border px-2 py-1 font-mono-tech text-[10px] font-bold ${
            TONE_CLASS[stage === "PAUSED" ? "caution" : "danger"].chip
          }`}
        >
          {STAGE_LABEL[stage] ?? stage}
        </span>
      )}
    </div>
  );
}

export function ProductJourneyDrawer({
  product,
  canManage,
  onClose,
  onStageChanged,
}: {
  product: ProductView | null;
  canManage: boolean;
  onClose: () => void;
  onStageChanged?: () => void;
}) {
  const [detail, setDetail] = useState<ProductDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetStage, setTargetStage] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const productId = product?.id ?? null;

  const load = useCallback(async () => {
    if (!productId) return;
    // Durum sıfırlama yükleme akışının parçasıdır; effect gövdesinde
    // doğrudan setState çağırmak gereksiz bir render turu doğurur.
    setLoading(true);
    setError(null);
    setActionError(null);
    setActionOk(null);
    setReason("");
    try {
      const res = await fetch(`/api/products/${productId}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ürün detayı alınamadı");
      setDetail(data);
      setTargetStage(data?.product?.allowedNextStages?.[0]?.stage ?? "");
    } catch (e) {
      clientLog.error("products/detail", "Ürün detayı yüklenemedi", { err: String(e) });
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    // setState effect gövdesinde senkron çağrılmaz (cascading render);
    // yükleme async akışın içinde başlar — projedeki yerleşik desen.
    async function run() {
      await load();
    }
    void run();
  }, [load]);

  const submitStage = async () => {
    if (!productId || !targetStage) return;
    setSaving(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ toStage: targetStage, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Durak değiştirilemedi");
      setActionOk(data.message ?? "Durak güncellendi.");
      setReason("");
      await load();
      onStageChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  };

  if (!product) return null;

  const p = detail?.product;
  const tone = VERDICT_TONE[detail?.verdict ?? product.verdict] ?? "neutral";
  const loss = detail?.operations.lossBreakdown;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface-base shadow-2xl">
        {/* Başlık */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface-1 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-brand/15 px-2 py-1 font-mono-tech text-[10px] font-bold text-brand-soft">
                {product.asin}
              </span>
              <span
                className={`rounded-md border px-2 py-1 font-mono-tech text-[10px] font-bold ${TONE_CLASS[tone].chip}`}
              >
                {VERDICT_LABEL[detail?.verdict ?? product.verdict] ?? product.verdict}
              </span>
              {p?.isTerminal && (
                <span className="rounded-md border border-line px-2 py-1 font-mono-tech text-[10px] text-ink-faint">
                  Yolculuk sonlandı
                </span>
              )}
            </div>
            <h2 className="mt-2 truncate font-display text-lg font-bold text-ink" title={product.title}>
              {product.title}
            </h2>
            <p className="mt-0.5 font-mono-tech text-[11px] text-ink-muted">
              {product.brand}
              {p?.category ? ` · ${p.category}` : ""}
              {p?.discoveredAt ? ` · keşif ${shortDate(p.discoveredAt)}` : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {product.amazonUrl && (
              <a
                href={product.amazonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-muted transition hover:border-brand hover:text-brand-soft"
                title="Amazon'da aç"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-muted transition hover:border-danger hover:text-danger"
              aria-label="Kapat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Gövde */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 font-mono-tech text-xs text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Ürünün hikâyesi yükleniyor…
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 font-mono-tech text-xs text-danger">
              {error}
            </div>
          )}

          {detail && !loading && (
            <>
              {/* Yargı ve gerekçe */}
              <div className={`rounded-2xl border p-4 ${TONE_CLASS[tone].chip}`}>
                <p className="font-display text-sm font-bold">{detail.recommendedAction}</p>
                {detail.verdictReasons.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {detail.verdictReasons.map((r, i) => (
                      <li key={i} className="font-mono-tech text-[11px] leading-snug opacity-90">
                        • {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Kâr/zarar */}
              <Section title="Kâr / Zarar" icon={Wallet}>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat
                    label="Net Kâr"
                    value={money(detail.pnl.netProfit)}
                    tone={detail.pnl.netProfit >= 0 ? "positive" : "danger"}
                  />
                  <Stat
                    label="ROI"
                    value={percent(detail.pnl.roiPercent)}
                    tone={
                      detail.pnl.roiPercent === null
                        ? "neutral"
                        : detail.pnl.roiPercent >= 30
                          ? "positive"
                          : detail.pnl.roiPercent < 15
                            ? "caution"
                            : "neutral"
                    }
                    hint={detail.pnl.reason ? "ölçülemedi" : undefined}
                  />
                  <Stat label="Net Gelir" value={money(detail.pnl.netRevenue)} />
                  <Stat label="Toplam Maliyet" value={money(detail.operations.totalCost)} />
                </div>
              </Section>

              {/* Operasyon */}
              <Section title="Operasyonel Gerçekleşme" icon={Truck}>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat
                    label="Alınan Adet"
                    value={String(detail.operations.unitsPurchased)}
                    hint={`${detail.operations.orderCount} sipariş`}
                  />
                  <Stat
                    label="Sevk Edilen"
                    value={String(detail.operations.unitsShipped)}
                    hint={`karşılama %${detail.pnl.fulfillmentRatePercent.toFixed(0)}`}
                    tone={detail.pnl.fulfillmentRatePercent >= 75 ? "positive" : "caution"}
                  />
                  <Stat
                    label="Fire"
                    value={String(detail.operations.unitsLost)}
                    hint={`%${detail.pnl.lossRatePercent.toFixed(0)} kayıp`}
                    tone={detail.pnl.lossRatePercent > 25 ? "danger" : "neutral"}
                  />
                  <Stat
                    label="Tedarikçi İadesi"
                    value={money(detail.operations.totalRefunds)}
                    tone={detail.operations.totalRefunds > 0 ? "caution" : "neutral"}
                  />
                </div>

                {loss && detail.operations.unitsLost > 0 && (
                  <div className="mt-3 rounded-xl border border-line bg-surface-base p-3">
                    <p className="mb-2 flex items-center gap-1.5 font-mono-tech text-[10px] uppercase tracking-wider text-ink-faint">
                      <AlertTriangle className="h-3 w-3 text-caution" />
                      Fire nedenleri — “%X fire” yetmez, sebebi gerekir
                    </p>
                    <div className="grid grid-cols-2 gap-2 font-mono-tech text-[11px] lg:grid-cols-4">
                      <span className="text-ink-muted">
                        P1 iptal: <b className="text-ink">{loss.p1Cancel}</b>
                      </span>
                      <span className="text-ink-muted">
                        P2 eksik: <b className="text-ink">{loss.p2Missing}</b>
                      </span>
                      <span className="text-ink-muted">
                        P3 defolu: <b className="text-ink">{loss.p3Defective}</b>
                      </span>
                      <span className="text-ink-muted">
                        P4 tarihi geçmiş: <b className="text-ink">{loss.p4Expired}</b>
                      </span>
                    </div>
                  </div>
                )}
              </Section>

              {/* Fiyat serisi */}
              <Section
                title="Tedarikçi Fiyat Serisi"
                icon={LineChart}
                right={
                  <span
                    className={`font-mono-tech text-[11px] font-bold ${
                      TONE_CLASS[trendTone(detail.priceTrend.direction, detail.priceTrend.isBuyingOpportunity)].text
                    }`}
                  >
                    {trendLabel(detail.priceTrend.direction)} · {percent(detail.priceTrend.changePercent)}
                  </span>
                }
              >
                <PriceSparkline series={detail.priceSeries} />

                {detail.suppliers.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 flex items-center gap-1.5 font-mono-tech text-[10px] uppercase tracking-wider text-ink-faint">
                      <Building2 className="h-3 w-3" />
                      Tedarikçi karşılaştırması — en ucuzdan pahalıya
                    </p>
                    <table className="w-full font-mono-tech text-[11px]">
                      <thead className="text-ink-faint">
                        <tr className="border-b border-line">
                          <th className="py-1.5 text-left">Tedarikçi</th>
                          <th className="py-1.5 text-right">Gözlem</th>
                          <th className="py-1.5 text-right">En düşük</th>
                          <th className="py-1.5 text-right">En yüksek</th>
                          <th className="py-1.5 text-right">Son</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {detail.suppliers.map((s, i) => (
                          <tr key={s.supplierName}>
                            <td className="py-1.5 text-ink">
                              {s.supplierName}
                              {i === 0 && detail.suppliers.length > 1 && (
                                <span className="ml-1.5 rounded bg-positive/20 px-1 text-[9px] text-positive">
                                  EN UYGUN
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular text-ink-muted">{s.count}</td>
                            <td className="py-1.5 text-right tabular text-ink-muted">{money(s.min)}</td>
                            <td className="py-1.5 text-right tabular text-ink-muted">{money(s.max)}</td>
                            <td className="py-1.5 text-right tabular font-bold text-ink">
                              {money(s.last)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {/* Yolculuk ve durak değiştirme */}
              <Section title="Ürün Yolculuğu" icon={ArrowRight}>
                <JourneyProgress stage={product.lifecycleStage} />

                {canManage ? (
                  p?.allowedNextStages?.length ? (
                    <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface-base p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="font-mono-tech text-[10px] uppercase tracking-wider text-ink-faint">
                          Sonraki durak
                        </label>
                        <select
                          value={targetStage}
                          onChange={(e) => setTargetStage(e.target.value)}
                          className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 font-mono-tech text-xs font-bold text-brand-soft focus:border-brand focus:outline-none"
                        >
                          {p.allowedNextStages.map((s) => (
                            <option key={s.stage} value={s.stage}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Gerekçe zorunlu — aylar sonra bu kararı okuyacak kişi için yazın"
                        className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono-tech text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
                      />

                      {actionError && (
                        <p className="font-mono-tech text-[11px] text-danger">{actionError}</p>
                      )}
                      {actionOk && (
                        <p className="flex items-center gap-1.5 font-mono-tech text-[11px] text-positive">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {actionOk}
                        </p>
                      )}

                      <button
                        onClick={submitStage}
                        disabled={saving || reason.trim().length < 3}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 font-mono-tech text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowRight className="h-3.5 w-3.5" />
                        )}
                        Durağa taşı
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 font-mono-tech text-[11px] text-ink-faint">
                      Bu durak sonlandırıcıdır; ileri bir geçiş tanımlı değil.
                    </p>
                  )
                ) : (
                  <p className="mt-3 font-mono-tech text-[11px] text-ink-faint">
                    Durak değiştirme yetkisi yöneticilere aittir.
                  </p>
                )}
              </Section>

              {/* Olay defteri */}
              <Section
                title="Olay Defteri — Cerberus'un Hafızası"
                icon={History}
                right={
                  <span className="font-mono-tech text-[10px] text-ink-faint">
                    {detail.timeline.length} kayıt
                  </span>
                }
              >
                {detail.timeline.length === 0 ? (
                  <p className="py-4 text-center font-mono-tech text-[11px] text-ink-faint">
                    Henüz olay kaydı yok.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {detail.timeline.map((e) => (
                      <li
                        key={e.id}
                        className="rounded-xl border border-line bg-surface-base p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {e.fromLabel && (
                            <>
                              <span className="font-mono-tech text-[10px] text-ink-faint">
                                {e.fromLabel}
                              </span>
                              <ArrowRight className="h-3 w-3 text-ink-faint" />
                            </>
                          )}
                          <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono-tech text-[10px] font-bold text-brand-soft">
                            {e.toLabel}
                          </span>
                          <span className="ml-auto font-mono-tech text-[10px] text-ink-faint">
                            {shortDate(e.occurredAt)}
                          </span>
                        </div>
                        {e.reason && (
                          <p className="mt-1.5 font-mono-tech text-[11px] leading-snug text-ink">
                            {e.reason}
                          </p>
                        )}
                        <p className="mt-1 font-mono-tech text-[10px] text-ink-faint">
                          {e.actorName}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              {/* Sipariş geçmişi */}
              <Section
                title="Sipariş Geçmişi"
                icon={Truck}
                right={
                  <span className="font-mono-tech text-[10px] text-ink-faint">
                    {detail.orders.length} sipariş
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full font-mono-tech text-[11px]">
                    <thead className="text-ink-faint">
                      <tr className="border-b border-line">
                        <th className="py-1.5 text-left">Sipariş</th>
                        <th className="py-1.5 text-left">Tarih</th>
                        <th className="py-1.5 text-right">Adet</th>
                        <th className="py-1.5 text-right">Sevk</th>
                        <th className="py-1.5 text-right">Birim</th>
                        <th className="py-1.5 text-left">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {detail.orders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-1.5 text-brand-soft">{o.orderNumber}</td>
                          <td className="py-1.5 text-ink-muted">{shortDate(o.orderDate)}</td>
                          <td className="py-1.5 text-right tabular text-ink">{o.quantity}</td>
                          <td className="py-1.5 text-right tabular text-ink-muted">
                            {o.shippedToAmazon}
                          </td>
                          <td className="py-1.5 text-right tabular text-ink-muted">
                            {money(o.unitCost)}
                          </td>
                          <td className="py-1.5 text-ink-muted">{o.cargoStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
