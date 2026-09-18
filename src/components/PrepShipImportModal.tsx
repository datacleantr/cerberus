"use client";

import { clientLog } from "@/lib/clientLogger";
import React, { useState } from "react";
import { X, FileUp, AlertTriangle, CheckCircle2, PackageCheck } from "lucide-react";

interface PrepShipImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  batchNumber: string;
  batchTitle: string;
}

interface ParsedRow {
  asin?: string;
  msku?: string;
  quantity?: number;
}

interface OrderSyncResult {
  orderId: number;
  orderNumber: string;
  msku: string;
  orderedQty: number;
  matched: boolean;
  fileQtyForMsku: number | null;
}

interface SyncWarning {
  code: string;
  msku: string;
  detail: string;
}

interface PreviewResponse {
  preview: {
    perOrder: OrderSyncResult[];
    warnings: SyncWarning[];
    matchedCount: number;
    unmatchedCount: number;
  };
  committed: boolean;
}

// PrepShip'in Inventory Lab'a gönderdiği gerçek dosyadaki (kullanıcının
// paylaştığı IL-...csv) başlıklar — büyük/küçük harf ve boşluk
// varyasyonlarına karşı normalize edilerek aranır.
const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  asin: "asin",
  msku: "msku",
  quantity: "quantity",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function PrepShipImportModal({
  isOpen,
  onClose,
  onImported,
  batchNumber,
  batchTitle,
}: PrepShipImportModalProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [preview, setPreview] = useState<PreviewResponse["preview"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setFileName(null);
    setParsedRows([]);
    setPreview(null);
    setErrorMsg(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import("xlsx");
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

        const rows: ParsedRow[] = raw.map((r) => {
          const out: ParsedRow = {};
          for (const [key, value] of Object.entries(r)) {
            const field = HEADER_ALIASES[normalizeHeader(key)];
            if (!field) continue;
            if (field === "quantity") {
              const n = Number(String(value).replace(",", "."));
              if (Number.isFinite(n)) out[field] = n;
            } else {
              out[field] = String(value).trim();
            }
          }
          return out;
        }).filter((r) => r.msku);

        if (rows.length === 0) {
          setErrorMsg(
            "Dosyada MSKU kolonu bulunamadı ya da tüm satırlar boş. PrepShip'in Inventory Lab'a gönderdiği CSV/xlsx dosyasını yükleyin."
          );
          return;
        }
        setParsedRows(rows);
      } catch (err) {
        setErrorMsg(`Dosya okuma hatası: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const runPreview = async () => {
    if (!parsedRows.length) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(batchNumber)}/prepship-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows, commit: false }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Önizleme alınamadı.");
      setPreview(body.preview);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Önizleme alınamadı.");
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!parsedRows.length) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(batchNumber)}/prepship-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows, commit: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Senkron teyidi uygulanamadı.");
      onImported();
      handleClose();
    } catch (err) {
      clientLog.error("batches/prepship-import", "Inventory Lab senkron teyidi uygulanamadı", { err: String(err) });
      setErrorMsg(err instanceof Error ? err.message : "Senkron teyidi uygulanamadı.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#161C28] border border-line rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-info/10 border border-info/30 text-info">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-ink">
                Inventory Lab Senkronunu Teyit Et: {batchNumber}
              </h2>
              <p className="text-xs text-ink-muted font-mono-tech">{batchTitle}</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-3 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="my-4 space-y-4">
          <div className="p-3 rounded-xl bg-caution/10 border border-caution/30 text-[11px] font-mono-tech text-caution flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Bu dosyadaki adet, sipariş verilirken girilen adettir — depoya fiilen kaç adet
              geldiğini GÖSTERMEZ (o hâlâ Depo Karşılama ekranından elle giriliyor). Bu işlem
              yalnızca hangi siparişlerin Inventory Lab&rsquo;a ulaştığını işaretler; sevkiyat/fire
              alanlarına dokunmaz.
            </span>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-line rounded-xl cursor-pointer hover:border-info/50 transition">
            <FileUp className="w-6 h-6 text-ink-muted" />
            <span className="text-xs font-mono-tech text-ink-muted">
              {fileName || "PrepShip'in Inventory Lab'a gönderdiği CSV/xlsx dosyasını seçin"}
            </span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          </label>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-xs font-mono-tech text-danger">
              {errorMsg}
            </div>
          )}

          {parsedRows.length > 0 && !preview && (
            <button
              onClick={runPreview}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-ink font-mono-tech text-xs uppercase font-bold tracking-wider transition"
            >
              {loading ? "Önizleme hesaplanıyor..." : `${parsedRows.length} satırı önizle`}
            </button>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs font-mono-tech">
                <div className="p-3 rounded-xl bg-positive/10 border border-positive/30">
                  <span className="text-[10px] text-positive block">Inventory Lab&rsquo;a Ulaştı</span>
                  <span className="text-positive font-bold text-base">{preview.matchedCount}</span>
                </div>
                <div className="p-3 rounded-xl bg-caution/10 border border-caution/30">
                  <span className="text-[10px] text-caution block">Eşleşmedi</span>
                  <span className="text-caution font-bold text-base">{preview.unmatchedCount}</span>
                </div>
              </div>

              <div className="border border-line rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[11px] font-mono-tech">
                  <thead className="bg-surface-base text-ink-muted border-b border-line sticky top-0">
                    <tr>
                      <th className="p-2">Sipariş</th>
                      <th className="p-2">MSKU</th>
                      <th className="p-2 text-center">Sipariş Adedi</th>
                      <th className="p-2 text-center">Dosyadaki Adet (MSKU)</th>
                      <th className="p-2 text-center">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.perOrder.map((row) => (
                      <tr key={row.orderId} className={!row.matched ? "bg-caution/5" : ""}>
                        <td className="p-2 text-info font-bold">{row.orderNumber}</td>
                        <td className="p-2 text-ink-muted">{row.msku}</td>
                        <td className="p-2 text-center">{row.orderedQty}</td>
                        <td className="p-2 text-center">{row.fileQtyForMsku ?? "—"}</td>
                        <td className="p-2 text-center">
                          {row.matched ? (
                            <span className="text-positive font-bold">Ulaştı</span>
                          ) : (
                            <span className="text-caution font-bold">Bulunamadı</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.warnings.length > 0 && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] font-mono-tech text-danger flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {w.detail}
                    </p>
                  ))}
                </div>
              )}

              <button
                onClick={handleCommit}
                disabled={loading}
                className="w-full px-4 py-2.5 rounded-lg bg-positive hover:bg-positive text-ink font-mono-tech text-xs uppercase font-bold tracking-wider transition flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                {loading ? "Uygulanıyor..." : "Onayla ve Uygula"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
