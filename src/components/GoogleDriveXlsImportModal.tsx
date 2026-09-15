"use client";

import React, { useState, useRef } from "react";
import {
  X,
  FileSpreadsheet,
  CheckCircle2,
  Upload,
  AlertCircle,
  AlertTriangle,
  CloudDownload,
  FileUp,
  ClipboardPaste,
  Trash2,
  Edit3,
} from "lucide-react";

interface GoogleDriveXlsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
  currentStore: string;
}

export function GoogleDriveXlsImportModal({
  isOpen,
  onClose,
  onImportSuccess,
  currentStore,
}: GoogleDriveXlsImportModalProps) {
  const store = currentStore === "ALL" ? "HRN" : currentStore;

  const [activeImportMode, setActiveImportMode] = useState<
    "FILE_UPLOAD" | "DRIVE_URL" | "PASTE_TSV"
  >("FILE_UPLOAD");

  // State for Drive URL
  const [driveUrl, setDriveUrl] = useState("");
  const [fetchingDrive, setFetchingDrive] = useState(false);

  // State for Paste TSV
  const [tsvText, setTsvText] = useState("");

  // Parsed Preview Rows ready to commit
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  // Submission state
  const [importing, setImporting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultWarning, setResultWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Convert raw 2D matrix array to 40-col objects
  const parseMatrixToRows = (rawMatrix: any[][]) => {
    if (!rawMatrix || rawMatrix.length < 2) return [];
    const dataRows = rawMatrix.slice(1);
    const parsed: any[] = [];

    for (const cols of dataRows) {
      if (!cols || cols.length < 3) continue;
      const productTitle = String(cols[4] || cols[2] || "").trim();
      const orderNumber = String(cols[11] || cols[5] || "").trim();
      if (!productTitle && !orderNumber) continue;

      parsed.push({
        buyerStore: String(cols[0] || store).trim() || store,
        orderDate: String(cols[1] || new Date().toISOString().split("T")[0]).trim(),
        imageUrl: String(cols[2] || "").trim(),
        fulfillmentType: String(cols[3] || "FBA").trim(),
        productTitle: productTitle || "Excel Siparişi",
        asin: String(cols[5] || "").trim().toUpperCase(),
        msku: String(cols[6] || "").trim(),
        supplierName: String(cols[7] || "THE VITAMINSHOPPE").trim(),
        supplierCode: String(cols[8] || "A198").trim(),
        supplierUrl: String(cols[9] || "").trim(),
        amazonUrl: String(cols[10] || "").trim(),
        orderNumber: orderNumber || `WO-${Math.floor(10000000 + Math.random() * 90000000)}`,
        driveLink: String(cols[12] || "").trim(),
        packCount: Number(cols[13]) || 1,
        quantity: Number(cols[14]) || 1,
        unitCost: String(cols[15] || "0").replace(",", "."),
        sellingPrice: String(cols[16] || "0").replace(",", "."),
        totalCost: String(cols[17] || "0").replace(",", "."),
        orderEmail: String(cols[18] || "").trim(),
        cargoStatus: String(cols[19] || "Tam Geldi").trim(),
        shippedToAmazon: Number(cols[20]) || 0,
        p1CancelQty: Number(cols[21]) || 0,
        p2MissingQty: Number(cols[22]) || 0,
        p3DefectiveQty: Number(cols[23]) || 0,
        p4ExpiredQty: Number(cols[24]) || 0,
        problemAction: String(cols[25] || "").trim(),
        problemResult: String(cols[26] || "").trim(),
        refundAmount: String(cols[27] || "0").replace(",", "."),
        creditCard: String(cols[28] || "").trim(),
        isFragile: String(cols[29] || "NO").trim(),
        isMultiPack: String(cols[30] || "NO").trim(),
        isBundle: String(cols[31] || "NO").trim(),
        condition: String(cols[33] || "New").trim(),
        brandName: String(cols[34] || "General").trim(),
        description1: String(cols[35] || "").trim(),
        description2: String(cols[36] || "").trim(),
        auditNote: String(cols[37] || "").trim(),
        periodCode: String(cols[38] || "Ş26").trim(),
        correctedCost: String(cols[39] || cols[17] || "0").replace(",", "."),
      });
    }

    return parsed;
  };

  // 1. Handle local Excel / CSV file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        // ~800 KB'lık ayrıştırıcı yalnızca dosya yüklendiğinde gelir (bundle bölmesi)
        const XLSX = await import("xlsx");
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawMatrix: any[][] = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
        });

        const rows = parseMatrixToRows(rawMatrix);
        if (rows.length === 0) {
          setErrorMsg("Excel dosyasında geçerli veri satırı bulunamadı. İlk satır başlık olmalıdır.");
        } else {
          setPreviewRows(rows);
        }
      } catch (err: any) {
        setErrorMsg(`Dosya okuma hatası: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 2. Fetch directly from Google Drive URL
  const handleFetchFromDrive = async () => {
    if (!driveUrl.trim()) return;
    setErrorMsg(null);
    setFetchingDrive(true);
    try {
      const res = await fetch("/api/orders/import-drive-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl, defaultStore: store }),
      });
      const data = await res.json();
      if (res.ok && data.rows) {
        setPreviewRows(data.rows);
        setFileName("Google Drive E-Tablo");
      } else {
        setErrorMsg(data.error || "Google Drive linki çözümlenemedi.");
      }
    } catch {
      setErrorMsg("Bağlantı hatası oluştu.");
    } finally {
      setFetchingDrive(false);
    }
  };

  // 3. Parse pasted TSV / CSV text
  const handleParsePaste = () => {
    setErrorMsg(null);
    if (!tsvText.trim()) return;
    const lines = tsvText.trim().split("\n");
    const matrix = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")));
    const rows = parseMatrixToRows([["HEADER", ...Array(39).fill("")], ...matrix]);
    if (rows.length === 0) {
      setErrorMsg("Yapıştırılan metinde geçerli satır bulunamadı.");
    } else {
      setPreviewRows(rows);
      setFileName("Panodan Yapıştırılan Veri");
    }
  };

  // Update cell in preview table inline
  const handleCellChange = (rowIndex: number, field: string, value: string) => {
    setPreviewRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, [field]: value } : r))
    );
  };

  // Delete row from preview table
  const handleDeleteRow = (rowIndex: number) => {
    setPreviewRows((prev) => prev.filter((_, i) => i !== rowIndex));
  };

  // Commit preview rows to PostgreSQL
  const handleCommitToDatabase = async () => {
    if (previewRows.length === 0) return;
    setImporting(true);
    setErrorMsg(null);
    setResultWarning(null);
    try {
      const res = await fetch("/api/orders/import-xls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: previewRows,
          defaultStore: store,
          actorName: `Kullanıcı (${store})`,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setResultMessage(data.message);
        const skippedCount: number = data.skippedCount ?? 0;
        const skipped: any[] = Array.isArray(data.skipped) ? data.skipped : [];
        if (skippedCount > 0) {
          // Kısmi başarı: atlanan satırlar (warnings) kullanıcıya gösterilir ve
          // modal otomatik kapanmaz — hatalı satırlar düzeltilip yeniden denenebilir.
          const lines = skipped.slice(0, 5).map((d) => `• ${d.row}. satır — ${d.field}: ${d.message}`);
          const more = skippedCount > 5 ? `\n• ... ve ${skippedCount - 5} satır daha` : "";
          setResultWarning(
            `${skippedCount} satır atlandı (warnings):\n${lines.join("\n")}${more}\nDüzelttikten sonra kalan satırları yeniden aktarabilirsiniz.`
          );
          onImportSuccess();
        } else {
          setTimeout(() => {
            onImportSuccess();
            onClose();
          }, 1200);
        }
      } else {
        const details = Array.isArray(data.details) ? data.details : [];
        const msg = data.error || "Veritabanına aktarım başarısız oldu.";
        setErrorMsg(details.length ? msg + "\n" + details.map((d: any) => `• ${d.row}. satır — ${d.field}: ${d.message}`).join("\n") : msg);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-1 border border-line rounded-2xl max-w-5xl w-full max-h-[94vh] overflow-y-auto p-6 shadow-2xl flex flex-col space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-positive/15 border border-positive/30 text-positive">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-ink">
                Çoklu Kaynak Excel / Google Drive Sipariş İçe Aktarıcı ({store} Mağazası)
              </h2>
              <p className="text-xs text-ink-muted font-mono-tech">
                Bilgisayarınızdan .xlsx / .csv yükleyin veya Google E-Tablo linkini yapıştırıp Excel gibi hücre düzenleyin
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-3 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-3 gap-2 text-xs font-mono-tech">
          <button
            type="button"
            onClick={() => setActiveImportMode("FILE_UPLOAD")}
            className={`py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 border transition ${
              activeImportMode === "FILE_UPLOAD"
                ? "bg-brand/20 text-brand-soft border-brand shadow-sm"
                : "bg-surface-base text-ink-muted border-line hover:text-ink"
            }`}
          >
            <FileUp className="w-4 h-4 text-positive" />
            <span>1. Bilgisayardan .XLSX / .CSV Yükle</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveImportMode("DRIVE_URL")}
            className={`py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 border transition ${
              activeImportMode === "DRIVE_URL"
                ? "bg-brand/20 text-brand-soft border-brand shadow-sm"
                : "bg-surface-base text-ink-muted border-line hover:text-ink"
            }`}
          >
            <CloudDownload className="w-4 h-4 text-info" />
            <span>2. Google Drive Linkinden Çek</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveImportMode("PASTE_TSV")}
            className={`py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 border transition ${
              activeImportMode === "PASTE_TSV"
                ? "bg-brand/20 text-brand-soft border-brand shadow-sm"
                : "bg-surface-base text-ink-muted border-line hover:text-ink"
            }`}
          >
            <ClipboardPaste className="w-4 h-4 text-caution" />
            <span>3. Excel&rsquo;den Kopyala / Yapıştır</span>
          </button>
        </div>

        {/* Input Mode Panels */}
        {activeImportMode === "FILE_UPLOAD" && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-line hover:border-brand rounded-2xl p-8 bg-surface-base text-center cursor-pointer transition group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-brand/15 border border-brand/30 text-brand-soft flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition">
              <FileUp className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-ink">
              Excel (.xlsx, .xls) veya CSV dosyanızı buraya sürükleyin ya da tıklayıp seçin
            </h4>
            <p className="text-xs text-ink-muted font-mono-tech mt-1">
              Google Drive&rsquo;dan indirdiğiniz veya yerel bilgisayarınızdaki 40-kolon tablonuz anında ayrıştırılır
            </p>
          </div>
        )}

        {activeImportMode === "DRIVE_URL" && (
          <div className="bg-surface-base border border-line rounded-2xl p-4 space-y-3 font-mono-tech text-xs">
            <label className="block text-ink-muted font-bold">
              Google Drive / Google Sheets Paylaşım Linki
            </label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1DoJEF8iYPCRwhT3.../edit"
                className="flex-1 px-3.5 py-2.5 bg-surface-1 border border-line rounded-xl text-ink focus:outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={fetchingDrive || !driveUrl.trim()}
                onClick={handleFetchFromDrive}
                className="px-5 py-2.5 bg-brand hover:bg-brand-soft disabled:opacity-50 text-ink font-bold rounded-xl flex items-center gap-2 transition"
              >
                <CloudDownload className="w-4 h-4" />
                {fetchingDrive ? "Drive Okunuyor..." : "Drive'dan Otomatik Çek"}
              </button>
            </div>
            <p className="text-[11px] text-ink-faint">
              * İpucu: Google E-Tablonuzda sağ üstteki &quot;Paylaş&quot; butonundan &quot;Bağlantıya sahip olan herkes görüntüleyebilir&quot; seçili olmalıdır.
            </p>
          </div>
        )}

        {activeImportMode === "PASTE_TSV" && (
          <div className="space-y-2 font-mono-tech text-xs">
            <textarea
              rows={5}
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              placeholder={`Satın Alan\tTarih\tÜrün resmi\tFBM/FBA\tÜrün adı Amazon\tASIN\tMSKU\tSatıcı adı\tOrderno...\nHRN\t2026-01-21\t\tFBA\tMegaFood One Daily...\tB00014DAJ8\tMHB00014DAJ8\tTHE VITAMINSHOPPE\tWO110074776`}
              className="w-full p-3 bg-surface-base border border-line rounded-xl text-ink focus:outline-none focus:border-brand placeholder:text-ink-faint"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleParsePaste}
                className="px-4 py-2 bg-brand hover:bg-brand-soft text-ink rounded-xl font-bold flex items-center gap-1.5"
              >
                Metni Çözümle &amp; Önizle
              </button>
            </div>
          </div>
        )}

        {/* Error or Success notification */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/15 border border-danger/40 text-danger text-xs font-mono-tech flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="whitespace-pre-line">{errorMsg}</span>
          </div>
        )}

        {resultMessage && (
          <div className="p-3 rounded-xl bg-positive/15 border border-positive/40 text-positive text-xs font-mono-tech flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{resultMessage}</span>
          </div>
        )}

        {resultWarning && (
          <div className="p-3 rounded-xl bg-caution/15 border border-caution/40 text-caution text-xs font-mono-tech flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="whitespace-pre-line">{resultWarning}</span>
          </div>
        )}

        {/* EXCEL BENZERİ HÜCRE DÜZENLEYİCİ ÖNİZLEME TABLOSU (SPREADSHEET PREVIEW & EDIT GRID) */}
        {previewRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono-tech">
              <span className="text-positive font-bold flex items-center gap-1.5">
                <Edit3 className="w-4 h-4" />
                Önizleme &amp; Excel Tarzı Hücre Düzenleme ({previewRows.length} Satır Hazır)
              </span>
              <span className="text-ink-muted text-[11px]">
                Kaynak: {fileName || "Dosya"} • Hücrelere tıklayıp kaydetmeden önce düzeltebilirsiniz
              </span>
            </div>

            <div className="border border-line rounded-xl overflow-hidden bg-surface-base max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono-tech">
                <thead className="bg-surface-1 text-ink-muted border-b border-line text-[11px] sticky top-0">
                  <tr>
                    <th className="p-2.5">#</th>
                    <th className="p-2.5">Mağaza</th>
                    <th className="p-2.5">Order No</th>
                    <th className="p-2.5">ASIN</th>
                    <th className="p-2.5">Ürün Adı</th>
                    <th className="p-2.5">Adet</th>
                    <th className="p-2.5">Birim Maliyet ($)</th>
                    <th className="p-2.5">Satış ($)</th>
                    <th className="p-2.5">Kargo Durumu</th>
                    <th className="p-2.5 text-right">Sil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {previewRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-surface-2/80">
                      <td className="p-2 text-ink-faint">{idx + 1}</td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.buyerStore}
                          onChange={(e) => handleCellChange(idx, "buyerStore", e.target.value)}
                          className="w-14 px-1.5 py-1 bg-surface-1 border border-line rounded text-brand-soft font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.orderNumber}
                          onChange={(e) => handleCellChange(idx, "orderNumber", e.target.value)}
                          className="w-28 px-1.5 py-1 bg-surface-1 border border-line rounded text-ink font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.asin}
                          onChange={(e) => handleCellChange(idx, "asin", e.target.value.toUpperCase())}
                          className="w-24 px-1.5 py-1 bg-surface-1 border border-line rounded text-info font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.productTitle}
                          onChange={(e) => handleCellChange(idx, "productTitle", e.target.value)}
                          className="w-full min-w-[200px] px-1.5 py-1 bg-surface-1 border border-line rounded text-ink"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => handleCellChange(idx, "quantity", e.target.value)}
                          className="w-14 px-1.5 py-1 bg-surface-1 border border-line rounded text-center text-ink font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          value={row.unitCost}
                          onChange={(e) => handleCellChange(idx, "unitCost", e.target.value)}
                          className="w-20 px-1.5 py-1 bg-surface-1 border border-line rounded text-caution font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          value={row.sellingPrice}
                          onChange={(e) => handleCellChange(idx, "sellingPrice", e.target.value)}
                          className="w-20 px-1.5 py-1 bg-surface-1 border border-line rounded text-positive font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={row.cargoStatus}
                          onChange={(e) => handleCellChange(idx, "cargoStatus", e.target.value)}
                          className="px-2 py-1 bg-surface-1 border border-line rounded text-xs text-ink"
                        >
                          <option value="Tam Geldi">Tam Geldi</option>
                          <option value="İPTAL">İPTAL</option>
                          <option value="Yolda">Yolda</option>
                          <option value="Kayıp Depoya gelmiş">Kayıp Depoya gelmiş</option>
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(idx)}
                          className="p-1 text-ink-faint hover:text-danger transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-line">
          <span className="text-xs text-ink-faint font-mono-tech">
            {previewRows.length > 0
              ? `${previewRows.length} satır veritabanına kaydedilmeye hazır`
              : "Lütfen bir dosya yükleyin veya Google Drive linki girin"}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-mono-tech text-ink-muted hover:text-ink transition"
            >
              Vazgeç
            </button>
            <button
              onClick={handleCommitToDatabase}
              disabled={importing || previewRows.length === 0}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-surface-base font-mono-tech text-xs uppercase font-bold tracking-wider transition flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Upload className="w-4 h-4" />
              {importing
                ? "Veritabanına Aktarılıyor..."
                : `${previewRows.length} Siparişi Veritabanına Aktar`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
