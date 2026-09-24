"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

/**
 * CERBERUS — Rutin Kontrol Listesi + Araç/Varlık Takibi (F-07)
 *
 * Kaynak: kullanıcının yüklediği "Amazon Mağaza Ekibi Rutin" belgesi.
 * Kullanıcı onayı (2026-09-25): İKİSİ BİRDEN, ayrı iki bölüm olarak; her
 * mağazanın kendi STORE_USER'ı kendi rutinini işaretler, ADMIN/MANAGER
 * filo genelinde roll-up görür. Bu ekran o iki bölümü tek sayfada, üstte
 * bir segment anahtarıyla sunar — StoreHealthScreen ile aynı "canlı veri,
 * uydurma yok" ilkesini takip eder.
 */

type RoutineFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

interface RoutineDefinitionView {
  id: string;
  frequency: RoutineFrequency;
  title: string;
  description: string;
  requiresEvidence: boolean;
}
interface RoutineItemStatus {
  routine: RoutineDefinitionView;
  currentPeriodKey: string;
  done: boolean;
  completedBy: string | null;
  completedAt: string | null;
  note: string | null;
}
interface StoreRoutineBoard {
  storeCode: string;
  storeName: string;
  status: string;
  daily: RoutineItemStatus[];
  weekly: RoutineItemStatus[];
  monthly: RoutineItemStatus[];
  completionRatePercent: number | null;
  overdueCount: number;
}
interface RoutineBoardData {
  storeScope: string;
  boards: StoreRoutineBoard[];
  summary: { totalStores: number; totalOverdue: number; avgCompletionRate: number | null };
}

type AssetType = "SUBSCRIPTION" | "DOMAIN" | "HOSTING" | "SHOPIFY_SITE" | "OTHER";
type AssetStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_TRACKED";

interface AssetView {
  id: number;
  storeCode: string | null;
  assetType: AssetType;
  name: string;
  provider: string | null;
  url: string | null;
  expiresAt: string | null;
  renewalCost: number | null;
  notes: string | null;
  lastCheckedAt: string | null;
  lastCheckedBy: string | null;
  status: AssetStatus;
  daysUntilExpiry: number | null;
}
interface AssetBoardData {
  storeScope: string;
  assets: AssetView[];
  summary: { total: number; expired: number; expiringSoon: number; notTracked: number };
}

const FREQ_LABEL: Record<RoutineFrequency, string> = {
  DAILY: "Günlük",
  WEEKLY: "Haftalık",
  MONTHLY: "Aylık",
};

const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  SUBSCRIPTION: "Abonelik/Üyelik",
  DOMAIN: "Alan Adı",
  HOSTING: "Hosting",
  SHOPIFY_SITE: "Shopify Site",
  OTHER: "Diğer",
};

const ASSET_STATUS_TONE: Record<AssetStatus, string> = {
  ACTIVE: "text-positive border-positive/30 bg-positive/10",
  EXPIRING_SOON: "text-caution border-caution/30 bg-caution/10",
  EXPIRED: "text-danger border-danger/30 bg-danger/10",
  NOT_TRACKED: "text-ink-faint border-line bg-surface-2",
};

const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  ACTIVE: "Aktif",
  EXPIRING_SOON: "Yakında Doluyor",
  EXPIRED: "Süresi Geçti",
  NOT_TRACKED: "Takip Edilmiyor",
};

