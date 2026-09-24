"use client";

import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { OrderDetailDrawer } from "@/components/OrderDetailDrawer";
import { NewOrderModal } from "@/components/NewOrderModal";
import { GoogleDriveXlsImportModal } from "@/components/GoogleDriveXlsImportModal";
import { PshBatchModal } from "@/components/PshBatchModal";
import { WarehouseReconciliationModal } from "@/components/WarehouseReconciliationModal";
import { PrepShipImportModal } from "@/components/PrepShipImportModal";
import { AdminDashboard } from "@/components/AdminDashboard";
import { ProductMasterDrawer } from "@/components/ProductMasterDrawer";
import { ProductPortfolio } from "@/features/products/ProductPortfolio";
import { ProductJourneyDrawer } from "@/features/products/ProductJourneyDrawer";
import { CrawlerPanel } from "@/features/crawler/CrawlerPanel";
import { KeepaAnalysisPanel } from "@/features/keepa/KeepaAnalysisPanel";
import { DecisionSupportDashboard } from "@/features/analytics/DecisionSupportDashboard";
import { StoreHealthScreen } from "@/features/analytics/StoreHealthScreen";

import { useCerberusData } from "@/features/useCerberusData";
import { Sidebar, buildNavGroups } from "@/features/shell/Sidebar";
import { Topbar } from "@/features/shell/Topbar";
import { useNavPreference } from "@/features/shell/useNavPreference";
import { KpiStrip } from "@/features/shell/KpiStrip";
import { MorningBriefingPanel } from "@/features/briefing/MorningBriefingPanel";
import { DecisionVaultTable } from "@/features/decision/DecisionVaultTable";
import { ResearcherBoard } from "@/features/sourcing/ResearcherBoard";
import { OrdersTable } from "@/features/orders/OrdersTable";
import {
  InventoryLabPanel,
  ProblemsPanel,
  PshBatchPanel,
  WarehousePanel,
} from "@/features/operations/OperationsPanels";
import { downloadFilteredOrdersCsv } from "@/features/orders/ordersCsv";
import { clientLog } from "@/lib/clientLogger";
import type { BatchView, OrderView, ProductMasterView, ProductView, TabId } from "@/features/types";

/** Her sekmenin üst çubukta gösterilecek başlık ve açıklaması */
const PAGE_META: Record<TabId, { title: string; subtitle: string }> = {
  BRIEFING_DECISION: {
    title: "Sabah Brifingi & Karar Kasası",
    subtitle: "Ne değişti, ne önemli, ne yapmalıyım — canlı veriden hesaplanır",
  },
  ANALYTICS: {
    title: "Karar Destek Analitik",
    subtitle: "XLS’ten kurtuluş: kârlılık, trend, mağaza kıyas ve fırsat sinyali — canlı",
  },
  STORE_HEALTH: {
    title: "Haftalık Mağaza/Hesap Sağlığı",
    subtitle: "Bu hafta/geçen hafta kıyası — sipariş yoksa skor uydurulmaz, sessizlik gün sayısıyla raporlanır",
  },
  CRAWLER: {
    title: "Crawler Keşif Masası",
    subtitle: "Kaynak site URL’sini yapıştırın, ürünleri otomatik çekip kataloğa ekleyin",
  },
  KEEPA: {
    title: "Keepa Analiz & Karar",
    subtitle: "ASIN → Keepa BSR / fiyat geçmişi / BuyBox → Decision Engine 2.0",
  },
  PRODUCTS: {
    title: "Ürün Portföyü",
    subtitle: "Keşiften satışa ürün yolculuğu, fiyat trendi ve kâr sağlığı",
  },
  RESEARCHERS: {
    title: "ABD Sourcing Ekibi",
    subtitle: "Kalite düzeltilmiş araştırmacı performans karnesi",
  },
  XLS_MASTER: {
    title: "Siparişler",
    subtitle: "40 kolonluk Google Drive XLS ana tablosu — XLS Rescue Hub",
  },
  PSH_BATCHES: {
    title: "PSH Envanter Partileri",
    subtitle: "Sevkiyat öncesi batch hazırlığı ve takibi",
  },
  WAREHOUSE: {
    title: "Depo Karşılama & Sayım",
    subtitle: "Order No eşleştirme, eksik ve defolu adet kaydı",
  },
  INVENTORY_LAB: {
    title: "Inventory Lab & Muhasebe",
    subtitle: "Birim maliyet, satış fiyatı ve net marj dökümü",
  },
  PROBLEMS: {
    title: "Fire & Problem Yönetimi",
    subtitle: "P1 iptal, P2 eksik, P3 defolu, P4 tarihi geçmiş ve refund",
  },
  ADMIN: {
    title: "Admin Komuta Merkezi",
    subtitle: "Mağaza, kullanıcı, yetki ve denetim kayıtları",
  },
};

