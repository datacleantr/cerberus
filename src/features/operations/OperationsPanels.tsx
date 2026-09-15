"use client";

import { AlertTriangle, CheckCircle2, PackageCheck, Plus } from "lucide-react";
import type { BatchView, OrderKpis, OrderView } from "../types";
import { isProblemOrder } from "../types";

/** PSH Envanter & Batch Partileri */
export function PshBatchPanel({
  batches,
  orders,
  onCreate,
}: {
  batches: BatchView[];
  orders: OrderView[];
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-surface-1 border border-line rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-display font-bold text-ink">
            PSH Envanter Programı Ön-Parti (Batch) Yönetimi
          </h2>
          <p className="text-xs text-ink-muted font-mono-tech mt-0.5">
            Ürünler depoya varmadan önce açılan sevkiyat batch&rsquo;leri ve envanter hazırlığı
          </p>
        </div>
        <button
          onClick={onCreate}
          className="px-4 py-2 bg-positive hover:bg-positive text-ink text-xs font-mono-tech font-bold uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
        >
          <Plus className="w-4 h-4" /> Yeni PSH Batch Aç
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="bg-surface-1 border border-line rounded-2xl p-8 text-center text-ink-faint text-sm font-mono-tech">
          Henüz batch açılmamış. Siparişleri sevkiyata hazırlamak için yeni bir parti oluşturun.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {batches.map((batch) => {
            const batchOrders = orders.filter((o) => o.pshBatchNo === batch.batchNumber);
            const totalUnits = batchOrders.reduce((s, o) => s + Number(o.quantity || 0), 0);
            const shippedUnits = batchOrders.reduce((s, o) => s + Number(o.shippedToAmazon || 0), 0);
            const totalSpend = batchOrders.reduce((s, o) => s + Number(o.totalCost || 0), 0);

            return (
              <div
                key={batch.id}
                className="bg-surface-1 border border-line hover:border-brand/40 rounded-2xl p-5 flex flex-col justify-between transition"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2.5 py-0.5 rounded bg-brand/20 text-brand-soft font-mono-tech text-xs font-bold">
                      {batch.batchNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono-tech font-bold ${
                        batch.status === "AMAZONA_GONDERILDI"
                          ? "bg-positive/20 text-positive"
                          : "bg-caution/20 text-caution"
                      }`}
                    >
                      {batch.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-display font-bold text-ink mb-1.5">{batch.title}</h3>
                  <p className="text-xs text-ink-muted mb-4">{batch.notes}</p>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono-tech bg-surface-base p-3 rounded-xl border border-line">
                    <div>
                      <span className="text-[10px] text-ink-faint block">Sipariş Sayısı</span>
                      <span className="text-ink font-bold">{batchOrders.length}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-ink-faint block">Sevk / Beklenen</span>
                      <span className="text-positive font-bold">
                        {shippedUnits} / {totalUnits}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-ink-faint block">Batch Tutarı</span>
                      <span className="text-brand-soft font-bold">${totalSpend.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs font-mono-tech">
                  <span className="text-ink-faint">Mağaza: {batch.storeCode}</span>
                  <span
                    className={
                      batch.inventoryLabSynced ? "text-positive flex items-center gap-1" : "text-ink-faint flex items-center gap-1"
                    }
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {batch.inventoryLabSynced ? "Inventory Lab eşleşti" : "Inventory Lab bekliyor"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Depo Karşılama & Sayım */
export function WarehousePanel({
  orders,
  onStartCount,
  onSelect,
}: {
  orders: OrderView[];
  onStartCount: () => void;
  onSelect: (order: OrderView) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-surface-1 border border-line rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-display font-bold text-ink">
            Depo Karşılama, Sayım ve Order No Eşleştirme
          </h2>
          <p className="text-xs text-ink-muted font-mono-tech mt-0.5">
            Depoya ulaşan kutuları Order No ile eşleştirip gelen, eksik ve defolu adetleri kaydedin
          </p>
        </div>
        <button
          onClick={onStartCount}
          className="px-4 py-2 bg-brand hover:bg-brand-soft text-ink text-xs font-mono-tech font-bold uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <PackageCheck className="w-4 h-4" /> Sayım Başlat
        </button>
      </div>

      <div className="bg-surface-1 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono-tech">
            <thead className="bg-surface-base text-ink-muted border-b border-line text-[11px] uppercase">
              <tr>
                <th className="p-3.5">Order No</th>
                <th className="p-3.5">Ürün Adı</th>
                <th className="p-3.5 text-center">Beklenen</th>
                <th className="p-3.5 text-center">Amazona Sevk</th>
                <th className="p-3.5">Fire Durumu</th>
                <th className="p-3.5">Depo Notu</th>
                <th className="p-3.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-ink-faint">
                    Sayım bekleyen sipariş yok.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-2">
                    <td className="p-3.5 font-bold text-brand-soft">{o.orderNumber}</td>
                    <td className="p-3.5 font-sans text-ink max-w-sm truncate">{o.productTitle}</td>
                    <td className="p-3.5 text-center font-bold text-ink">{o.quantity}</td>
                    <td className="p-3.5 text-center font-bold text-positive">{o.shippedToAmazon}</td>
                    <td className="p-3.5">
                      {Number(o.p2MissingQty) > 0 ? (
                        <span className="text-caution font-bold">P2: {o.p2MissingQty} eksik</span>
                      ) : Number(o.p1CancelQty) > 0 ? (
                        <span className="text-danger font-bold">P1: {o.p1CancelQty} iptal</span>
                      ) : (
                        <span className="text-positive">Tam teslim</span>
                      )}
                    </td>
                    <td className="p-3.5 text-ink-muted max-w-xs truncate">
                      {o.description1 || o.auditNote || "Not yok"}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => onSelect(o)}
                        className="px-3 py-1 bg-brand/20 hover:bg-brand/30 text-brand-soft rounded-lg font-bold"
                      >
                        Sayıma Gir
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Inventory Lab & Muhasebe */
export function InventoryLabPanel({ orders, kpis }: { orders: OrderView[]; kpis: OrderKpis }) {
  return (
    <div className="space-y-4">
      <div className="bg-surface-1 border border-line rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-bold text-ink">
            Inventory Lab &amp; Amazon Kârlılık Muhasebesi
          </h2>
          <p className="text-xs text-ink-muted font-mono-tech mt-0.5">
            Batch&rsquo;lerin Amazon satış fiyatı, maliyet ve tahmini net marj dökümü
          </p>
        </div>

        <div className="flex items-center gap-3 font-mono-tech text-xs">
          <div className="bg-surface-base px-3.5 py-2 rounded-xl border border-line">
            <span className="text-[10px] text-ink-faint block">Tahmini Ciro</span>
            <span className="text-ink font-bold">
              ${Number(kpis.totalRevenueEst).toLocaleString()}
            </span>
          </div>
          <div className="bg-surface-base px-3.5 py-2 rounded-xl border border-positive/40">
            <span className="text-[10px] text-positive block">Tahmini Net Marj</span>
            <span className="text-positive font-bold">
              ${Number(kpis.grossNetEst).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-surface-1 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono-tech">
            <thead className="bg-surface-base text-ink-muted border-b border-line text-[11px] uppercase">
              <tr>
                <th className="p-3.5">MSKU / ASIN</th>
                <th className="p-3.5">Ürün Adı</th>
                <th className="p-3.5 text-right">Birim Alış</th>
                <th className="p-3.5 text-right">Amazon Satış</th>
                <th className="p-3.5 text-right">Brüt Kâr / Adet</th>
                <th className="p-3.5 text-right">ROI %</th>
                <th className="p-3.5 text-center">Sevk Adet</th>
                <th className="p-3.5">Muhasebe Durumu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-ink-faint">
                    Muhasebeleştirilecek kayıt yok.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const unitCost = Number(o.unitCost) || 0;
                  const selling = Number(o.sellingPrice) || 0;
                  const profitPerUnit = selling - unitCost;
                  // Maliyet 0 ise ROI hesaplanamaz — "Infinity%" yazmak yerine dürüstçe "—"
                  const roi = unitCost > 0 ? `%${((profitPerUnit / unitCost) * 100).toFixed(1)}` : "—";

                  return (
                    <tr key={o.id} className="hover:bg-surface-2">
                      <td className="p-3.5">
                        <span className="font-bold text-ink block">{o.msku}</span>
                        <span className="text-[10px] text-brand-soft">{o.asin}</span>
                      </td>
                      <td className="p-3.5 font-sans text-ink max-w-sm truncate">{o.productTitle}</td>
                      <td className="p-3.5 text-right text-caution font-bold">${o.unitCost}</td>
                      <td className="p-3.5 text-right text-positive font-bold">${o.sellingPrice}</td>
                      <td
                        className={`p-3.5 text-right font-bold ${
                          profitPerUnit >= 0 ? "text-info" : "text-danger"
                        }`}
                      >
                        {profitPerUnit >= 0 ? "+" : "−"}${Math.abs(profitPerUnit).toFixed(2)}
                      </td>
                      <td
                        className={`p-3.5 text-right font-bold ${
                          profitPerUnit >= 0 ? "text-positive" : "text-danger"
                        }`}
                      >
                        {roi}
                      </td>
                      <td className="p-3.5 text-center text-ink">{o.shippedToAmazon}</td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded bg-surface-3 text-ink-muted text-[10px] font-bold">
                          {o.inventoryLabStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** P1–P4 Fire & Problem Yönetimi */
export function ProblemsPanel({
  orders,
  onSelect,
}: {
  orders: OrderView[];
  onSelect: (order: OrderView) => void;
}) {
  const problems = orders.filter(isProblemOrder);

  return (
    <div className="space-y-4">
      <div className="bg-surface-1 border border-danger/30 rounded-2xl p-5">
        <h2 className="text-base font-display font-bold text-ink flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-danger" />
          P1–P4 Fire, İptal ve Tedarikçi İadesi Yönetimi
        </h2>
        <p className="text-xs text-ink-muted font-mono-tech mt-0.5">
          P1 (iptal), P2 (eksik), P3 (defolu), P4 (tarihi geçmiş) adetleri ve R-kodlu iade tutarları
        </p>
      </div>

      <div className="bg-surface-1 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono-tech">
            <thead className="bg-surface-base text-ink-muted border-b border-line text-[11px] uppercase">
              <tr>
                <th className="p-3.5">Order No</th>
                <th className="p-3.5">Ürün</th>
                <th className="p-3.5">Problem Türü</th>
                <th className="p-3.5">Eylem</th>
                <th className="p-3.5">Sonuç</th>
                <th className="p-3.5 text-right">Tedarikçi İadesi</th>
                <th className="p-3.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {problems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-positive">
                    Açık fire/problem kaydı yok — tüm siparişler temiz.
                  </td>
                </tr>
              ) : (
                problems.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-2">
                    <td className="p-3.5 text-brand-soft font-bold">{o.orderNumber}</td>
                    <td className="p-3.5 font-sans text-ink max-w-xs truncate">{o.productTitle}</td>
                    <td className="p-3.5">
                      {o.cargoStatus === "İPTAL" ? (
                        <span className="px-2 py-0.5 rounded bg-danger/20 text-danger font-bold text-[10px]">
                          P1: İPTAL ({o.p1CancelQty || o.quantity})
                        </span>
                      ) : Number(o.p2MissingQty) > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-caution/20 text-caution font-bold text-[10px]">
                          P2: EKSİK ({o.p2MissingQty})
                        </span>
                      ) : Number(o.p3DefectiveQty) > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold text-[10px]">
                          P3: DEFOLU ({o.p3DefectiveQty})
                        </span>
                      ) : Number(o.p4ExpiredQty) > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px]">
                          P4: TARİHİ GEÇMİŞ ({o.p4ExpiredQty})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-surface-3 text-ink-muted text-[10px]">
                          İade / kontrol
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-ink-muted max-w-xs truncate">
                      {o.problemAction || "Eylem bekleniyor"}
                    </td>
                    <td className="p-3.5 text-positive max-w-xs truncate">
                      {o.problemResult || "İşlem sürüyor"}
                    </td>
                    <td className="p-3.5 text-right text-caution font-bold">${o.refundAmount}</td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => onSelect(o)}
                        className="px-3 py-1 bg-brand hover:bg-brand-soft text-ink font-bold rounded-lg text-[11px]"
                      >
                        Çözümle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
