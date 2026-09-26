"use client";

import { clientLog } from "@/lib/clientLogger";
import React, { useCallback, useDeferredValue, useState, useEffect } from "react";
import {
  Store,
  Users,
  ShieldCheck,
  Plus,
  XCircle,
  History,
  Activity,
  CheckCircle2,
  Key,
  Globe,
  TrendingUp,
  Server,
  Zap,
  Trash2,
  AlertTriangle,
  Database,
  RefreshCw,
  FileSpreadsheet,
  Package,
  Layers,
  SlidersHorizontal,
} from "lucide-react";
import { ThresholdSettings } from "@/features/settings/ThresholdSettings";
import type { SessionUser } from "@/lib/session";

interface AdminDashboardProps {
  onStoreSelected?: (storeCode: string) => void;
  currentUser: SessionUser;
  onDataRefresh?: () => void;
}

export function AdminDashboard({
  onStoreSelected,
  currentUser,
  onDataRefresh,
}: AdminDashboardProps) {
  const [activeSubTab, setActiveSubTab] = useState<
    "STORES" | "USERS" | "ORDERS_CRUD" | "SP_API" | "AUDIT" | "DB_TOOLS" | "SETTINGS"
  >("STORES");

  const [stores, setStores] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Denetim izi (AUDIT) sekmesi — kendi bağımsız, sayfalanan/filtrelenen
  // ucundan (GET /api/admin/audit-logs) beslenir; artık ORDERS_CRUD
  // sekmesinin mağaza filtresine bağımlı değil (bkz. fetchAuditLogs).
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditStoreFilter, setAuditStoreFilter] = useState("ALL");
  const [auditActionFilter, setAuditActionFilter] = useState("ALL");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageCount, setAuditPageCount] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);

  // Filter for orders subtab
  const [orderStoreFilter, setOrderStoreFilter] = useState("ALL");
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const deferredOrderSearch = useDeferredValue(orderSearchQuery);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageCount, setOrderPageCount] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // New Store Modal state
  const [isNewStoreModalOpen, setIsNewStoreModalOpen] = useState(false);
  const [storeCode, setStoreCode] = useState("");
  const [storeName, setStoreName] = useState("");
  const [marketplace, setMarketplace] = useState("AMAZON");
  const [buyerName, setBuyerName] = useState("");
  const [defaultCard, setDefaultCard] = useState("");
  const [defaultEmail, setDefaultEmail] = useState("");
  const [storeNotes, setStoreNotes] = useState("");
  const [purchaseApprovalThreshold, setPurchaseApprovalThreshold] = useState("");
  const [savingStore, setSavingStore] = useState(false);
  const [editingThresholdFor, setEditingThresholdFor] = useState<number | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);

  // New User Modal state
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("STORE_USER");
  const [newUserStore, setNewUserStore] = useState("HRN");
  const [newUserPass, setNewUserPass] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  // Parola sıfırlama (admin panelinde eksikti — PATCH /api/admin/users
  // zaten opsiyonel `password` alanını destekliyordu, ama hiçbir UI onu
  // kullanmıyordu; bir kullanıcı parolasını unuttuğunda admin panelden
  // sıfırlama yolu yoktu).
  const [resetPasswordFor, setResetPasswordFor] = useState<number | null>(null);
  const [resetPasswordDraft, setResetPasswordDraft] = useState("");
  const [savingPasswordReset, setSavingPasswordReset] = useState(false);

  // Database Reset confirmation state
  const [confirmationInput, setConfirmationInput] = useState("");
  const [resettingDb, setResettingDb] = useState(false);

  // Status message
  const [feedbackMsg, setFeedbackMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showFeedback = (text: string, type: "success" | "error" = "success") => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 4500);
  };

  const fetchAdminData = useCallback(async () => {
    try {
      const [storesRes, usersRes] = await Promise.all([
        fetch("/api/admin/stores"),
        currentUser.role === "ADMIN" ? fetch("/api/admin/users") : Promise.resolve(null),
      ]);

      if (storesRes.ok) {
        const data = await storesRes.json();
        setStores(data.stores || []);
      }
      if (usersRes?.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      clientLog.error("admin/fetch", "Admin verisi alınamadı", { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, [currentUser.role]);

  const fetchOrderPage = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams({
        storeCode: orderStoreFilter,
        page: String(orderPage),
        pageSize: "50",
      });
      if (deferredOrderSearch.trim()) params.set("search", deferredOrderSearch.trim());

      const response = await fetch(`/api/orders?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Sipariş sayfası yüklenemedi.");
      }
      setOrders(data.orders || []);
      const nextPageCount = Math.max(1, Number(data.pagination?.pageCount || 1));
      setOrderTotal(Number(data.pagination?.total || 0));
      setOrderPageCount(nextPageCount);
      if (orderPage > nextPageCount) setOrderPage(nextPageCount);
    } catch (error) {
      setFeedbackMsg({
        type: "error",
        text: error instanceof Error ? error.message : "Sipariş sayfası yüklenemedi.",
      });
    } finally {
      setOrdersLoading(false);
    }
  }, [deferredOrderSearch, orderPage, orderStoreFilter]);

  // Denetim izi kendi bağımsız, sayfalanan ucundan beslenir (GET
  // /api/admin/audit-logs) — artık ORDERS_CRUD sekmesinin mağaza filtresine
  // bağımlı, 40 kayıtla sınırlı eski davranış yok.
  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        storeCode: auditStoreFilter,
        actionType: auditActionFilter,
        page: String(auditPage),
        pageSize: "50",
      });
      const response = await fetch(`/api/admin/audit-logs?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Denetim izi yüklenemedi.");
      }
      setAuditLogs(data.auditLogs || []);
      const nextPageCount = Math.max(1, Number(data.pagination?.pageCount || 1));
      setAuditTotal(Number(data.pagination?.total || 0));
      setAuditPageCount(nextPageCount);
      if (auditPage > nextPageCount) setAuditPage(nextPageCount);
    } catch (error) {
      setFeedbackMsg({
        type: "error",
        text: error instanceof Error ? error.message : "Denetim izi yüklenemedi.",
      });
    } finally {
      setAuditLoading(false);
    }
  }, [auditActionFilter, auditPage, auditStoreFilter]);

  useEffect(() => {
    // Effect gövdesinde senkron setState yapılmaz; yükleme async akışta yönetilir.
    void fetchAdminData();
  }, [fetchAdminData]);

  useEffect(() => {
    void fetchOrderPage();
  }, [fetchOrderPage]);

  useEffect(() => {
    if (activeSubTab === "AUDIT") {
      void fetchAuditLogs();
    }
  }, [activeSubTab, fetchAuditLogs]);

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeCode || !storeName) return;
    setSavingStore(true);
    try {
      const res = await fetch("/api/admin/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeCode,
          storeName,
          marketplace,
          buyerName: buyerName || "Alıcı Sorumlusu",
          ...(currentUser.role === "ADMIN"
            ? { defaultCard, defaultEmail }
            : {}),
          notes: storeNotes,
          purchaseApprovalThreshold: purchaseApprovalThreshold.trim() === "" ? null : Number(purchaseApprovalThreshold),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showFeedback(data.message || "Mağaza başarıyla oluşturuldu.");
        setIsNewStoreModalOpen(false);
        setStoreCode("");
        setStoreName("");
        setPurchaseApprovalThreshold("");
        fetchAdminData();
        if (onDataRefresh) onDataRefresh();
      } else {
        showFeedback(data.error || "Mağaza oluşturulamadı", "error");
      }
    } catch (err: any) {
      showFeedback(err.message, "error");
    } finally {
      setSavingStore(false);
    }
  };

  const handleToggleStoreStatus = async (store: any) => {
    const nextStatus = store.status === "ACTIVE" ? "PASSIVE" : "ACTIVE";
    try {
      const res = await fetch("/api/admin/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: store.id,
          status: nextStatus,
        }),
      });
      if (res.ok) {
        setStores((prev) =>
          prev.map((s) => (s.id === store.id ? { ...s, status: nextStatus } : s))
        );
        showFeedback(`${store.storeCode} mağazası ${nextStatus === "ACTIVE" ? "Aktif" : "Pasif"} yapıldı.`);
      }
    } catch {
      showFeedback("Durum güncellenemedi", "error");
    }
  };

  const handleDeleteStore = async (store: any) => {
    if (
      !window.confirm(
        `${store.storeCode} (${store.storeName}) kalıcı olarak silinecek. Bu işlem yalnızca hiç sipariş/rutin/varlık geçmişi yoksa yapılabilir ve geri alınamaz. Devam edilsin mi?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/admin/stores", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: store.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStores((prev) => prev.filter((s) => s.id !== store.id));
        showFeedback(data.message || "Mağaza silindi.");
      } else {
        showFeedback(data.error || "Mağaza silinemedi", "error");
      }
    } catch {
      showFeedback("Silme başarısız oldu", "error");
    }
  };

  const handleUpdateThreshold = async (store: any) => {
    const trimmed = thresholdDraft.trim();
    const nextThreshold = trimmed === "" ? null : Number(trimmed);
    if (nextThreshold !== null && (Number.isNaN(nextThreshold) || nextThreshold < 0)) {
      showFeedback("Eşik geçerli, negatif olmayan bir sayı olmalı (boş bırakmak = eşik yok).", "error");
      return;
    }
    setSavingThreshold(true);
    try {
      const res = await fetch("/api/admin/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: store.id, purchaseApprovalThreshold: nextThreshold }),
      });
      const data = await res.json();
      if (res.ok) {
        setStores((prev) =>
          prev.map((s) =>
            s.id === store.id
              ? { ...s, purchaseApprovalThreshold: nextThreshold === null ? null : nextThreshold.toFixed(2) }
              : s
          )
        );
        showFeedback(
          nextThreshold === null
            ? `${store.storeCode} için onay eşiği kaldırıldı.`
            : `${store.storeCode} onay eşiği $${nextThreshold.toFixed(2)} olarak ayarlandı.`
        );
        setEditingThresholdFor(null);
      } else {
        showFeedback(data.error || "Eşik güncellenemedi", "error");
      }
    } catch {
      showFeedback("Eşik güncellenemedi", "error");
    } finally {
      setSavingThreshold(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail) return;
    setSavingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          role: newUserRole,
          storeCode: newUserStore,
          password: newUserPass,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showFeedback(data.message || "Kullanıcı başarıyla oluşturuldu.");
        setIsNewUserModalOpen(false);
        setNewUserName("");
        setNewUserEmail("");
        fetchAdminData();
      } else {
        showFeedback(data.error || "Kullanıcı eklenemedi", "error");
      }
    } catch (err: any) {
      showFeedback(err.message, "error");
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (u: any) => {
    if (
      !window.confirm(
        `${u.name} (${u.email}) kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        showFeedback(data.message || "Kullanıcı silindi.");
      } else {
        showFeedback(data.error || "Kullanıcı silinemedi", "error");
      }
    } catch {
      showFeedback("Silme başarısız oldu", "error");
    }
  };

  const handleResetPassword = async (u: any) => {
    const trimmed = resetPasswordDraft.trim();
    if (trimmed.length < 12) {
      showFeedback("Yeni parola en az 12 karakter olmalıdır.", "error");
      return;
    }
    setSavingPasswordReset(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, password: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showFeedback(`${u.name} için yeni parola kaydedildi.`);
        setResetPasswordFor(null);
        setResetPasswordDraft("");
      } else {
        showFeedback(data.error || "Parola sıfırlanamadı", "error");
      }
    } catch {
      showFeedback("Parola sıfırlama başarısız oldu", "error");
    } finally {
      setSavingPasswordReset(false);
    }
  };

  const handleUpdateUserStore = async (userId: number, targetStore: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId,
          storeCode: targetStore,
        }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, storeCode: targetStore } : u))
        );
        showFeedback("Kullanıcı mağaza ataması güncellendi.");
      }
    } catch {
      showFeedback("Güncelleme başarısız", "error");
    }
  };

  // Delete a specific row from orders table
  const handleDeleteOrderRow = async (orderId: number) => {
    try {
      const isAdmin = currentUser.role === "ADMIN";
      const res = await fetch(
        isAdmin ? "/api/admin/master-crud" : `/api/orders/${orderId}`,
        {
          method: "DELETE",
          ...(isAdmin
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tableName: "orders", id: orderId }),
              }
            : {}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showFeedback("Sipariş satırı veritabanından kalıcı olarak silindi.");
        await fetchOrderPage();
        if (onDataRefresh) onDataRefresh();
      } else {
        showFeedback(data.error || "Sipariş silinemedi.", "error");
      }
    } catch {
      showFeedback("Silme başarısız oldu", "error");
    }
  };

  const handleApprovalDecision = async (orderId: number, decision: "APPROVED" | "REJECTED") => {
    try {
      const res = await fetch(`/api/orders/${orderId}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, approvalStatus: decision } : o))
        );
        showFeedback(decision === "APPROVED" ? "Sipariş onaylandı." : "Sipariş reddedildi.");
      } else {
        showFeedback(data.error || "Onay işlemi başarısız oldu.", "error");
      }
    } catch {
      showFeedback("Onay işlemi başarısız oldu", "error");
    }
  };

  // Execute Database Reset or Restore action
  const handleExecuteDatabaseTool = async (
    actionType:
      | "CLEAN_ORDERS_ONLY"
      | "RESTORE_REAL_XLS"
      | "NUKE_ALL_KEEP_ADMIN"
      | "FRESH_START_REAL_DATA"
  ) => {
    if (confirmationInput !== "RESET-CERBERUS") {
      showFeedback("Lütfen kutuya tam olarak 'RESET-CERBERUS' yazın.", "error");
      return;
    }
    setResettingDb(true);
    try {
      const res = await fetch("/api/admin/database-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          confirmationCode: confirmationInput,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback(data.message);
        setConfirmationInput("");
        await Promise.all([fetchAdminData(), fetchOrderPage()]);
        if (onDataRefresh) onDataRefresh();
      } else {
        showFeedback(data.error || "İşlem başarısız", "error");
      }
    } catch (err: any) {
      showFeedback(err.message, "error");
    } finally {
      setResettingDb(false);
    }
  };

  const totalStores = stores.length;
  const activeStores = stores.filter((s) => s.status === "ACTIVE").length;
  const totalUsers = users.length;
  const totalGlobalSpend = stores.reduce((sum, s) => sum + Number(s.totalSpend || 0), 0);

  // Filtreleme API tarafında yapılır; `orders` yalnız mevcut 50 satırlık sayfadır.
  const displayedOrders = orders;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Admin Top Notification */}
      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs font-mono-tech flex items-center justify-between border ${
            feedbackMsg.type === "success"
              ? "bg-positive/15 border-positive/40 text-positive"
              : "bg-danger/15 border-danger/40 text-danger"
          }`}
        >
          <span className="font-bold">{feedbackMsg.text}</span>
          <button onClick={() => setFeedbackMsg(null)}>
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Admin Header Strip */}
      <div className="bg-surface-1 border border-line rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="px-2.5 py-0.5 rounded text-[10px] font-mono-tech uppercase font-bold bg-brand/20 text-brand-soft border border-brand/30">
              {currentUser.role === "ADMIN" ? "SİSTEM ADMIN MERKEZİ" : "OPERASYON YÖNETİM MERKEZİ"}
            </span>
            <h2 className="text-lg font-bold text-ink tracking-tight">
              Çoklu Mağaza Filosu, Yetki, Sipariş &amp; Veritabanı Temizleme Konsolu
            </h2>
          </div>
          <p className="text-xs text-ink-muted font-mono-tech">
            {currentUser.role === "ADMIN"
              ? "Mağazaları ve kullanıcı atamalarını yönetin; denetim ve geliştirme araçlarını kontrollü kullanın."
              : "Mağaza operasyonlarını, siparişleri, denetim izini ve karar eşiklerini yönetin."}
          </p>
        </div>

        {/* Global Stats */}
        <div className="flex flex-wrap items-center gap-3 font-mono-tech text-xs">
          <div className="bg-surface-base px-3.5 py-2.5 rounded-xl border border-line text-center">
            <span className="text-[10px] text-ink-faint block uppercase">Mağaza Filosu</span>
            <span className="text-ink font-bold">{activeStores} Aktif / {totalStores} Mağaza</span>
          </div>
          {currentUser.role === "ADMIN" && (
            <div className="bg-surface-base px-3.5 py-2.5 rounded-xl border border-line text-center">
              <span className="text-[10px] text-ink-faint block uppercase">Uzman Personel</span>
              <span className="text-brand-soft font-bold">{totalUsers} Kullanıcı</span>
            </div>
          )}
          <div className="bg-surface-base px-3.5 py-2.5 rounded-xl border border-brand/40 text-center">
            <span className="text-[10px] text-brand-soft block uppercase">Konsolide Tedarik Bedeli</span>
            <span className="text-positive font-bold">${totalGlobalSpend.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Admin Subtabs */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto border-b border-line px-1 pb-2.5 font-mono-tech text-xs [&>button]:shrink-0">
        <button
          onClick={() => setActiveSubTab("STORES")}
          className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap ${
            activeSubTab === "STORES"
              ? "bg-brand text-ink shadow-lg shadow-brand/25"
              : "text-ink-muted hover:text-ink hover:bg-surface-2"
          }`}
        >
          <Store className="w-4 h-4" />
          <span>1. Mağaza Yönetimi ({stores.length})</span>
        </button>

        {currentUser.role === "ADMIN" && (
          <button
            onClick={() => setActiveSubTab("USERS")}
            className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap ${
              activeSubTab === "USERS"
                ? "bg-brand text-ink shadow-lg shadow-brand/25"
                : "text-ink-muted hover:text-ink hover:bg-surface-2"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>2. Kullanıcı &amp; Mağaza İzolasyonu ({users.length})</span>
          </button>
        )}

        <button
          onClick={() => setActiveSubTab("ORDERS_CRUD")}
          className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap ${
            activeSubTab === "ORDERS_CRUD"
              ? "bg-brand text-ink shadow-lg shadow-brand/25"
              : "text-ink-muted hover:text-ink hover:bg-surface-2"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-positive" />
          <span>3. Siparişler &amp; Yönetim ({orderTotal})</span>
        </button>

        <button
          onClick={() => setActiveSubTab("SP_API")}
          className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap ${
            activeSubTab === "SP_API"
              ? "bg-brand text-ink shadow-lg shadow-brand/25"
              : "text-ink-muted hover:text-ink hover:bg-surface-2"
          }`}
        >
          <Zap className="w-4 h-4 text-info" />
          <span>4. Amazon SP-API &amp; Muhasebe</span>
        </button>

        <button
          onClick={() => setActiveSubTab("AUDIT")}
          className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap ${
            activeSubTab === "AUDIT"
              ? "bg-brand text-ink shadow-lg shadow-brand/25"
              : "text-ink-muted hover:text-ink hover:bg-surface-2"
          }`}
        >
          <History className="w-4 h-4" />
          <span>5. Denetim İzi (Audit Log)</span>
        </button>

        {currentUser.role === "ADMIN" && (
          <button
            onClick={() => setActiveSubTab("DB_TOOLS")}
            className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap border ${
              activeSubTab === "DB_TOOLS"
                ? "bg-danger text-ink border-danger shadow-lg shadow-danger/25"
                : "bg-danger/10 text-danger border-danger/30 hover:bg-danger/20"
            }`}
          >
            <Database className="w-4 h-4 text-danger" />
            <span>6. 🧹 Veritabanı Temizleme &amp; Sıfırlama Araçları</span>
          </button>
        )}
        <button
          onClick={() => setActiveSubTab("SETTINGS")}
          className={`px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 whitespace-nowrap border ${
            activeSubTab === "SETTINGS"
              ? "bg-brand text-ink border-brand shadow-lg shadow-brand/25"
              : "bg-surface-2 text-ink-muted border-line hover:text-ink hover:bg-surface-3"
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>7. ⚙️ Eşikler &amp; Keepa Ayarları</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. MAĞAZA YÖNETİMİ TAB'I                                                 */}
      {/* ========================================================================= */}
      {activeSubTab === "STORES" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink uppercase font-mono-tech">
              Tanımlı Mağazalar ve Satın Alma Yetkilileri
            </h3>
            <button
              onClick={() => setIsNewStoreModalOpen(true)}
              className="px-4 py-2 bg-brand hover:bg-brand-soft text-ink text-xs font-mono-tech font-bold uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-brand/25"
            >
              <Plus className="w-4 h-4" /> Yeni Mağaza Tanımla
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stores.map((st) => {
              const isActive = st.status === "ACTIVE";
              return (
                <div
                  key={st.id}
                  className="bg-surface-1 border border-line hover:border-brand/50 rounded-2xl p-5 flex flex-col justify-between transition shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded bg-brand/15 text-brand-soft font-mono-tech text-xs font-bold border border-brand/30">
                          {st.storeCode}
                        </span>
                        <span className="text-[10px] font-mono-tech text-ink-muted bg-surface-2 px-2 py-0.5 rounded">
                          {st.marketplace}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleToggleStoreStatus(st)}
                          className={`px-2.5 py-0.5 rounded text-[10px] font-mono-tech font-bold transition ${
                            isActive
                              ? "bg-positive/15 text-positive border border-positive/30 hover:bg-positive/25"
                              : "bg-surface-3 text-ink-faint hover:text-ink-muted"
                          }`}
                        >
                          {isActive ? "AKTİF" : "PASİF"}
                        </button>
                        <button
                          onClick={() => handleDeleteStore(st)}
                          title={
                            Number(st.totalOrdersCount) > 0
                              ? "Bu mağazanın sipariş geçmişi var — kalıcı silinemez, yalnız PASİF yapılabilir"
                              : "Kalıcı olarak sil (geri alınamaz)"
                          }
                          className="p-1.5 rounded-lg bg-danger/15 hover:bg-rose-500 text-danger hover:text-ink transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h4 className="text-base font-bold text-ink mb-1">{st.storeName}</h4>
                    <p className="text-xs text-ink-muted font-mono-tech mb-4">
                      Alıcı Sorumlusu: <strong className="text-ink">{st.buyerName}</strong>
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono-tech bg-surface-base p-3 rounded-xl border border-line mb-3">
                      <div>
                        <span className="text-[10px] text-ink-faint block">Sipariş Sayısı</span>
                        <span className="text-ink font-bold">{st.totalOrdersCount} Kayıt</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-faint block">Toplam Harcama</span>
                        <span className="text-positive font-bold">${st.totalSpend}</span>
                      </div>
                    </div>

                    <div className="mb-3 flex items-center justify-between gap-2 text-xs font-mono-tech bg-surface-base p-3 rounded-xl border border-line">
                      <div className="min-w-0">
                        <span className="text-[10px] text-ink-faint block">Satın Alma Onay Eşiği</span>
                        {editingThresholdFor === st.id ? (
                          <div className="mt-1 flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              autoFocus
                              placeholder="Boş = eşik yok"
                              value={thresholdDraft}
                              onChange={(e) => setThresholdDraft(e.target.value)}
                              className="w-24 px-2 py-1 bg-surface-1 border border-line rounded-lg text-ink"
                            />
                            <button
                              onClick={() => handleUpdateThreshold(st)}
                              disabled={savingThreshold}
                              className="px-2 py-1 rounded-lg bg-brand text-ink font-bold hover:bg-brand-soft"
                            >
                              Kaydet
                            </button>
                            <button
                              onClick={() => setEditingThresholdFor(null)}
                              className="px-2 py-1 rounded-lg text-ink-faint hover:text-ink"
                            >
                              Vazgeç
                            </button>
                          </div>
                        ) : (
                          <span className="text-ink font-bold">
                            {st.purchaseApprovalThreshold != null ? `$${st.purchaseApprovalThreshold} üzeri` : "Tanımlı değil"}
                          </span>
                        )}
                      </div>
                      {editingThresholdFor !== st.id && (
                        <button
                          onClick={() => {
                            setEditingThresholdFor(st.id);
                            setThresholdDraft(st.purchaseApprovalThreshold != null ? String(st.purchaseApprovalThreshold) : "");
                          }}
                          className="shrink-0 text-[11px] text-brand-soft hover:underline font-bold"
                        >
                          Düzenle
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-line flex items-center justify-between text-xs font-mono-tech">
                    <span className="text-ink-faint text-[11px]">
                      Kart: {st.defaultCard || "Tanımlı değil"}
                    </span>
                    {onStoreSelected && (
                      <button
                        onClick={() => onStoreSelected(st.storeCode)}
                        className="text-brand-soft hover:underline font-bold text-xs flex items-center gap-1"
                      >
                        Siparişleri İncele →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. KULLANICI & MAĞAZA ATAMALARI TAB'I                                     */}
      {/* ========================================================================= */}
      {activeSubTab === "USERS" && currentUser.role === "ADMIN" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink uppercase font-mono-tech">
              Kullanıcılar, Yetkiler ve Mağaza İzolasyon Atamaları
            </h3>
            <button
              onClick={() => setIsNewUserModalOpen(true)}
              className="px-4 py-2 bg-brand hover:bg-brand-soft text-ink text-xs font-mono-tech font-bold uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-brand/25"
            >
              <Plus className="w-4 h-4" /> Yeni Kullanıcı Ekle
            </button>
          </div>

          <div className="bg-surface-1 border border-line rounded-2xl overflow-x-auto shadow-lg">
            <table className="w-full text-left text-xs font-mono-tech">
              <thead className="bg-surface-base text-ink-muted border-b border-line text-[11px] uppercase">
                <tr>
                  <th className="p-3.5">Kullanıcı</th>
                  <th className="p-3.5">E-posta</th>
                  <th className="p-3.5">Yetki Seviyesi</th>
                  <th className="p-3.5">Atanmış Mağaza (İzolasyon)</th>
                  <th className="p-3.5 text-right">İşlem / Mağaza Değiştir</th>
                  <th className="p-3.5 text-right">Parola</th>
                  <th className="p-3.5 text-right">Sil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => {
                  const isAdmin = u.role === "ADMIN";
                  return (
                    <tr key={u.id} className="hover:bg-surface-3/30 transition">
                      <td className="p-3.5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-brand/20 text-brand-soft font-bold flex items-center justify-center text-xs border border-brand/30">
                          {u.avatar || u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-bold text-ink">{u.name}</span>
                      </td>
                      <td className="p-3.5 text-ink-muted">{u.email}</td>
                      <td className="p-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${
                            isAdmin
                              ? "bg-brand/15 text-brand-soft border-brand/40"
                              : "bg-positive/15 text-positive border-positive/40"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className="font-bold text-ink px-2.5 py-1 rounded-lg bg-surface-2 border border-line">
                          {u.storeCode === "ALL" ? "TÜM MAĞAZALAR (YETKİLİ)" : `${u.storeCode} STORE`}
                        </span>
                      </td>
                      <td className="p-3.5 text-right">
                        {!isAdmin ? (
                          <select
                            value={u.storeCode}
                            onChange={(e) => handleUpdateUserStore(u.id, e.target.value)}
                            className="px-3 py-1.5 bg-surface-base border border-line rounded-xl text-xs font-mono-tech text-brand-soft font-bold focus:outline-none"
                          >
                            {stores.map((s) => (
                              <option key={s.storeCode} value={s.storeCode}>
                                {s.storeCode} Mağazasına Ata
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-ink-faint text-[11px]">Süper Yetkili</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        {resetPasswordFor === u.id ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="password"
                              autoFocus
                              minLength={12}
                              placeholder="Yeni parola (min 12)"
                              value={resetPasswordDraft}
                              onChange={(e) => setResetPasswordDraft(e.target.value)}
                              className="w-40 px-2 py-1 bg-surface-base border border-line rounded-lg text-ink"
                            />
                            <button
                              onClick={() => handleResetPassword(u)}
                              disabled={savingPasswordReset}
                              className="px-2 py-1 rounded-lg bg-brand text-ink font-bold hover:bg-brand-soft disabled:opacity-50"
                            >
                              Kaydet
                            </button>
                            <button
                              onClick={() => {
                                setResetPasswordFor(null);
                                setResetPasswordDraft("");
                              }}
                              className="px-2 py-1 rounded-lg text-ink-faint hover:text-ink"
                            >
                              Vazgeç
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setResetPasswordFor(u.id);
                              setResetPasswordDraft("");
                            }}
                            title="Parolayı sıfırla"
                            className="p-1.5 rounded-lg bg-surface-2 border border-line text-ink-muted hover:text-brand-soft hover:border-brand/50 transition"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        {u.id === currentUser.id ? (
                          <span className="text-ink-faint text-[11px]">Siz</span>
                        ) : (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            title="Kalıcı olarak sil (geri alınamaz)"
                            className="p-1.5 rounded-lg bg-danger/15 hover:bg-rose-500 text-danger hover:text-ink transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. SİPARİŞLER YÖNETİMİ & HIZLI SİLME / DÜZENLEME (ORDERS CRUD)            */}
      {/* ========================================================================= */}
      {activeSubTab === "ORDERS_CRUD" && (
        <div className="space-y-4">
          <div className="bg-surface-1 border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-ink uppercase font-mono-tech">
                Sipariş Yönetimi ({orderTotal} filtrelenmiş kayıt)
              </h3>
              <p className="text-xs text-ink-muted font-mono-tech">
                Herhangi bir hatalı satırı tek tıkla silebilir veya inceleyebilirsiniz.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <select
                value={orderStoreFilter}
                onChange={(e) => {
                  setOrderStoreFilter(e.target.value);
                  setOrderPage(1);
                }}
                className="bg-surface-base border border-line rounded-xl px-3 py-1.5 text-xs font-mono-tech text-brand-soft font-bold"
              >
                <option value="ALL">TÜM MAĞAZALAR</option>
                {stores.map((st) => (
                  <option key={st.storeCode} value={st.storeCode}>
                    {st.storeCode}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={orderSearchQuery}
                onChange={(e) => {
                  setOrderSearchQuery(e.target.value);
                  setOrderPage(1);
                }}
                placeholder="Order No veya ASIN ara..."
                className="px-3 py-1.5 bg-surface-base border border-line rounded-xl text-xs font-mono-tech text-ink"
              />
            </div>
          </div>

          <div className="bg-surface-1 border border-line rounded-2xl max-h-[520px] overflow-auto">
            <table className="w-full text-left text-xs font-mono-tech">
              <thead className="bg-surface-base text-ink-muted border-b border-line sticky top-0">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Mağaza</th>
                  <th className="p-3">Order No</th>
                  <th className="p-3">ASIN</th>
                  <th className="p-3">Ürün Başlığı</th>
                  <th className="p-3">Adet</th>
                  <th className="p-3">Birim Maliyet</th>
                  <th className="p-3">Kargo Durumu</th>
                  <th className="p-3">Onay</th>
                  <th className="p-3 text-right">Sil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!ordersLoading && displayedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-3/40">
                    <td className="p-3 text-ink-faint">#{o.id}</td>
                    <td className="p-3 font-bold text-brand-soft">{o.buyerStore}</td>
                    <td className="p-3 font-bold text-ink">{o.orderNumber}</td>
                    <td className="p-3 text-info">{o.asin}</td>
                    <td className="p-3 font-sans text-ink truncate max-w-xs">{o.productTitle}</td>
                    <td className="p-3 text-ink font-bold">{o.quantity}</td>
                    <td className="p-3 text-caution font-bold">${o.unitCost}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-surface-2 border border-line text-[10px]">
                        {o.cargoStatus}
                      </span>
                    </td>
                    <td className="p-3">
                      {o.approvalStatus === "PENDING_APPROVAL" ? (
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-caution/15 border border-caution/30 text-caution text-[10px] font-bold">
                            ONAY BEKLİYOR
                          </span>
                          <button
                            onClick={() => handleApprovalDecision(o.id, "APPROVED")}
                            className="px-1.5 py-0.5 rounded bg-positive/15 border border-positive/30 text-positive text-[10px] font-bold hover:bg-positive/25"
                            title="Onayla"
                          >
                            Onayla
                          </button>
                          <button
                            onClick={() => handleApprovalDecision(o.id, "REJECTED")}
                            className="px-1.5 py-0.5 rounded bg-danger/15 border border-danger/30 text-danger text-[10px] font-bold hover:bg-danger/25"
                            title="Reddet"
                          >
                            Reddet
                          </button>
                        </div>
                      ) : o.approvalStatus === "APPROVED" || o.approvalStatus === "REJECTED" ? (
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                            o.approvalStatus === "APPROVED"
                              ? "bg-positive/15 border-positive/30 text-positive"
                              : "bg-danger/15 border-danger/30 text-danger"
                          }`}
                        >
                          {o.approvalStatus === "APPROVED" ? "ONAYLANDI" : "REDDEDİLDİ"}
                        </span>
                      ) : (
                        <span className="text-ink-faint text-[10px]">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteOrderRow(o.id)}
                        className="p-1.5 rounded-lg bg-danger/15 hover:bg-rose-500 text-danger hover:text-ink transition"
                        title="Bu siparişi kalıcı olarak sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {ordersLoading && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-ink-muted">
                      Sipariş sayfası yükleniyor…
                    </td>
                  </tr>
                )}
                {!ordersLoading && displayedOrders.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-ink-muted">
                      Bu filtrelerle eşleşen sipariş bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-1 px-4 py-3 font-mono-tech text-xs">
            <span className="text-ink-muted">
              Sayfa {orderPage} / {orderPageCount} · Toplam {orderTotal} kayıt · Sayfa başına 50
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={ordersLoading || orderPage <= 1}
                onClick={() => setOrderPage((page) => Math.max(1, page - 1))}
                className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-bold text-ink transition hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Önceki
              </button>
              <button
                type="button"
                disabled={ordersLoading || orderPage >= orderPageCount}
                onClick={() => setOrderPage((page) => Math.min(orderPageCount, page + 1))}
                className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-bold text-ink transition hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. AMAZON SP-API ENTEGRASYONU — DURUM: HENÜZ BAĞLANMADI                   */}
      {/* ========================================================================= */}
      {activeSubTab === "SP_API" && (
        <div className="space-y-4">
          <div className="bg-surface-1 border border-caution/40 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-ink uppercase font-mono-tech flex items-center gap-2">
              <Server className="w-4 h-4 text-caution" />
              Amazon SP-API &amp; Inventory Lab Entegrasyonu — PLANLANAN ÖZELLİK
            </h3>
            <p className="text-xs text-ink-muted font-mono-tech mt-2 leading-relaxed">
              Bu ekran daha önce her mağaza için &quot;SP-API BAĞLI&quot;, sahte bir LWA token ve
              &quot;son senkronizasyon: 2 dk önce&quot; gösteriyordu. Gerçekte hiçbir Amazon
              bağlantısı kurulmamıştır. Yanıltıcı olmaması için rozetler gerçek durumu
              yansıtacak biçimde değiştirildi (denetim bulgusu F-23).
            </p>
            <p className="text-xs text-ink-muted font-mono-tech mt-2 leading-relaxed">
              Entegrasyon için gereken adımlar: Amazon Seller Central geliştirici kaydı → LWA
              uygulaması → refresh token kasası (şifreli) → oran sınırlı senkronizasyon işi →
              sipariş/stok eşleme. Tahmini efor: 8–13 kişi-gün.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stores.map((st) => (
              <div
                key={st.id}
                className="bg-surface-1 border border-line rounded-2xl p-5 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-brand-soft font-mono-tech">
                      {st.storeCode} — {st.marketplace}
                    </span>
                    <h4 className="text-sm font-bold text-ink truncate">{st.storeName}</h4>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-mono-tech font-bold bg-surface-3 text-ink-muted border border-line flex items-center gap-1 shrink-0">
                    BAĞLI DEĞİL
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono-tech bg-surface-base p-3.5 rounded-xl border border-line">
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Marketplace ID:</span>
                    <span className="text-ink-faint">Tanımlanmadı</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">LWA Refresh Token:</span>
                    <span className="text-ink-faint">Yok</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Son senkronizasyon:</span>
                    <span className="text-ink-faint">Hiç</span>
                  </div>
                </div>

                <button
                  disabled
                  title="SP-API entegrasyonu henüz geliştirilmedi"
                  className="w-full px-3 py-1.5 bg-surface-2 text-ink-faint rounded-lg text-xs font-bold cursor-not-allowed border border-line"
                >
                  Senkronize Et (kullanılamaz)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. SİSTEM DENETİM İZİ (AUDIT LOGS)                                        */}
      {/* ========================================================================= */}
      {activeSubTab === "AUDIT" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-ink uppercase font-mono-tech">
              Gerçek Zamanlı Sistem Değişiklik Günlüğü (Audit Trail) — {auditTotal} Kayıt
            </h3>
            <div className="flex items-center gap-2 font-mono-tech text-xs">
              <select
                value={auditStoreFilter}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditStoreFilter(e.target.value);
                }}
                className="px-3 py-1.5 bg-surface-base border border-line rounded-xl text-ink"
              >
                <option value="ALL">Tüm Mağazalar</option>
                {stores.map((s) => (
                  <option key={s.storeCode} value={s.storeCode}>
                    {s.storeCode}
                  </option>
                ))}
              </select>
              <select
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditActionFilter(e.target.value);
                }}
                className="px-3 py-1.5 bg-surface-base border border-line rounded-xl text-ink"
              >
                <option value="ALL">Tüm İşlem Türleri</option>
                {Array.from(new Set(auditLogs.map((l) => l.actionType))).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-surface-1 border border-line rounded-2xl p-4 max-h-[500px] overflow-y-auto space-y-2.5">
            {auditLoading ? (
              <p className="text-xs font-mono-tech text-ink-faint">Yükleniyor…</p>
            ) : auditLogs.length === 0 ? (
              <p className="text-xs font-mono-tech text-ink-faint">Henüz denetim kaydı bulunmuyor.</p>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-xl bg-surface-base border border-line text-xs font-mono-tech flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-brand-soft font-bold">{log.actorName}</span>
                      <span className="px-2 py-0.5 rounded bg-surface-2 border border-line text-[10px] text-caution">
                        {log.actionType}
                      </span>
                      <span className="text-ink font-semibold truncate max-w-sm">
                        {log.targetEntity}
                      </span>
                    </div>
                    {log.details && <p className="text-[11px] text-ink-muted">{log.details}</p>}
                  </div>
                  <div className="text-right text-[11px] text-ink-faint shrink-0">
                    {new Date(log.createdAt).toLocaleString()} • Mağaza: {log.storeCode}
                  </div>
                </div>
              ))
            )}
          </div>

          {auditPageCount > 1 && (
            <div className="flex items-center justify-center gap-3 font-mono-tech text-xs">
              <button
                disabled={auditPage <= 1}
                onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-ink disabled:opacity-40"
              >
                ← Önceki
              </button>
              <span className="text-ink-muted">
                Sayfa {auditPage} / {auditPageCount}
              </span>
              <button
                disabled={auditPage >= auditPageCount}
                onClick={() => setAuditPage((p) => Math.min(auditPageCount, p + 1))}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-ink disabled:opacity-40"
              >
                Sonraki →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. VERİTABANI TEMİZLEME & SIFIRLAMA ARAÇLARI (DATABASE CLEAN & RESET)      */}
      {/* ========================================================================= */}
      {activeSubTab === "DB_TOOLS" && currentUser.role === "ADMIN" && (
        <div className="space-y-6">
          <div className="bg-danger/10 border border-danger/40 rounded-2xl p-5 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-danger shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-bold text-danger uppercase font-mono-tech">
                ⚠️ DANGER ZONE: Veritabanı Temizleme &amp; Gerçek Veri Hazırlık Merkezi
              </h3>
              <p className="text-xs text-ink-muted font-mono-tech mt-1">
                Kendi Google Drive / Excel sipariş verilerinizi yüklemeden önce mevcut test/demo siparişlerini temizleyebilir veya 24 satırlık Vitamin Shoppe geliştirme verisini geri yükleyebilirsiniz.
              </p>
            </div>
          </div>

          {/* Security confirmation input */}
          <div className="bg-surface-1 border border-line rounded-2xl p-5 space-y-3 font-mono-tech text-xs">
            <label className="block text-ink-muted font-bold">
              Güvenlik Onayı: Aşağıdaki araçları çalıştırmak için kutuya büyük harflerle{" "}
              <code className="text-danger bg-surface-2 px-1.5 py-0.5 rounded">RESET-CERBERUS</code> yazın:
            </label>
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder="RESET-CERBERUS"
              className="w-full max-w-sm px-3.5 py-2 bg-surface-base border border-line rounded-xl text-ink font-bold tracking-wider focus:outline-none focus:border-danger"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {/* Tool 0: Gerçek Veriyle Başlangıç — canlıya geçiş için önerilen */}
            <div className="flex flex-col justify-between space-y-4 rounded-2xl border-2 border-brand bg-surface-1 p-5 shadow-lg shadow-brand/10">
              <div>
                <span className="rounded bg-brand px-2.5 py-0.5 font-mono-tech text-[10px] font-bold text-ink">
                  CANLIYA GEÇİŞ İÇİN ÖNERİLEN
                </span>
                <h4 className="mt-2 text-base font-bold text-ink">
                  0. Gerçek Veriyle Başlangıç
                </h4>
                <p className="mt-2 font-mono-tech text-xs leading-relaxed text-ink-muted">
                  Tüm demo operasyonel verisini siler: siparişler, PSH partileri,
                  <strong className="text-ink"> ürün ana kayıtları</strong> ve araştırma oturumları.
                  <strong className="mt-1 block text-brand-soft">
                    ✓ Mağazalar, kullanıcı hesapları ve araştırmacı kadrosu KORUNUR.
                  </strong>
                  <span className="mt-1 block text-ink-faint">
                    1. seçenekten farkı: demo ürün kayıtlarını da temizler; böylece
                    gerçekleşen ROI ölçümü hayalet ürünlerle kirlenmez.
                  </span>
                </p>
              </div>

              <button
                disabled={resettingDb || confirmationInput !== "RESET-CERBERUS"}
                onClick={() => handleExecuteDatabaseTool("FRESH_START_REAL_DATA")}
                className="w-full rounded-xl bg-brand py-3 font-mono-tech text-xs font-bold uppercase tracking-wider text-ink shadow-lg shadow-brand/20 transition hover:bg-brand-soft disabled:opacity-40"
              >
                {resettingDb ? "Hazırlanıyor..." : "Gerçek Veriyle Başla"}
              </button>
            </div>

            {/* Tool 1: Clean Orders Only (Keep Users & Stores) */}
            <div className="bg-surface-1 border border-positive/40 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-positive/20 text-positive font-mono-tech text-[10px] font-bold">
                  SADECE SİPARİŞLERİ TEMİZLE
                </span>
                <h4 className="text-base font-bold text-ink mt-2">
                  1. Sadece Siparişleri Temizle
                </h4>
                <p className="text-xs text-ink-muted font-mono-tech mt-2 leading-relaxed">
                  Tüm demo siparişlerini (`orders`) ve PSH sevkiyat partilerini (`psh_batches`) temizler.  
                  <strong className="text-positive block mt-1">
                    ✓ Mağaza tanımlarınız ve kullanıcı hesaplarınız KORUNUR!
                  </strong>
                </p>
              </div>

              <button
                disabled={resettingDb || confirmationInput !== "RESET-CERBERUS"}
                onClick={() => handleExecuteDatabaseTool("CLEAN_ORDERS_ONLY")}
                className="w-full py-3 rounded-xl bg-positive hover:brightness-110 disabled:opacity-40 text-surface-base font-mono-tech text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-positive/20"
              >
                {resettingDb ? "Temizleniyor..." : "Siparişleri Temizle & Hazırla"}
              </button>
            </div>

            {/* Tool 2: Restore 38 Real Vitamin Shoppe Orders */}
            <div className="bg-surface-1 border border-brand/40 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-brand/20 text-brand-soft font-mono-tech text-[10px] font-bold">
                  REFERANS VERİYİ GERİ YÜKLE
                </span>
                <h4 className="text-base font-bold text-ink mt-2">
                  2. 24 Satırlık Geliştirme Verisini Yükle
                </h4>
                <p className="text-xs text-ink-muted font-mono-tech mt-2 leading-relaxed">
                  Depodaki 24 satırlık The Vitamin Shoppe geliştirme verisini (`WO110074776` vb.), bağlantıları ve PSH partileriyle birlikte geri getirir. Canlı veri olarak kullanılmamalıdır.
                </p>
              </div>

              <button
                disabled={resettingDb || confirmationInput !== "RESET-CERBERUS"}
                onClick={() => handleExecuteDatabaseTool("RESTORE_REAL_XLS")}
                className="w-full py-3 rounded-xl bg-brand hover:bg-brand-soft disabled:opacity-40 text-ink font-mono-tech text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-brand/20"
              >
                {resettingDb ? "Yükleniyor..." : "24 Fixture Siparişini Geri Yükle"}
              </button>
            </div>

            {/* Tool 3: Factory Reset Keep Admin */}
            <div className="bg-surface-1 border border-danger/40 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-danger/20 text-danger font-mono-tech text-[10px] font-bold">
                  TAM SIFIRLAMA
                </span>
                <h4 className="text-base font-bold text-ink mt-2">
                  3. Fabrika Ayarlarına Dön
                </h4>
                <p className="text-xs text-ink-muted font-mono-tech mt-2 leading-relaxed">
                  Tüm siparişleri, batch&rsquo;leri, mağaza kullanıcılarını (`STORE_USER`) ve denetim kayıtlarını siler. Sadece Sistem Yöneticisi (`Ahmet Erdem`) kalır.
                </p>
              </div>

              <button
                disabled={resettingDb || confirmationInput !== "RESET-CERBERUS"}
                onClick={() => handleExecuteDatabaseTool("NUKE_ALL_KEEP_ADMIN")}
                className="w-full py-3 rounded-xl bg-danger hover:bg-rose-500 disabled:opacity-40 text-ink font-mono-tech text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-rose-600/20"
              >
                {resettingDb ? "Sıfırlanıyor..." : "Tüm Verileri Sıfırla"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: YENİ MAĞAZA TANIMLA                                                */}
      {/* ========================================================================= */}
      {isNewStoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-1 border border-line rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-brand-soft" />
                <h3 className="text-base font-bold text-ink">Yeni Mağaza Tanımla</h3>
              </div>
              <button onClick={() => setIsNewStoreModalOpen(false)}>
                <XCircle className="w-5 h-5 text-ink-muted hover:text-ink" />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-3.5 text-xs font-mono-tech">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-muted mb-1">Mağaza Kodu (Benzersiz)</label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: WMT-01, AMZ-03"
                    value={storeCode}
                    onChange={(e) => setStoreCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink font-bold"
                  />
                </div>
                <div>
                  <label className="block text-ink-muted mb-1">Pazar Yeri</label>
                  <select
                    value={marketplace}
                    onChange={(e) => setMarketplace(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                  >
                    <option value="AMAZON">AMAZON FBA</option>
                    <option value="WALMART">WALMART</option>
                    <option value="SHOPIFY">SHOPIFY DTC</option>
                    <option value="WHOLESALE">B2B WHOLESALE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-ink-muted mb-1">Mağaza Resmi Adı</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Vanguard Retail Amazon Storefront"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-muted mb-1">Alıcı Sorumlusu (Buyer)</label>
                  <input
                    type="text"
                    placeholder="Örn: Selin Yılmaz"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                  />
                </div>
                {currentUser.role === "ADMIN" && (
                  <div>
                    <label className="block text-ink-muted mb-1">Ödeme Kartı Son 4</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{4}"
                      maxLength={4}
                      placeholder="İsteğe bağlı"
                      value={defaultCard}
                      onChange={(e) => setDefaultCard(e.target.value.replace(/\D/g, ""))}
                      className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink font-bold"
                    />
                  </div>
                )}
              </div>

              {currentUser.role === "ADMIN" && (
                <div>
                  <label className="block text-ink-muted mb-1">Mağaza Sipariş E-posta Adresi</label>
                  <input
                    type="email"
                    placeholder="İsteğe bağlı"
                    value={defaultEmail}
                    onChange={(e) => setDefaultEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                  />
                </div>
              )}

              <div>
                <label className="block text-ink-muted mb-1">Satın Alma Onay Eşiği ($, isteğe bağlı)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Boş = eşik yok, hiçbir sipariş onay beklemez"
                  value={purchaseApprovalThreshold}
                  onChange={(e) => setPurchaseApprovalThreshold(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsNewStoreModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-ink-muted hover:text-ink"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingStore}
                  className="px-5 py-2 bg-brand hover:bg-brand-soft text-ink rounded-xl font-bold uppercase transition"
                >
                  {savingStore ? "Kaydediliyor..." : "Mağazayı Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: YENİ KULLANICI EKLE                                                */}
      {/* ========================================================================= */}
      {isNewUserModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-1 border border-line rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-brand-soft" />
                <h3 className="text-base font-bold text-ink">Yeni Kullanıcı &amp; Mağaza Tanımla</h3>
              </div>
              <button onClick={() => setIsNewUserModalOpen(false)}>
                <XCircle className="w-5 h-5 text-ink-muted hover:text-ink" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs font-mono-tech">
              <div>
                <label className="block text-ink-muted mb-1">Ad Soyad</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Ece Demir"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                />
              </div>

              <div>
                <label className="block text-ink-muted mb-1">E-posta Adresi (Giriş İçin)</label>
                <input
                  type="email"
                  required
                  placeholder="ece@cerberus-commerce.io"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-muted mb-1">Yetki Rolü</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                  >
                    <option value="STORE_USER">Mağaza Sorumlusu</option>
                    <option value="ADMIN">Sistem Yöneticisi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-ink-muted mb-1">Atanacak Mağaza</label>
                  <select
                    disabled={newUserRole === "ADMIN"}
                    value={newUserStore}
                    onChange={(e) => setNewUserStore(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink"
                  >
                    {stores.map((s) => (
                      <option key={s.storeCode} value={s.storeCode}>
                        {s.storeCode} - {s.storeName.slice(0, 16)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-ink-muted mb-1">Başlangıç Parolası</label>
                <input
                  type="text"
                  value={newUserPass}
                  onChange={(e) => setNewUserPass(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-base border border-line rounded-xl text-ink font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsNewUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-ink-muted hover:text-ink"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-5 py-2 bg-brand hover:bg-brand-soft text-ink rounded-xl font-bold uppercase transition"
                >
                  {savingUser ? "Ekleniyor..." : "Kullanıcıyı Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