function RoutineRow({
  item,
  onComplete,
  disabled,
}: {
  item: RoutineItemStatus;
  onComplete: (routineId: string, note: string | null) => void;
  disabled: boolean;
}) {
  const [noteDraft, setNoteDraft] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line/60 bg-surface-2/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {item.done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          )}
          <div>
            <div className="text-xs font-bold text-ink">
              {item.routine.title}
              {item.routine.requiresEvidence && (
                <span className="ml-1.5 rounded-full border border-caution/30 bg-caution/10 px-1.5 py-0.5 text-[9px] font-mono-tech text-caution">
                  kanıt istenir
                </span>
              )}
            </div>
            <div className="text-[11px] text-ink-muted">{item.routine.description}</div>
            {item.done && (
              <div className="mt-0.5 text-[10px] font-mono-tech text-ink-faint">
                {item.completedBy} · {item.completedAt ? new Date(item.completedAt).toLocaleString("tr-TR") : ""}
                {item.note ? ` · "${item.note}"` : item.routine.requiresEvidence ? " · kanıt notu eksik" : ""}
              </div>
            )}
          </div>
        </div>
        {!item.done && !disabled && (
          <button
            onClick={() => (showNoteInput ? onComplete(item.routine.id, noteDraft.trim() || null) : setShowNoteInput(true))}
            className="shrink-0 rounded-lg bg-positive/90 hover:bg-positive px-2.5 py-1 text-[10px] font-mono-tech font-bold uppercase text-ink"
          >
            {showNoteInput ? "Kaydet" : "İşaretle"}
          </button>
        )}
      </div>
      {showNoteInput && !item.done && (
        <input
          autoFocus
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Kısa not / kanıt (opsiyonel)"
          className="rounded-lg border border-line bg-surface-1 px-2 py-1 text-[11px] text-ink"
        />
      )}
    </div>
  );
}

