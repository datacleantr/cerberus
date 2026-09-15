"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BatchView,
  MorningBriefingView,
  OrderKpis,
  OrderPagination,
  OrderQuery,
  OrderView,
  ProductMasterView,
  ProductView,
  ProductSummaryView,
  ResearcherView,
  SessionUserView,
  StoreView,
} from "./types";

interface CerberusData {
  currentUser: SessionUserView | null;
  checkingAuth: boolean;
  orders: OrderView[];
  orderKpis: OrderKpis;
  orderPagination: OrderPagination;
  stores: StoreView[];
  batches: BatchView[];
  productMasters: ProductMasterView[];
  products: ProductView[];
  productSummary: ProductSummaryView | null;
  researchers: ResearcherView[];
  briefing: MorningBriefingView | null;
  loading: boolean;
  dataError: string | null;
  selectedStore: string;
  setSelectedStore: (code: string) => void;
  refresh: () => Promise<void>;
  applyOrderPatch: (id: number, patch: Partial<OrderView>) => void;
  applyMasterPatch: (id: number, patch: Partial<ProductMasterView>) => void;
  prependOrder: (order: OrderView) => void;
  logout: () => Promise<void>;
}

const EMPTY_KPIS: OrderKpis = {
  totalOrders: 0,
  totalUnits: 0,
  totalSpend: "0.00",
  totalShipped: 0,
  totalRevenueEst: "0.00",
  grossNetEst: "0.00",
  avgRoi: "—",
  fulfillmentRate: 0,
  problemCount: 0,
  totalRefunds: "0.00",
};

const EMPTY_PAGINATION: OrderPagination = { page: 1, pageSize: 50, total: 0, pageCount: 0 };

function mapOrderKpis(value: Record<string, unknown> | undefined): OrderKpis {
  if (!value) return EMPTY_KPIS;
  return {
    totalOrders: Number(value.totalOrdersCount || 0),
    totalUnits: Number(value.totalUnits || 0),
    totalSpend: String(value.totalSpend ?? "0.00"),
    totalShipped: Number(value.totalShippedToAmazon || 0),
    totalRevenueEst: String(value.estimatedRevenue ?? "0.00"),
    grossNetEst: String(value.estimatedNet ?? "0.00"),
    avgRoi: String(value.estimatedRoi ?? "—"),
    fulfillmentRate: Number(value.fulfillmentRate || 0),
    problemCount: Number(value.problemOrdersCount || 0),
    totalRefunds: String(value.totalRefunds ?? "0.00"),
  };
}

/**
 * Server-state coordinator.
 *
 * Order pages are fetched independently from product/intelligence context.
 * Changing a page or typing a search therefore does not rerun expensive
 * portfolio aggregates, while a store change refreshes both data groups.
 */
