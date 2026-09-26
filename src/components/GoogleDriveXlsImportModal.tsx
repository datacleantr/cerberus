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
  Columns3,
  Info,
} from "lucide-react";
import {
  guessColumnMapping,
  buildRowsFromMapping,
  type ColumnMapping,
  type XlsRowDefaults,
} from "@/lib/xlsRowMapping";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_TYPE_LABELS,
  detectColumnSampleType,
  isColumnTypeCompatible,
  normalizeHeaderLabel,
} from "@/lib/importFieldSchema";

/**
 * Kolon eşleme (column mapping) — kullanıcı isteği: farklı XLS/Drive
 * kaynakları CERBERUS'un kilitli 40-kolon standardından farklı sırada/adda
 * kolonlara sahip olabilir. Eskiden üç girdi yolu da (dosya/Drive/yapıştır)
 * doğrudan pozisyonel `parseXlsMatrix`'i çağırıyordu — kolon sırası farklı
 * bir dosya sessizce yanlış eşlenirdi. Artık ham matris önce bu eşleme
 * adımından geçiyor: başlıklar otomatik tahmin edilir (bilinen alan
 * adı/eşanlamlısıyla), kullanıcı onaylar/düzeltir, tip uyuşmazlıkları
 * (ör. bir para alanına metin kolon eşlenmesi) inline uyarılır.
 */
const MAPPING_STORAGE_PREFIX = "cerberus:xlsColumnMapping:v1:";
const IGNORE_FIELD = "__IGNORE__";

function headerSignature(headers: string[]): string {
  return headers.map((h) => normalizeHeaderLabel(h)).join("|");
}

function loadSavedMapping(headers: string[]): ColumnMapping | null {
  try {
    const raw = window.localStorage.getItem(MAPPING_STORAGE_PREFIX + headerSignature(headers));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ColumnMapping) : null;
  } catch {
    return null;
  }
}