function RoutineBoardCard({
  board,
  onComplete,
  canAct,
  defaultExpanded,
}: {
  board: StoreRoutineBoard;
  onComplete: (storeCode: string, routineId: string, note: string | null) => void;
  canAct: boolean;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono-tech text-sm font-bold text-brand-soft">{board.storeCode}</span>
          <span className="text-xs text-ink-muted">{board.storeName}</span>
        </div>
        <div className="flex items-center gap-3">
          {board.overdueCount > 0 && (
            <span className="flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-mono-tech font-bold text-danger">
              <AlertTriangle className="h-3 w-3" /> {board.overdueCount} gecikmiş
            </span>
          )}
          <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-bold text-ink tabular">
            {board.completionRatePercent ?? 0}% tamam
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-mono-tech text-ink-faint hover:text-ink"
          >
            {expanded ? "kapat" : "detay"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-4">
          {(["daily", "weekly", "monthly"] as const).map((key) => {
            const items = board[key];
            const freq = key === "daily" ? "DAILY" : key === "weekly" ? "WEEKLY" : "MONTHLY";
            return (
              <div key={key}>
                <div className="mb-1.5 text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">
                  {FREQ_LABEL[freq as RoutineFrequency]} ({items.filter((i) => i.done).length}/{items.length})
                </div>
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <RoutineRow
                      key={item.routine.id}
                      item={item}
                      disabled={!canAct}
                      onComplete={(routineId, note) => onComplete(board.storeCode, routineId, note)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoutineChecklistSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RoutineBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/operations/routines", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Rutin panosu yüklenemedi");
      setData(j as RoutineBoardData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleComplete(storeCode: string, routineId: string, note: string | null) {
    setActionError(null);
    try {
      const res = await fetch("/api/operations/routines/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeCode, routineId, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "İşaretlenemedi");
      await load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-soft" />
        <span className="mt-2 text-xs font-mono-tech text-ink-faint">Rutin panosu hesaplanıyor…</span>
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

  const { boards, summary } = data;
  const singleStore = boards.length === 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={load} className="rounded-xl border border-line bg-surface-1 p-2 text-ink-muted hover:text-ink">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Mağaza</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{summary.totalStores}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Ort. Tamamlanma</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{summary.avgCompletionRate ?? 0}%</div>
        </div>
        <div className="rounded-2xl border border-danger/20 bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Toplam Gecikmiş</div>
          <div className={`mt-1 text-lg font-bold tabular ${summary.totalOverdue > 0 ? "text-danger" : "text-ink"}`}>
            {summary.totalOverdue}
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">{actionError}</div>
      )}

      <div className="space-y-3">
        {boards.map((board) => (
          <RoutineBoardCard
            key={board.storeCode}
            board={board}
            onComplete={handleComplete}
            canAct
            defaultExpanded={singleStore}
          />
        ))}
        {!boards.length && <div className="text-xs text-ink-faint">Mağaza yok</div>}
      </div>
    </div>
  );
}

function AssetForm({
  storeOptions,
  isAdminScope,
  defaultStoreCode,
  onCreated,
}: {
  storeOptions: Array<{ storeCode: string; storeName: string }>;
  isAdminScope: boolean;
  defaultStoreCode: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>("SUBSCRIPTION");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [url, setUrl] = useState("");
  const [storeCode, setStoreCode] = useState<string>(defaultStoreCode ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setFormError("Varlık adı zorunludur.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/operations/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeCode: storeCode.trim() === "" ? null : storeCode,
          assetType,
          name: name.trim(),
          provider: provider.trim() || null,
          url: url.trim() || null,
          expiresAt: expiresAt.trim() === "" ? null : new Date(expiresAt).toISOString(),
          notes: notes.trim() || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Varlık eklenemedi");
      setName("");
      setProvider("");
      setUrl("");
      setExpiresAt("");
      setNotes("");
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs font-mono-tech font-bold text-ink-muted hover:text-ink"
      >
        <Plus className="h-4 w-4" /> Yeni Varlık Ekle
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value as AssetType)}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink"
        >
          {Object.entries(ASSET_TYPE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ad (ör. ASINZEN Üyeliği, cerberustrade.com)"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink col-span-2"
        />
        <input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="Sağlayıcı (ör. GoDaddy, Keepa)"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL (opsiyonel)"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink"
        />
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink"
        />
        {isAdminScope ? (
          <select
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink"
          >
            <option value="">Şirket Geneli</option>
            {storeOptions.map((s) => (
              <option key={s.storeCode} value={s.storeCode}>
                {s.storeCode} — {s.storeName}
              </option>
            ))}
          </select>
        ) : (
          <input disabled value={storeCode} className="rounded-lg border border-line bg-surface-2/50 px-2 py-1.5 text-xs text-ink-faint" />
        )}
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Not (opsiyonel)"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink col-span-2 md:col-span-3"
        />
      </div>
      {formError && <div className="text-[11px] text-danger">{formError}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-positive/90 hover:bg-positive px-3 py-1.5 text-xs font-mono-tech font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-mono-tech text-ink-muted"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function AssetRow({ asset, onUpdated }: { asset: AssetView; onUpdated: () => void }) {
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [expiryDraft, setExpiryDraft] = useState(asset.expiresAt ? asset.expiresAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/operations/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Güncellenemedi");
      }
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/operations/assets/${asset.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Silinemedi");
      }
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${ASSET_STATUS_TONE[asset.status]}`}>
        {ASSET_STATUS_LABEL[asset.status]}
        {asset.daysUntilExpiry !== null ? ` (${asset.daysUntilExpiry}g)` : ""}
      </span>
      <div className="min-w-[160px] flex-1">
        <div className="text-xs font-bold text-ink">
          {asset.name}{" "}
          <span className="text-ink-faint font-mono-tech text-[10px]">
            {ASSET_TYPE_LABEL[asset.assetType]} · {asset.storeCode ?? "Şirket Geneli"}
          </span>
        </div>
        <div className="text-[11px] text-ink-muted">
          {asset.provider ? `${asset.provider} · ` : ""}
          {asset.url ? (
            <a href={asset.url} target="_blank" rel="noreferrer" className="text-brand-soft underline">
              {asset.url}
            </a>
          ) : null}
        </div>
        {asset.lastCheckedAt && (
          <div className="text-[10px] font-mono-tech text-ink-faint">
            son kontrol: {asset.lastCheckedBy} · {new Date(asset.lastCheckedAt).toLocaleDateString("tr-TR")}
          </div>
        )}
      </div>
      {editingExpiry ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={expiryDraft}
            onChange={(e) => setExpiryDraft(e.target.value)}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-ink"
          />
          <button
            disabled={busy}
            onClick={async () => {
              await patch({ expiresAt: expiryDraft.trim() === "" ? null : new Date(expiryDraft).toISOString() });
              setEditingExpiry(false);
            }}
            className="rounded bg-positive/90 hover:bg-positive px-2 py-1 text-[10px] font-bold uppercase text-ink"
          >
            Kaydet
          </button>
          <button onClick={() => setEditingExpiry(false)} className="text-[10px] text-ink-faint">
            vazgeç
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditingExpiry(true)}
          className="rounded-lg border border-line px-2 py-1 text-[10px] font-mono-tech text-ink-muted hover:text-ink"
        >
          {asset.expiresAt ? new Date(asset.expiresAt).toLocaleDateString("tr-TR") : "süre gir"}
        </button>
      )}
      <button
        disabled={busy}
        onClick={() => patch({ markChecked: true })}
        className="rounded-lg border border-line px-2 py-1 text-[10px] font-mono-tech text-ink-muted hover:text-ink"
      >
        kontrol edildi
      </button>
      <button
        disabled={busy}
        onClick={remove}
        className="rounded-lg border border-danger/30 px-2 py-1 text-danger hover:bg-danger/10"
        title="Sil (yalnız ADMIN/MANAGER)"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AssetTrackerSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AssetBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storeOptions, setStoreOptions] = useState<Array<{ storeCode: string; storeName: string }>>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [assetRes, routineRes] = await Promise.all([
        fetch("/api/operations/assets", { cache: "no-store" }),
        fetch("/api/operations/routines", { cache: "no-store" }),
      ]);
      const assetJson = await assetRes.json();
      if (!assetRes.ok) throw new Error(assetJson.error || "Varlık listesi yüklenemedi");
      setData(assetJson as AssetBoardData);

      if (routineRes.ok) {
        const routineJson = (await routineRes.json()) as RoutineBoardData;
        setStoreOptions(routineJson.boards.map((b) => ({ storeCode: b.storeCode, storeName: b.storeName })));
      }
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
        <span className="mt-2 text-xs font-mono-tech text-ink-faint">Varlık listesi yükleniyor…</span>
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

  const isAdminScope = data.storeScope === "ALL";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Toplam Varlık</div>
          <div className="mt-1 text-lg font-bold tabular text-ink">{data.summary.total}</div>
        </div>
        <div className="rounded-2xl border border-danger/20 bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Süresi Geçmiş</div>
          <div className={`mt-1 text-lg font-bold tabular ${data.summary.expired > 0 ? "text-danger" : "text-ink"}`}>
            {data.summary.expired}
          </div>
        </div>
        <div className="rounded-2xl border border-caution/20 bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Yakında Doluyor</div>
          <div className="mt-1 text-lg font-bold tabular text-caution">{data.summary.expiringSoon}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-3">
          <div className="text-[10px] font-mono-tech uppercase tracking-widest text-ink-faint">Takip Edilmiyor</div>
          <div className="mt-1 text-lg font-bold tabular text-ink-faint">{data.summary.notTracked}</div>
        </div>
      </div>

      <AssetForm
        storeOptions={storeOptions}
        isAdminScope={isAdminScope}
        defaultStoreCode={isAdminScope ? null : data.storeScope}
        onCreated={load}
      />

      <div className="space-y-2">
        {data.assets.map((a) => (
          <AssetRow key={a.id} asset={a} onUpdated={load} />
        ))}
        {!data.assets.length && (
          <div className="rounded-xl border border-line bg-surface-1 p-8 text-center text-xs text-ink-faint">
            Henüz takip edilen varlık yok — ASINZEN/Keepa üyeliği, GoDaddy alan adı veya Shopify site ekleyin.
          </div>
        )}
      </div>
    </div>
  );
}

export function RoutineOperationsScreen() {
  const [section, setSection] = useState<"ROUTINES" | "ASSETS">("ROUTINES");

  const tabs = useMemo(
    () =>
      [
        { id: "ROUTINES" as const, label: "Rutin Kontrol Listesi", icon: ClipboardList },
        { id: "ASSETS" as const, label: "Araç & Varlık Takibi", icon: KeyRound },
      ] as const,
    []
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted font-mono-tech">
          Kaynak: mağaza ekibi rutin belgesi — konsolide tek operatör modeli. İki ayrı bölüm: günlük/haftalık/aylık
          kontrol listesi ve araç/abonelik/domain takibi.
        </p>
        <div className="flex rounded-xl border border-line bg-surface-1 p-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSection(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono-tech font-bold transition ${
                  section === t.id ? "bg-brand-soft/20 text-brand-soft" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "ROUTINES" ? <RoutineChecklistSection /> : <AssetTrackerSection />}
    </div>
  );
}