export function useCerberusData(orderQuery: OrderQuery): CerberusData {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUserView | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [orderKpis, setOrderKpis] = useState<OrderKpis>(EMPTY_KPIS);
  const [orderPagination, setOrderPagination] =
    useState<OrderPagination>(EMPTY_PAGINATION);
  const [stores, setStores] = useState<StoreView[]>([]);
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [productMasters, setProductMasters] = useState<ProductMasterView[]>([]);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [productSummary, setProductSummary] = useState<ProductSummaryView | null>(null);
  const [researchers, setResearchers] = useState<ResearcherView[]>([]);
  const [briefing, setBriefing] = useState<MorningBriefingView | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string>("ALL");

  useEffect(() => {
    let aborted = false;

    async function verify() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (aborted) return;
        if (!res.ok) {
          router.replace("/login");
          return;
        }

        const data = await res.json();
        if (aborted) return;
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }

        setCurrentUser(data.user as SessionUserView);
        if (data.user.role === "STORE_USER" && data.user.storeCode !== "ALL") {
          setSelectedStore(data.user.storeCode);
        }
      } catch {
        if (!aborted) setContextError("Oturum doğrulanamadı. Bağlantınızı kontrol edin.");
      } finally {
        if (!aborted) setCheckingAuth(false);
      }
    }

    void verify();
    return () => {
      aborted = true;
    };
  }, [router]);

  const loadOrders = useCallback(
    async (signal?: AbortSignal) => {
      setOrdersLoading(true);
      try {
        const params = new URLSearchParams({
          storeCode: selectedStore,
          page: String(orderQuery.page),
          pageSize: String(orderQuery.pageSize),
        });
        if (orderQuery.search.trim()) params.set("search", orderQuery.search.trim());
        if (orderQuery.cargo !== "ALL") params.set("cargoStatus", orderQuery.cargo);
        if (orderQuery.batch !== "ALL") params.set("pshBatchNo", orderQuery.batch);

        const response = await fetch(`/api/orders?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("orders request failed");

        const json = await response.json();
        setOrders(json.orders ?? []);
        setStores(json.stores ?? []);
        setBatches(json.batches ?? []);
        setOrderKpis(mapOrderKpis(json.kpis));
        setOrderPagination(json.pagination ?? EMPTY_PAGINATION);
        setOrdersError(null);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        setOrdersError("Siparişler alınamadı; eksik veya eski kayıt gösterilmiyor.");
      } finally {
        if (!signal?.aborted) setOrdersLoading(false);
      }
    }, [
      orderQuery.batch,
      orderQuery.cargo,
      orderQuery.page,
      orderQuery.pageSize,
      orderQuery.search,
      router,
      selectedStore,
    ]
  );

  const loadContext = useCallback(
    async (signal?: AbortSignal) => {
      setContextLoading(true);
      try {
        const storeCode = encodeURIComponent(selectedStore);
        const [intelRes, productsRes] = await Promise.all([
          fetch(`/api/intelligence?storeCode=${storeCode}`, { cache: "no-store", signal }),
          fetch(`/api/products?storeCode=${storeCode}`, { cache: "no-store", signal }),
        ]);
        if (intelRes.status === 401 || productsRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!intelRes.ok || !productsRes.ok) throw new Error("context request failed");

        const [intelJson, productsJson] = await Promise.all([
          intelRes.json(),
          productsRes.json(),
        ]);
        setProductMasters(intelJson.productMasters ?? []);
        setProducts(productsJson.products ?? []);
        setProductSummary(productsJson.summary ?? null);
        setResearchers(intelJson.researchers ?? []);
        setBriefing(intelJson.morningBriefing ?? null);
        setContextError(null);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        setContextError("Karar ve ürün verileri alınamadı; eksik veri gösterilmiyor.");
      } finally {
        if (!signal?.aborted) setContextLoading(false);
      }
    }, [router, selectedStore]
  );

  useEffect(() => {
    if (checkingAuth || !currentUser) return;
    const controller = new AbortController();
    void loadOrders(controller.signal);
    return () => controller.abort();
  }, [checkingAuth, currentUser, loadOrders]);

  useEffect(() => {
    if (checkingAuth || !currentUser) return;
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => controller.abort();
  }, [checkingAuth, currentUser, loadContext]);

  const refresh = useCallback(async () => {
    await Promise.all([loadOrders(), loadContext()]);
  }, [loadContext, loadOrders]);

  const applyOrderPatch = useCallback((id: number, patch: Partial<OrderView>) => {
    setOrders((prev) => prev.map((order) => (order.id === id ? { ...order, ...patch } : order)));
  }, []);

  const applyMasterPatch = useCallback((id: number, patch: Partial<ProductMasterView>) => {
    setProductMasters((prev) => prev.map((master) => (master.id === id ? { ...master, ...patch } : master)));
  }, []);

  const prependOrder = useCallback((order: OrderView) => {
    setOrders((prev) => [order, ...prev].slice(0, orderQuery.pageSize));
  }, [orderQuery.pageSize]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  return {
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
    loading: ordersLoading || contextLoading,
    dataError: ordersError || contextError,
    selectedStore,
    setSelectedStore,
    refresh,
    applyOrderPatch,
    applyMasterPatch,
    prependOrder,
    logout,
  };
}