function saveMapping(headers: string[], mapping: ColumnMapping) {
  try {
    window.localStorage.setItem(MAPPING_STORAGE_PREFIX + headerSignature(headers), JSON.stringify(mapping));
  } catch {
    // localStorage kullanılamıyorsa (gizli sekme vb.) sessizce yut — eşleme
    // yine de bu oturum için çalışmaya devam eder, yalnız hatırlanmaz.
  }
}

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

  // ── Kolon eşleme (column mapping) state'i ──
  const [rawMatrix, setRawMatrix] = useState<any[][] | null>(null);
  const [pendingDefaults, setPendingDefaults] = useState<XlsRowDefaults | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [showMappingStep, setShowMappingStep] = useState(false);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);

  // Submission state
  const [importing, setImporting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultWarning, setResultWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const headerRow: string[] = rawMatrix ? rawMatrix[0].map((h) => String(h ?? "").trim()) : [];
  const dataRows: any[][] = rawMatrix ? rawMatrix.slice(1) : [];

  /**
   * Ham matrisi (başlık + veri) alır. Daha önce bu tam başlık için
   * kaydedilmiş bir eşleme varsa sessizce uygular (kullanıcı her seferinde
   * aynı formatı yeniden eşlemesin diye); yoksa otomatik tahmin üretir ve
   * kullanıcının onaylaması için eşleme adımını açar.
   */
  const beginMappingFlow = (matrix: any[][], defaults: XlsRowDefaults) => {
    const headers = matrix[0].map((h: any) => String(h ?? "").trim());
    setRawMatrix(matrix);
    setPendingDefaults(defaults);
    setMappingNotice(null);

    const saved = loadSavedMapping(headers);
    if (saved && Object.keys(saved).length > 0) {
      const rows = buildRowsFromMapping(matrix, saved, defaults);
      if (rows.length > 0) {
        setColumnMapping(saved);
        setPreviewRows(rows);
        setShowMappingStep(false);
        setMappingNotice(
          `Bu dosya formatı için daha önce kaydettiğiniz kolon eşlemesi otomatik uygulandı (${Object.keys(saved).length} kolon). Değiştirmek isterseniz aşağıdan "Eşlemeyi Düzenle"ye tıklayın.`
        );
        return;
      }
    }
    setColumnMapping(guessColumnMapping(headers));
    setShowMappingStep(true);
  };

  const handleMappingChange = (colIndex: number, fieldKey: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      // Aynı alanı başka bir kolona atamışsa oradan kaldır (bir alan yalnızca bir kolona bağlanabilir)
      for (const key of Object.keys(next)) {
        if (next[Number(key)] === fieldKey) delete next[Number(key)];
      }
      if (fieldKey === IGNORE_FIELD) {
        delete next[colIndex];
      } else {
        next[colIndex] = fieldKey;
      }
      return next;
    });
  };

  const mappedFieldKeys = new Set(Object.values(columnMapping));
  const missingRequiredFields = IMPORT_FIELDS.filter(
    (f) => f.required && !mappedFieldKeys.has(f.key)
  );

  const handleConfirmMapping = () => {
    if (!rawMatrix || !pendingDefaults) return;
    if (missingRequiredFields.length > 0) {
      setErrorMsg(
        `Zorunlu alanlar eşlenmeden devam edilemez: ${missingRequiredFields.map((f) => f.label).join(", ")}.`
      );
      return;
    }
    setErrorMsg(null);
    const rows = buildRowsFromMapping(rawMatrix, columnMapping, pendingDefaults);
    if (rows.length === 0) {
      setErrorMsg("Bu eşlemeyle hiçbir geçerli satır üretilemedi. Lütfen kolon eşlemesini gözden geçirin.");
      return;
    }
    saveMapping(headerRow, columnMapping);
    setPreviewRows(rows);
    setShowMappingStep(false);
    setMappingNotice(null);
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
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const fileMatrix: any[][] = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
        });

        if (!fileMatrix || fileMatrix.length < 2) {
          setErrorMsg("Excel dosyasında geçerli veri satırı bulunamadı. İlk satır başlık olmalıdır.");
          return;
        }
        beginMappingFlow(fileMatrix, { defaultStore: store, defaultProductTitle: "Excel Siparişi" });
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
      if (res.ok && Array.isArray(data.rawMatrix) && data.rawMatrix.length >= 2) {
        setFileName("Google Drive E-Tablo");
        beginMappingFlow(data.rawMatrix, {
          defaultStore: store,
          defaultProductTitle: "Google Drive Ürünü",
          defaultDriveLink: driveUrl,
        });
      } else {
        setErrorMsg(data.error || "Google Drive linki çözümlenemedi veya tabloda satır bulunamadı.");
      }
    } catch {
      setErrorMsg("Bağlantı hatası oluştu.");
    } finally {
      setFetchingDrive(false);
    }
  };

  // 3. Parse pasted TSV / CSV text
  //
  // Yapıştırılan metnin ilk satırı gerçek bir başlık mı, yoksa doğrudan veri
  // mi belli değildir (kullanıcı ikisini de yapabilir). Otomatik eşleme,
  // ilk satırı aday başlık kabul edip en az 2 kolonu tanıyabiliyorsa gerçek
  // başlık sayılır; tanıyamıyorsa tüm satırlar veri kabul edilir ve kolonlara
  // "Kolon 1", "Kolon 2" gibi anonim adlar verilir — bu durumda otomatik
  // eşleme boş kalır ve kullanıcı eşleme adımında manuel seçer.
  const handleParsePaste = () => {
    setErrorMsg(null);
    if (!tsvText.trim()) return;
    const lines = tsvText.trim().split("\n");
    const dataRowsRaw = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")));
    if (dataRowsRaw.length === 0) {
      setErrorMsg("Yapıştırılan metinde geçerli satır bulunamadı.");
      return;
    }

    const candidateHeader = dataRowsRaw[0].map((c) => String(c ?? ""));
    const guessedFromFirstRow = guessColumnMapping(candidateHeader);
    const firstRowLooksLikeHeader = Object.keys(guessedFromFirstRow).length >= 2;

    let matrix: any[][];
    if (firstRowLooksLikeHeader) {
      matrix = dataRowsRaw;
    } else {
      const colCount = Math.max(...dataRowsRaw.map((r) => r.length));
      const anonymousHeader = Array.from({ length: colCount }, (_, i) => `Kolon ${i + 1}`);
      matrix = [anonymousHeader, ...dataRowsRaw];
    }

    if (matrix.length < 2) {
      setErrorMsg("Yapıştırılan metinde geçerli veri satırı bulunamadı.");
      return;
    }
    setFileName("Panodan Yapıştırılan Veri");
    beginMappingFlow(matrix, { defaultStore: store, defaultProductTitle: "Panodan Yapıştırılan Veri" });
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

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* KOLON EŞLEME ADIMI — dosya/Drive/yapıştır standarttan farklı  */}
        {/* sırada/adda kolonlara sahipse burada düzeltilir              */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {showMappingStep && rawMatrix && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-info/10 border border-info/30 text-xs font-mono-tech text-ink-muted flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-info mt-0.5" />
              <span>
                Başlıklar otomatik tanınmaya çalışıldı. Her kolon için doğru alanı seçin/onaylayın —
                <strong className="text-ink"> ⚠ işareti</strong>, o kolondaki örnek değerlerin seçilen
                alanın beklediği tiple (sayı/tarih/metin) uyuşmadığını gösterir. Onayladığınız eşleme bu
                dosya formatı için hatırlanır, bir sonraki seferde otomatik uygulanır.
              </span>
            </div>

            {missingRequiredFields.length > 0 && (
              <div className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-mono-tech">
                Zorunlu alanlar henüz eşlenmedi: {missingRequiredFields.map((f) => f.label).join(", ")}
              </div>
            )}

            <div className="border border-line rounded-xl overflow-hidden bg-surface-base max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono-tech">
                <thead className="bg-surface-1 text-ink-muted border-b border-line text-[11px] sticky top-0">
                  <tr>
                    <th className="p-2.5">#</th>
                    <th className="p-2.5">Kaynak Kolon</th>
                    <th className="p-2.5">Örnek Değerler</th>
                    <th className="p-2.5">Eşlenecek Alan</th>
                    <th className="p-2.5">Tip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {headerRow.map((header, colIndex) => {
                    const fieldKey = columnMapping[colIndex] ?? IGNORE_FIELD;
                    const fieldDef = IMPORT_FIELDS.find((f) => f.key === fieldKey);
                    const samples = dataRows
                      .map((r) => r[colIndex])
                      .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
                      .slice(0, 3);
                    const detected = detectColumnSampleType(dataRows.map((r) => r[colIndex]));
                    const mismatch = fieldDef ? !isColumnTypeCompatible(fieldDef.type, detected) : false;

                    return (
                      <tr key={colIndex} className={mismatch ? "bg-caution/5" : undefined}>
                        <td className="p-2 text-ink-faint">{colIndex + 1}</td>
                        <td className="p-2 font-bold text-ink">{header || <span className="text-ink-faint italic">(boş başlık)</span>}</td>
                        <td className="p-2 text-ink-muted max-w-[220px] truncate" title={samples.join(", ")}>
                          {samples.length ? samples.join(", ") : <span className="text-ink-faint italic">örnek yok</span>}
                        </td>
                        <td className="p-2">
                          <select
                            value={fieldKey}
                            onChange={(e) => handleMappingChange(colIndex, e.target.value)}
                            className={`px-2 py-1.5 bg-surface-1 border rounded-lg text-xs min-w-[180px] ${
                              mismatch ? "border-caution text-caution" : "border-line text-ink"
                            }`}
                          >
                            <option value={IGNORE_FIELD}>— Yoksay —</option>
                            <optgroup label="Zorunlu Alanlar">
                              {IMPORT_FIELDS.filter((f) => f.required).map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Diğer Alanlar">
                              {IMPORT_FIELDS.filter((f) => !f.required).map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </td>
                        <td className="p-2">
                          {fieldDef ? (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 w-fit ${
                                mismatch
                                  ? "bg-caution/15 text-caution border-caution/40"
                                  : "bg-surface-2 text-ink-muted border-line"
                              }`}
                              title={
                                mismatch
                                  ? `Bu kolonun örnek değerleri "${detected}" görünüyor ama "${fieldDef.label}" alanı "${IMPORT_FIELD_TYPE_LABELS[fieldDef.type]}" bekliyor.`
                                  : undefined
                              }
                            >
                              {mismatch && <AlertTriangle className="w-3 h-3" />}
                              {IMPORT_FIELD_TYPE_LABELS[fieldDef.type]}
                            </span>
                          ) : (
                            <span className="text-ink-faint text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-ink-faint font-mono-tech">
                Kaynak: {fileName || "Dosya"} • {dataRows.length} veri satırı bulundu
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRawMatrix(null);
                    setPendingDefaults(null);
                    setColumnMapping({});
                    setShowMappingStep(false);
                    setFileName(null);
                    setErrorMsg(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-mono-tech text-ink-muted hover:text-ink transition"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleConfirmMapping}
                  disabled={missingRequiredFields.length > 0}
                  className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-soft disabled:opacity-40 text-ink font-mono-tech text-xs uppercase font-bold tracking-wider transition flex items-center gap-2"
                >
                  <Columns3 className="w-4 h-4" />
                  Eşlemeyi Onayla ve Devam Et
                </button>
              </div>
            </div>
          </div>
        )}

        {mappingNotice && !showMappingStep && (
          <div className="p-3 rounded-xl bg-info/10 border border-info/30 text-xs font-mono-tech text-ink-muted flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 text-info mt-0.5" />
            <span className="flex-1">{mappingNotice}</span>
            <button
              type="button"
              onClick={() => setShowMappingStep(true)}
              className="shrink-0 text-brand-soft hover:underline font-bold whitespace-nowrap"
            >
              Eşlemeyi Düzenle
            </button>
          </div>
        )}

        {/* EXCEL BENZERİ HÜCRE DÜZENLEYİCİ ÖNİZLEME TABLOSU (SPREADSHEET PREVIEW & EDIT GRID) */}
        {!showMappingStep && previewRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono-tech">
              <span className="text-positive font-bold flex items-center gap-1.5">
                <Edit3 className="w-4 h-4" />
                Önizleme &amp; Excel Tarzı Hücre Düzenleme ({previewRows.length} Satır Hazır)
              </span>
              <div className="flex items-center gap-3 text-[11px]">
                {rawMatrix && (
                  <button
                    type="button"
                    onClick={() => setShowMappingStep(true)}
                    className="text-brand-soft hover:underline font-bold flex items-center gap-1"
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    Eşlemeyi Düzenle
                  </button>
                )}
                <span className="text-ink-muted">
                  Kaynak: {fileName || "Dosya"} • Hücrelere tıklayıp kaydetmeden önce düzeltebilirsiniz
                </span>
              </div>
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

        {/* Footer Actions — kolon eşleme adımı açıkken gizli (o adımın kendi Vazgeç/Onayla düğmeleri var) */}
        {!showMappingStep && (
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
        )}
      </div>
    </div>
  );
}
