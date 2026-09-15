"use client";

import { ChevronLeft, ChevronRight, Download, ExternalLink, PackageCheck, Search } from "lucide-react";
import type { BatchView, OrderPagination, OrderView } from "../types";

export function OrdersTable({
  orders,
  batches,
  searchQuery,
  onSearchChange,
  cargoFilter,
  onCargoFilterChange,
  batchFilter,
  onBatchFilterChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  exportingCsv,
  onExportCsv,
  onOpenWarehouse,
  onSelect,
}: {
  orders: OrderView[];
  batches: BatchView[];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  cargoFilter: string;
  onCargoFilterChange: (v: string) => void;
  batchFilter: string;
  onBatchFilterChange: (v: string) => void;
  pagination: OrderPagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  exportingCsv: boolean;
  onExportCsv: () => void;
  onOpenWarehouse: () => void;
  onSelect: (order: OrderView) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-surface-1 border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-3" />
          <input
            type="search"
            aria-label="Siparişlerde ara"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Order No, ASIN, MSKU, ürün adı veya sipariş maili ara..."
            className="w-full pl-10 pr-3.5 py-2 bg-surface-base border border-line rounded-xl text-xs font-mono-tech text-ink focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Kargo durumuna göre filtrele"
            value={cargoFilter}
            onChange={(e) => onCargoFilterChange(e.target.value)}
            className="bg-surface-base border border-line rounded-xl px-3 py-2 text-xs font-mono-tech text-ink"
          >
            <option value="ALL">TÜM KARGO DURUMLARI</option>
            <option value="Tam Geldi">Tam Geldi</option>
            <option value="İPTAL">İPTAL</option>
            <option value="Yolda">Yolda</option>
            <option value="Kayıp Depoya gelmiş">Kayıp Depoya gelmiş</option>
          </select>

          <select
            aria-label="PSH batch'e göre filtrele"
            value={batchFilter}
            onChange={(e) => onBatchFilterChange(e.target.value)}
            className="bg-surface-base border border-line rounded-xl px-3 py-2 text-xs font-mono-tech text-ink"
          >
            <option value="ALL">TÜM PSH BATCH&rsquo;LERİ</option>
            {batches.map((b) => (
              <option key={b.batchNumber} value={b.batchNumber}>
                {b.batchNumber}
              </option>
            ))}
          </select>

          <button
            onClick={onExportCsv}
            disabled={exportingCsv}
            className="px-3.5 py-2 bg-surface-3 hover:bg-surface-3 border border-line text-info rounded-xl text-xs font-mono-tech font-bold transition flex items-center gap-1.5 disabled:cursor-wait disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingCsv ? "CSV hazırlanıyor…" : "Filtrelenmiş CSV'yi İndir"}
          </button>

          <button
            onClick={onOpenWarehouse}
            className="px-3.5 py-2 bg-positive/15 hover:bg-positive/25 border border-positive/30 text-positive rounded-xl text-xs font-mono-tech font-bold transition flex items-center gap-1.5"
          >
            <PackageCheck className="w-3.5 h-3.5" /> Depo Sayım Modu
          </button>
        </div>
      </div>

      <div className="bg-surface-1 border border-line rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-surface-base text-[11px] font-mono-tech uppercase text-ink-muted border-b border-line">
              <tr>
                <th className="py-3.5 px-3.5">Mağaza / Tarih</th>
                <th className="py-3.5 px-3.5">Order No / Fatura</th>
                <th className="py-3.5 px-3.5">Ürün Adı</th>
                <th className="py-3.5 px-3.5">ASIN / MSKU</th>
                <th className="py-3.5 px-3.5">Satıcı</th>
                <th className="py-3.5 px-3.5 text-center">Adet</th>
                <th className="py-3.5 px-3.5 text-right">Birim Maliyet</th>
                <th className="py-3.5 px-3.5 text-right">Satış Fiyatı</th>
                <th className="py-3.5 px-3.5 text-right">Toplam Maliyet</th>
                <th className="py-3.5 px-3.5">Kargo Durumu</th>
                <th className="py-3.5 px-3.5 text-center">Amazona Sevk</th>
                <th className="py-3.5 px-3.5">P1-P4 Fire</th>
                <th className="py-3.5 px-3.5">PSH Batch</th>
                <th className="py-3.5 px-3.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-xs font-mono-tech">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-ink-faint">
                    Bu filtrede sipariş kaydı bulunmuyor. &quot;Yeni Sipariş&quot; veya &quot;Excel /
                    Google Drive Yükle&quot; ile ekleyebilirsiniz.
                  </td>
                </tr>
              ) : (
                orders.map((item) => {
                  const isCancelled = item.cargoStatus === "İPTAL";
                  const hasMissing = Number(item.p2MissingQty) > 0;
                  return (
                    <tr key={item.id} className="hover:bg-surface-2 transition">
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-brand/15 text-brand-soft font-bold block w-fit">
                          {item.buyerStore}
                        </span>
                        <span className="text-[11px] text-ink-muted block mt-1">{item.orderDate}</span>
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <span className="text-ink font-bold block">{item.orderNumber}</span>
                        {item.driveLink ? (
                          <a
                            href={item.driveLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-positive hover:underline inline-flex items-center gap-1 mt-0.5"
                          >
                            Drive Fatura <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-ink-faint block mt-0.5">Fatura yok</span>
                        )}
                      </td>

                      <td className="py-3.5 px-3.5 max-w-xs font-sans text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="px-1.5 rounded bg-surface-3 text-caution font-mono-tech text-[10px] font-bold">
                            {item.brandName}
                          </span>
                          <span className="text-[10px] text-ink-muted font-mono-tech">
                            {item.fulfillmentType}
                          </span>
                        </div>
                        <button
                          onClick={() => onSelect(item)}
                          className="font-medium text-ink hover:text-brand-soft text-left line-clamp-2 transition"
                        >
                          {item.productTitle}
                        </button>
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <a
                          href={item.amazonUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-soft font-bold hover:underline inline-flex items-center gap-1"
                        >
                          {item.asin} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <span className="text-[10px] text-ink-muted block truncate max-w-[110px]">
                          {item.msku}
                        </span>
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <a
                          href={item.supplierUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink-muted hover:text-caution inline-flex items-center gap-1"
                        >
                          {item.supplierName} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <span className="text-[10px] text-ink-faint block">Kod: {item.supplierCode}</span>
                      </td>

                      <td className="py-3.5 px-3.5 text-center whitespace-nowrap">
                        <span className="text-ink font-bold">{item.quantity}</span>
                        <span className="text-[10px] text-ink-faint block">{item.packCount}li paket</span>
                      </td>

                      <td className="py-3.5 px-3.5 text-right whitespace-nowrap text-caution font-bold">
                        ${item.unitCost}
                      </td>
                      <td className="py-3.5 px-3.5 text-right whitespace-nowrap text-positive font-bold">
                        ${item.sellingPrice}
                      </td>
                      <td className="py-3.5 px-3.5 text-right whitespace-nowrap text-info font-bold">
                        ${item.totalCost}
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            isCancelled
                              ? "bg-danger/20 text-danger border border-danger/30"
                              : item.cargoStatus === "Tam Geldi"
                              ? "bg-positive/20 text-positive border border-positive/30"
                              : "bg-caution/20 text-caution border border-caution/30"
                          }`}
                        >
                          {item.cargoStatus}
                        </span>
                        <span className="text-[10px] text-ink-faint block mt-0.5 truncate max-w-[120px]">
                          {item.orderEmail}
                        </span>
                      </td>

                      <td className="py-3.5 px-3.5 text-center whitespace-nowrap font-bold text-positive">
                        {item.shippedToAmazon} / {item.quantity}
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        {isCancelled ? (
                          <span className="text-danger font-bold">P1 İptal: {item.p1CancelQty}</span>
                        ) : hasMissing ? (
                          <span className="text-caution font-bold">P2 Eksik: {item.p2MissingQty}</span>
                        ) : (
                          <span className="text-ink-faint">Fire yok</span>
                        )}
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-surface-3 text-ink-muted text-[10px]">
                          {item.pshBatchNo || "Atanmadı"}
                        </span>
                      </td>

                      <td className="py-3.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => onSelect(item)}
                          className="px-2.5 py-1 rounded-lg bg-brand/20 hover:bg-brand/30 text-brand-soft text-[11px] font-bold transition"
                        >
                          Detay
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-surface-base px-4 py-3 text-xs font-mono-tech text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <div>
            {pagination.total === 0
              ? "Kayıt yok"
              : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                )} / ${pagination.total} kayıt`}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="orders-page-size" className="text-[11px] text-ink-faint">
              Sayfa başına
            </label>
            <select
              id="orders-page-size"
              value={pagination.pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-ink"
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Önceki sayfa"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
              className="rounded-lg border border-line p-1.5 text-ink transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-20 text-center text-ink">
              {pagination.pageCount === 0 ? 0 : pagination.page} / {pagination.pageCount}
            </span>
            <button
              type="button"
              aria-label="Sonraki sayfa"
              disabled={pagination.pageCount === 0 || pagination.page >= pagination.pageCount}
              onClick={() => onPageChange(pagination.page + 1)}
              className="rounded-lg border border-line p-1.5 text-ink transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
