"use client";

import {
  Activity,
  AlertTriangle,
  DollarSign,
  Package,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MorningBriefingView, OrderKpis } from "../types";

type Tone = "neutral" | "brand" | "positive" | "caution" | "danger" | "info";

const TONE: Record<Tone, { icon: string; value: string }> = {
  neutral: { icon: "bg-surface-3 text-ink-muted", value: "text-ink" },
  brand: { icon: "bg-brand/15 text-brand-soft", value: "text-ink" },
  positive: { icon: "bg-positive/15 text-positive", value: "text-positive" },
  caution: { icon: "bg-caution/15 text-caution", value: "text-caution" },
  danger: { icon: "bg-danger/15 text-danger", value: "text-danger" },
  info: { icon: "bg-info/15 text-info", value: "text-info" },
};

function Card({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          {label}
        </span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${t.icon}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className={`mt-2 font-display text-[22px] font-bold leading-none tabular ${t.value}`}>
        {value}
      </div>
      <div className="mt-1.5 truncate font-mono-tech text-[10px] text-ink-faint">{hint}</div>
    </div>
  );
}

/**
 * KPI şeridi — tüm değerler görüntülenen veriden hesaplanır.
 * Sabit "+14.2%" gibi uydurma rozetler tasarımdan kaldırıldı (F-15/F-23).
 */
export function KpiStrip({
  kpis,
  briefing,
  storeScope,
}: {
  kpis: OrderKpis;
  briefing: MorningBriefingView | null;
  storeScope: string;
}) {
  const net = Number(kpis.grossNetEst);

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card
        label={`Sipariş • ${storeScope}`}
        value={`${kpis.totalOrders}`}
        hint="Seçili filtredeki toplam"
        icon={ShoppingCart}
        tone="brand"
      />
      <Card
        label="Toplam adet"
        value={`${kpis.totalUnits}`}
        hint={`FBA sevk: ${kpis.totalShipped} • %${kpis.fulfillmentRate}`}
        icon={Package}
        tone="info"
      />
      <Card
        label="Tedarik maliyeti"
        value={`$${Number(kpis.totalSpend).toLocaleString("en-US")}`}
        hint={kpis.avgRoi === "—" ? "ROI hesaplanamıyor" : `Ortalama ROI %${kpis.avgRoi}`}
        icon={DollarSign}
        tone="caution"
      />
      <Card
        label="Tahmini ciro"
        value={`$${Number(kpis.totalRevenueEst).toLocaleString("en-US")}`}
        hint={`Net marj: $${net.toLocaleString("en-US")}`}
        icon={TrendingUp}
        tone={net >= 0 ? "positive" : "danger"}
      />
      <Card
        label="Fire & problem"
        value={`${kpis.problemCount}`}
        hint={`Tedarikçi iadesi: $${kpis.totalRefunds}`}
        icon={AlertTriangle}
        tone={kpis.problemCount > 0 ? "danger" : "positive"}
      />
      <Card
        label="İş sağlığı"
        value={briefing && briefing.healthMeasurable !== false ? `${briefing.businessHealthScore}` : "—"}
        hint={
          !briefing
            ? "Veri bekleniyor"
            : briefing.healthMeasurable === false
              ? "Ölçmek için veri yükleyin"
              : briefing.healthGrade
        }
        icon={Activity}
        tone={
          !briefing || briefing.healthMeasurable === false
            ? "neutral"
            : briefing.businessHealthScore >= 70
            ? "positive"
            : briefing.businessHealthScore >= 55
            ? "caution"
            : "danger"
        }
      />
    </section>
  );
}
