/**
 * CERBERUS — Ürün Zekâsı (Product Intelligence)
 *
 * Ürün merkezli modelin asıl kazancı burada somutlaşır: artık "bu üründen
 * ne kazandık, yolculuğun neresindeyiz, devam etmeli miyiz?" sorularının
 * tek bir yerde hesaplanmış cevabı var.
 *
 * Saf fonksiyonlar — veritabanına bağlı değil, tam test edilebilir.
 */

/** Ürünün yolculuğundaki duraklar (kullanıcının tarif ettiği akış) */
export const LIFECYCLE_STAGES = [
  "DISCOVERED",
  "ANALYZING",
  "SCORED",
  "APPROVED",
  "REJECTED",
  "PURCHASING",
  "IN_WAREHOUSE",
  "LISTED",
  "SELLING",
  "MONITORING",
  "PAUSED",
  "DISCONTINUED",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Her durağın Türkçe adı ve sıradaki doğal adımı */
export const STAGE_META: Record<
  LifecycleStage,
  { label: string; next: LifecycleStage[]; isTerminal: boolean }
> = {
  DISCOVERED: { label: "Keşfedildi", next: ["ANALYZING", "REJECTED"], isTerminal: false },
  ANALYZING: { label: "Analiz ediliyor", next: ["SCORED", "REJECTED"], isTerminal: false },
  SCORED: { label: "Puanlandı", next: ["APPROVED", "REJECTED"], isTerminal: false },
  APPROVED: { label: "Onaylandı", next: ["PURCHASING", "PAUSED"], isTerminal: false },
  REJECTED: { label: "Reddedildi", next: ["ANALYZING"], isTerminal: true },
  PURCHASING: { label: "Satın alınıyor", next: ["IN_WAREHOUSE", "PAUSED"], isTerminal: false },
  IN_WAREHOUSE: { label: "Depoda", next: ["LISTED", "PAUSED"], isTerminal: false },
  LISTED: { label: "Listelendi", next: ["SELLING", "PAUSED"], isTerminal: false },
  SELLING: { label: "Satışta", next: ["MONITORING", "PAUSED"], isTerminal: false },
  MONITORING: { label: "İzleniyor", next: ["SELLING", "PAUSED", "DISCONTINUED"], isTerminal: false },
  PAUSED: { label: "Durduruldu", next: ["SELLING", "DISCONTINUED"], isTerminal: false },
  DISCONTINUED: { label: "Sonlandırıldı", next: [], isTerminal: true },
};

/** Bir durak geçişinin kurallara uygun olup olmadığı */
export function isValidTransition(from: LifecycleStage, to: LifecycleStage): boolean {
  return STAGE_META[from]?.next.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Ürün kâr/zarar özeti
// ---------------------------------------------------------------------------

export interface ProductPnlInput {
  orderCount: number;
  unitsPurchased: number;
  unitsShipped: number;
  unitsLost: number;
  totalCost: number;
  grossRevenue: number;
  totalRefunds: number;
}

export interface ProductPnl {
  /** Bu şemada müşteri satış iadesi tutulmadığı için sevk kaynaklı brüt gelir */
  netRevenue: number;
  /** Tedarikçinin karta yaptığı refund mahsup edildikten sonraki maliyet */
  netCost: number;
  netProfit: number;
  roiPercent: number | null;
  /** Satın alınan adetin yüzde kaçı fire oldu */
  lossRatePercent: number;
  /** Satın alınan adetin yüzde kaçı fiilen sevk edildi */
  fulfillmentRatePercent: number;
  /** Sermayenin yüzde kaçı iade olarak geri gitti */
  refundRatePercent: number;
  /** Ölçülemiyorsa sebebi */
  reason?: "NO_ORDERS" | "NOTHING_SHIPPED" | "ZERO_COST";
}

const r2 = (n: number) => Number(n.toFixed(2));

export function computeProductPnl(input: ProductPnlInput): ProductPnl {
  const {
    orderCount,
    unitsPurchased,
    unitsShipped,
    unitsLost,
    totalCost,
    grossRevenue,
    totalRefunds,
  } = input;

  // `refundAmount` kilitli sipariş şemasında tedarikçinin ödeme kartına
  // yaptığı geri ödemedir. Müşteri satış iadesi olmadığı için gelirden değil
  // maliyetten mahsup edilir.
  const netRevenue = Math.max(0, grossRevenue);
  const netCost = Math.max(0, totalCost - totalRefunds);
  const netProfit = r2(netRevenue - netCost);

  const base: ProductPnl = {
    netRevenue: r2(netRevenue),
    netCost: r2(netCost),
    netProfit,
    roiPercent: null,
    lossRatePercent: unitsPurchased > 0 ? r2((unitsLost / unitsPurchased) * 100) : 0,
    fulfillmentRatePercent:
      unitsPurchased > 0 ? r2((unitsShipped / unitsPurchased) * 100) : 0,
    refundRatePercent: totalCost > 0 ? r2((totalRefunds / totalCost) * 100) : 0,
  };

  if (orderCount === 0) return { ...base, reason: "NO_ORDERS" };
  if (unitsShipped === 0) return { ...base, reason: "NOTHING_SHIPPED" };
  if (netCost <= 0) return { ...base, reason: "ZERO_COST" };

  return { ...base, roiPercent: r2((netProfit / netCost) * 100) };
}

// ---------------------------------------------------------------------------
// Ürün sağlığı ve eylem önerisi
// ---------------------------------------------------------------------------

export type ProductVerdict =
  | "SCALE_UP"
  | "HEALTHY"
  | "WATCH"
  | "FIX_OPERATIONS"
  | "STOP_LOSS"
  | "UNMEASURED";

export interface ProductHealthInput extends ProductPnlInput {
  priceTrendPercent?: number | null;
  lifecycleStage: LifecycleStage;
}

export interface ProductHealth {
  verdict: ProductVerdict;
  /** Kararı tetikleyen gerekçeler — sırayla, en önemlisi başta */
  reasons: string[];
  /** Yöneticiye önerilen somut eylem */
  recommendedAction: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  pnl: ProductPnl;
}

/**
 * Ürünün devam edip etmeyeceğine dair yargı.
 *
 * Kural sırası kasıtlıdır: önce PARA KAYBI, sonra OPERASYON, sonra BÜYÜME.
 * Zarar eden bir ürünün "fiyatı düştü, daha al" tavsiyesi almasını
 * engellemek için sıralama bu şekilde kilitlenmiştir.
 */
export function assessProductHealth(input: ProductHealthInput): ProductHealth {
  const pnl = computeProductPnl(input);
  const reasons: string[] = [];

  // Henüz ölçülemiyorsa yargı üretme — uydurma sinyal en tehlikelisidir.
  if (pnl.reason) {
    const label =
      pnl.reason === "NO_ORDERS"
        ? "Bu ürüne ait sipariş yok."
        : pnl.reason === "NOTHING_SHIPPED"
          ? "Henüz Amazon'a sevkiyat yapılmadı; kâr ölçülemez."
          : "Maliyet kaydı yok; ROI hesaplanamaz.";
    return {
      verdict: "UNMEASURED",
      reasons: [label],
      recommendedAction:
        pnl.reason === "NOTHING_SHIPPED"
          ? "Sevkiyatı tamamlayın; ölçüm ilk satışla başlar."
          : "Veri girişini tamamlayın.",
      severity: "INFO",
      pnl,
    };
  }

  const roi = pnl.roiPercent ?? 0;

  // --- 1) Para kaybı: her şeyin önünde gelir ---
  if (pnl.netProfit < 0) {
    reasons.push(`Net zarar: $${Math.abs(pnl.netProfit).toFixed(2)}`);
    if (pnl.refundRatePercent > 50) {
      reasons.push(`Harcamanın %${pnl.refundRatePercent.toFixed(0)}'i iade olarak geri döndü`);
    }
    if (pnl.lossRatePercent > 50) {
      reasons.push(`Alınan adetin %${pnl.lossRatePercent.toFixed(0)}'i fire oldu`);
    }
    return {
      verdict: "STOP_LOSS",
      reasons,
      recommendedAction:
        "Yeni alımı durdurun. Tedarikçi ve iade sebebini inceleyin; kök neden bulunmadan tekrar sipariş vermeyin.",
      severity: "CRITICAL",
      pnl,
    };
  }

  // --- 2) Operasyonel kayıp: kâr var ama sızıntı yüksek ---
  if (pnl.lossRatePercent > 25) {
    reasons.push(`Fire oranı %${pnl.lossRatePercent.toFixed(0)} — kabul edilebilir eşiğin üstünde`);
    if (pnl.fulfillmentRatePercent < 60) {
      reasons.push(`Sevk oranı yalnızca %${pnl.fulfillmentRatePercent.toFixed(0)}`);
    }
    return {
      verdict: "FIX_OPERATIONS",
      reasons,
      recommendedAction:
        "Ürün kârlı ama fire yüksek. Depo sayımını ve tedarikçi paketleme kalitesini denetleyin.",
      severity: "WARN",
      pnl,
    };
  }

  // --- 3) Marj zayıf ---
  if (roi < 15) {
    reasons.push(`ROI %${roi.toFixed(1)} — hedefin belirgin altında`);
    return {
      verdict: "WATCH",
      reasons,
      recommendedAction:
        "Marj dar. Satış fiyatını gözden geçirin veya daha ucuz tedarik kaynağı arayın.",
      severity: "WARN",
      pnl,
    };
  }

  // --- 4) Büyüme fırsatı: sağlıklı ürün + maliyet düşüyor ---
  const trend = input.priceTrendPercent ?? null;
  if (roi >= 30 && trend !== null && trend <= -5) {
    reasons.push(`ROI %${roi.toFixed(1)} ve tedarikçi maliyeti %${Math.abs(trend).toFixed(1)} düştü`);
    return {
      verdict: "SCALE_UP",
      reasons,
      recommendedAction:
        "Kârlı ürünün maliyeti düşüyor — arbitraj penceresi açık. Sipariş miktarını artırmayı değerlendirin.",
      severity: "INFO",
      pnl,
    };
  }

  reasons.push(`ROI %${roi.toFixed(1)}, fire %${pnl.lossRatePercent.toFixed(0)}`);
  return {
    verdict: "HEALTHY",
    reasons,
    recommendedAction: "Mevcut tedarik ritmini sürdürün.",
    severity: "INFO",
    pnl,
  };
}

/** Yargıların arayüzde gösterilecek Türkçe karşılığı */
export const VERDICT_META: Record<
  ProductVerdict,
  { label: string; tone: "positive" | "caution" | "danger" | "neutral" }
> = {
  SCALE_UP: { label: "Büyüt", tone: "positive" },
  HEALTHY: { label: "Sağlıklı", tone: "positive" },
  WATCH: { label: "İzle", tone: "caution" },
  FIX_OPERATIONS: { label: "Operasyonu düzelt", tone: "caution" },
  STOP_LOSS: { label: "Zararı durdur", tone: "danger" },
  UNMEASURED: { label: "Ölçülmedi", tone: "neutral" },
};