export default function CerberusApp() {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [cargoFilter, setCargoFilter] = useState("ALL");
  const [batchFilter, setBatchFilter] = useState("ALL");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(50);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    currentUser,
    checkingAuth,
    orders,
    orderKpis,
    orderPagination,
    stores,
    batches,
    productMasters,
    products,
    productSummary,
    researchers,
    briefing,
    loading,
    dataError,
    selectedStore,
    setSelectedStore,
    refresh,
    applyOrderPatch,
    applyMasterPatch,
    prependOrder,
    logout,
  } = useCerberusData({
    page: orderPage,
    pageSize: orderPageSize,
    search: deferredSearch,
    cargo: cargoFilter,
    batch: batchFilter,
  });

  const [activeTab, setActiveTab] = useState<TabId>("BRIEFING_DECISION");
  const [navCollapsed, toggleCollapse] = useNavPreference();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [decisionFilter, setDecisionFilter] = useState("ALL");

  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null);
  const [selectedMaster, setSelectedMaster] = useState<ProductMasterView | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductView | null>(null);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [isXlsImportOpen, setIsXlsImportOpen] = useState(false);
  const [isPshBatchOpen, setIsPshBatchOpen] = useState(false);
  const [isWarehouseReconOpen, setIsWarehouseReconOpen] = useState(false);
  const [prepShipImportBatch, setPrepShipImportBatch] = useState<BatchView | null>(null);

  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const isStoreLocked = Boolean(
    !isAdmin && currentUser?.storeCode && currentUser.storeCode !== "ALL"
  );

  // Sipariş arama/filtreleme sunucuda uygulanır; `orders` yalnızca geçerli
  // sayfadır, KPI'lar ise aynı filtrenin tüm kayıtlarından SQL ile hesaplanır.
  const filteredOrders = orders;
  const kpis = orderKpis;
  const problemCount = orderKpis.problemCount;

  const navGroups = useMemo(
    () =>
      buildNavGroups({
        masters: productMasters.length,
        products: products.length,
        researchers: researchers.length,
        orders: orderKpis.totalOrders,
        batches: batches.length,
        problems: problemCount,
        stores: stores.length,
        isAdmin: Boolean(isAdmin),
      }),
    [productMasters.length, products.length, researchers.length, orderKpis.totalOrders, batches.length, problemCount, stores.length, isAdmin]
  );

  const navigate = useCallback((id: TabId) => {
    setActiveTab(id);
    setMobileNavOpen(false);
  }, []);

  const handleUpdateOrder = useCallback(
    async (id: number, updates: Partial<OrderView>) => {
      applyOrderPatch(id, updates);
      setSelectedOrder((prev) => (prev && prev.id === id ? { ...prev, ...updates } : prev));
      try {
        await fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        // Güncelleme KPI, brifing ve ürün P&L'ını etkileyebilir; sunucu tekrar
        // okunarak iyimser görünüm kesin sonuçla uzlaştırılır.
        await refresh();
      } catch (err) {
        clientLog.error("orders/update", "Sipariş güncelleme başarısız", { err: String(err) });
        await refresh();
      }
    },
    [applyOrderPatch, refresh]
  );

  const handleUpdateMasterDecision = useCallback(
    async (id: number, decisionAction: string, sellingPrice?: number) => {
      applyMasterPatch(id, {
        decisionAction,
        ...(sellingPrice ? { sellingPrice: String(sellingPrice) } : {}),
      });
      setSelectedMaster((prev) => (prev && prev.id === id ? { ...prev, decisionAction } : prev));
      try {
        await fetch(`/api/intelligence/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisionAction, sellingPrice }),
        });
        await refresh();
      } catch (err) {
        clientLog.error("intelligence/update", "Karar güncelleme başarısız", { err: String(err) });
        await refresh();
      }
    },
    [applyMasterPatch, refresh]
  );

  // Inventory Lab / PrepShip köprüsü — Adım 1/2 (denetim raporu §13).
  // Önce batch durumu hiçbir yerden ilerletilemiyordu (panelde ölü kod
  // yoluydu); artık gerçek PATCH ile ilerliyor ve Amazona sevk sonrası
  // Inventory Lab'a CSV dışa aktarım tetiklenebiliyor.
  const handleAdvanceBatchStatus = useCallback(
    async (batch: { batchNumber: string }, nextStatus: string) => {
      setActionError(null);
      try {
        const res = await fetch(`/api/batches/${encodeURIComponent(batch.batchNumber)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Batch durumu güncellenemedi.");
        }
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Batch durumu güncellenemedi.");
      }
    },
    [refresh]
  );

  const handleExportInventoryLab = useCallback(
    (batch: { batchNumber: string }) => {
      window.open(`/api/batches/${encodeURIComponent(batch.batchNumber)}/inventory-lab-export`, "_blank");
      // Sunucu senkron/durum alanlarını hemen güncellediği için kısa bir
      // gecikmeyle listeyi tazeliyoruz (indirme yeni sekmede açılır, burada beklemez).
      setTimeout(() => { void refresh(); }, 1500);
    },
    [refresh]
  );

  const handleExportPrepShip = useCallback((batch: { batchNumber: string }) => {
    window.open(`/api/batches/${encodeURIComponent(batch.batchNumber)}/prepship-export`, "_blank");
  }, []);

  const handleExportCsv = useCallback(async () => {
    setExportingCsv(true);
    setActionError(null);
    try {
      await downloadFilteredOrdersCsv({
        storeCode: selectedStore,
        search: deferredSearch,
        cargo: cargoFilter,
        batch: batchFilter,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "CSV dışa aktarımı başarısız oldu.");
    } finally {
      setExportingCsv(false);
    }
  }, [batchFilter, cargoFilter, deferredSearch, selectedStore]);

  if (checkingAuth) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-base">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-brand-soft" />
          <p className="font-mono-tech text-[11px] text-ink-faint">Oturum doğrulanıyor…</p>
        </div>
      </div>
    );
  }

  const meta = PAGE_META[activeTab];

  return (
    <div className="flex min-h-screen bg-surface-base bg-tactical-grid">
      <a href="#main-content" className="sr-only skip-link">
        İçeriğe atla
      </a>

      <Sidebar
        groups={navGroups}
        activeTab={activeTab}
        onNavigate={navigate}
        collapsed={navCollapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        currentUser={currentUser}
        onLogout={logout}
      />

      {/* Sağ çalışma alanı.
          `min-w-0` kritik: flex çocuğunun varsayılan `min-width:auto` değeri,
          içindeki geniş tabloların kapsayıcıyı esnetip sol menünün altına
          taşmasına yol açıyordu. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          stores={stores}
          selectedStore={selectedStore}
          onStoreChange={(storeCode) => {
            setOrderPage(1);
            setSelectedStore(storeCode);
          }}
          storeLocked={isStoreLocked}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onExportCsv={handleExportCsv}
          onOpenImport={() => setIsXlsImportOpen(true)}
          onOpenNewOrder={() => setIsNewOrderOpen(true)}
          onRefresh={refresh}
          refreshing={loading}
        />

        <main id="main-content" className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6">
          {dataError && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{dataError}</span>
              <button
                onClick={refresh}
                className="flex items-center gap-1.5 rounded-lg bg-danger/20 px-3 py-1.5 text-[11px] font-bold transition hover:bg-danger/30"
              >
                <RefreshCw className="h-3 w-3" /> Tekrar dene
              </button>
            </div>
          )}

          {actionError && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="rounded-lg bg-danger/20 px-3 py-1.5 text-[11px] font-bold transition hover:bg-danger/30"
              >
                Kapat
              </button>
            </div>
          )}

          <KpiStrip kpis={kpis} briefing={briefing} storeScope={selectedStore} />

          {activeTab === "BRIEFING_DECISION" && (
            <div className="space-y-5">
              <MorningBriefingPanel briefing={briefing} storeScope={selectedStore} />
              <DecisionVaultTable
                masters={productMasters}
                decisionFilter={decisionFilter}
                onDecisionFilterChange={setDecisionFilter}
                onSelect={setSelectedMaster}
              />
            </div>
          )}

          {activeTab === "ANALYTICS" && (
            <DecisionSupportDashboard storeCode={selectedStore} />
          )}

          {activeTab === "STORE_HEALTH" && <StoreHealthScreen />}

          {activeTab === "CRAWLER" && (
            <CrawlerPanel defaultStore={selectedStore} />
          )}

          {activeTab === "KEEPA" && (
            <KeepaAnalysisPanel defaultStore={selectedStore} />
          )}

          {activeTab === "PRODUCTS" && (
            <ProductPortfolio
              products={products}
              summary={productSummary}
              loading={loading}
              onSelect={setSelectedProduct}
            />
          )}

          {activeTab === "RESEARCHERS" && <ResearcherBoard researchers={researchers} />}

          {activeTab === "XLS_MASTER" && (
            <OrdersTable
              orders={filteredOrders}
              batches={batches}
              searchQuery={searchQuery}
              onSearchChange={(value) => {
                setSearchQuery(value);
                setOrderPage(1);
              }}
              cargoFilter={cargoFilter}
              onCargoFilterChange={(value) => {
                setCargoFilter(value);
                setOrderPage(1);
              }}
              batchFilter={batchFilter}
              onBatchFilterChange={(value) => {
                setBatchFilter(value);
                setOrderPage(1);
              }}
              pagination={orderPagination}
              onPageChange={setOrderPage}
              onPageSizeChange={(value) => {
                setOrderPageSize(value);
                setOrderPage(1);
              }}
              exportingCsv={exportingCsv}
              onExportCsv={handleExportCsv}
              onOpenWarehouse={() => setIsWarehouseReconOpen(true)}
              onSelect={setSelectedOrder}
            />
          )}

          {activeTab === "PSH_BATCHES" && (
            <PshBatchPanel
              batches={batches}
              orders={orders}
              onCreate={() => setIsPshBatchOpen(true)}
              onAdvanceStatus={handleAdvanceBatchStatus}
              onExportInventoryLab={handleExportInventoryLab}
              onExportPrepShip={handleExportPrepShip}
              onImportPrepShip={(batch) => setPrepShipImportBatch(batch)}
            />
          )}

          {activeTab === "WAREHOUSE" && (
            <WarehousePanel
              orders={filteredOrders}
              onStartCount={() => setIsWarehouseReconOpen(true)}
              onSelect={setSelectedOrder}
            />
          )}

          {activeTab === "INVENTORY_LAB" && (
            <InventoryLabPanel orders={filteredOrders} kpis={kpis} />
          )}

          {activeTab === "PROBLEMS" && (
            <ProblemsPanel orders={filteredOrders} onSelect={setSelectedOrder} />
          )}

          {activeTab === "ADMIN" && isAdmin && (
            <AdminDashboard
              currentUser={currentUser}
              onStoreSelected={(storeCode: string) => {
                setOrderPage(1);
                setSelectedStore(storeCode);
                setActiveTab("XLS_MASTER");
              }}
              onDataRefresh={refresh}
            />
          )}
        </main>
      </div>

      <ProductJourneyDrawer
        product={selectedProduct}
        canManage={Boolean(isAdmin)}
        onClose={() => setSelectedProduct(null)}
        onStageChanged={refresh}
      />

      <ProductMasterDrawer
        master={selectedMaster}
        onClose={() => setSelectedMaster(null)}
        onUpdateDecision={handleUpdateMasterDecision}
      />

      <OrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdate={handleUpdateOrder}
        batches={batches}
      />

      <NewOrderModal
        isOpen={isNewOrderOpen}
        onClose={() => setIsNewOrderOpen(false)}
        onCreated={(newOrder: OrderView) => {
          prependOrder(newOrder);
          setSelectedOrder(newOrder);
          void refresh();
        }}
        currentStore={selectedStore}
      />

      <GoogleDriveXlsImportModal
        isOpen={isXlsImportOpen}
        onClose={() => setIsXlsImportOpen(false)}
        onImportSuccess={refresh}
        currentStore={selectedStore}
      />

      <PshBatchModal
        isOpen={isPshBatchOpen}
        onClose={() => setIsPshBatchOpen(false)}
        onCreated={refresh}
        currentStore={selectedStore}
        unbatchedOrders={orders.filter((o) => !o.pshBatchNo)}
      />

      <WarehouseReconciliationModal
        isOpen={isWarehouseReconOpen}
        onClose={() => setIsWarehouseReconOpen(false)}
        onSaved={refresh}
        orders={filteredOrders}
      />

      {prepShipImportBatch && (
        <PrepShipImportModal
          isOpen={Boolean(prepShipImportBatch)}
          onClose={() => setPrepShipImportBatch(null)}
          onImported={refresh}
          batchNumber={prepShipImportBatch.batchNumber}
          batchTitle={prepShipImportBatch.title}
        />
      )}
    </div>
  );
}
