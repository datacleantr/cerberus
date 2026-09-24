"use client";

import {
  AlertTriangle,
  Boxes,
  Building2,
  ChevronLeft,
  FileSpreadsheet,
  LogOut,
  Globe,
  BarChart3,
  HeartPulse,
  LineChart,
  PackageCheck,
  PanelLeft,
  ShieldCheck,
  Sun,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionUserView, TabId } from "../types";

export interface NavItem {
  id: TabId;
  label: string;
  hint: string;
  badge?: string | number;
  tone?: "default" | "danger";
  icon: LucideIcon;
}

/** Menü grupları — işin akış sırasına göre dizildi: karar → tedarik → operasyon → yönetim */
export function buildNavGroups(counts: {
  masters: number;
  products: number;
  researchers: number;
  orders: number;
  batches: number;
  problems: number;
  stores: number;
  isAdmin: boolean;
}): Array<{ title: string; items: NavItem[] }> {
  return [
    {
      title: "Karar",
      items: [
        {
          id: "BRIEFING_DECISION",
          label: "Sabah Brifingi",
          hint: "İş sağlığı skoru ve karar kasası",
          badge: counts.masters,
          icon: Sun,
        },
        {
          id: "ANALYTICS",
          label: "Karar Destek Analitik",
          hint: "Kârlılık, trend ve mağaza kıyas — XLS’ten kurtuluş",
          icon: LineChart,
        },
        {
          id: "STORE_HEALTH",
          label: "Mağaza Sağlığı",
          hint: "Haftalık hesap sağlığı — canlı hesap, uydurma skor yok",
          icon: HeartPulse,
        },
      ],
    },
    {
      title: "Keşif",
      items: [
        {
          id: "CRAWLER",
          label: "Crawler Keşif Masası",
          hint: "URL yapıştır → ürünleri otomatik çek",
          icon: Globe,
        },
        {
          id: "KEEPA",
          label: "Keepa Analiz",
          hint: "ASIN → BSR/fiyat/Karar Engine 2.0",
          icon: BarChart3,
        },
      ],
    },
    {
      // Ürün, sistemin kalbi: kendi grubunda ve karardan hemen sonra durur.
      title: "Ürün",
      items: [
        {
          id: "PRODUCTS",
          label: "Ürün Portföyü",
          hint: "Keşiften satışa ürün yolculuğu ve kâr sağlığı",
          badge: counts.products,
          icon: Boxes,
        },
      ],
    },
    {
      title: "Tedarik",
      items: [
        {
          id: "RESEARCHERS",
          label: "Sourcing Ekibi",
          hint: "Araştırmacı performans karnesi",
          badge: counts.researchers,
          icon: Users,
        },
      ],
    },
    {
      title: "Operasyon",
      items: [
        {
          id: "XLS_MASTER",
          label: "Siparişler",
          hint: "40 kolonluk sipariş ana tablosu",
          badge: counts.orders,
          icon: FileSpreadsheet,
        },
        {
          id: "PSH_BATCHES",
          label: "PSH Partileri",
          hint: "Sevkiyat batch yönetimi",
          badge: counts.batches,
          icon: Building2,
        },
        {
          id: "WAREHOUSE",
          label: "Depo Sayımı",
          hint: "Order No eşleştirme ve karşılama",
          icon: PackageCheck,
        },
        {
          id: "PROBLEMS",
          label: "Fire & Problem",
          hint: "P1–P4 iptal, eksik, defolu, refund",
          badge: counts.problems,
          tone: counts.problems > 0 ? "danger" : "default",
          icon: AlertTriangle,
        },
      ],
    },
    {
      title: "Finans",
      items: [
        {
          id: "INVENTORY_LAB",
          label: "Inventory Lab",
          hint: "Maliyet, satış ve kâr muhasebesi",
          icon: TrendingUp,
        },
      ],
    },
    ...(counts.isAdmin
      ? [
          {
            title: "Yönetim",
            items: [
              {
                id: "ADMIN" as TabId,
                label: "Komuta Merkezi",
                hint: "Mağaza, kullanıcı ve denetim",
                badge: counts.stores,
                icon: ShieldCheck,
              },
            ],
          },
        ]
      : []),
  ];
}

function initials(name?: string) {
  if (!name) return "??";
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function Sidebar({
  groups,
  activeTab,
  onNavigate,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  currentUser,
  onLogout,
}: {
  groups: Array<{ title: string; items: NavItem[] }>;
  activeTab: TabId;
  onNavigate: (id: TabId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  currentUser: SessionUserView | null;
  onLogout: () => void;
}) {
  const width = collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)";

  return (
    <>
      {/* Mobil karartma katmanı */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/*
        Masaüstü (lg+): `shrink-0` ile normal flex akışında yer tutar; içerik
        onun yanına dizilir, üstüne binemez.
        Mobil: akıştan çıkıp (`fixed`) kayan katman olur.
      */}
      <aside
        style={{ width }}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface-1
          transition-transform duration-200
          lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Ana gezinme"
      >
        {/* Marka */}
        <div className="flex h-[var(--topbar-h)] items-center gap-2.5 border-b border-line px-4 shrink-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand via-info to-positive font-display text-sm font-bold text-white shadow-lg shadow-brand/25">
            C
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm font-bold tracking-tight text-ink">
                CERBERUS
              </div>
              <div className="truncate font-mono-tech text-[10px] text-ink-faint">
                Karar Merkezli Ticaret OS
              </div>
            </div>
          )}
          <button
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink lg:hidden"
            aria-label="Menüyü kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Gezinme */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="px-2.5 pb-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {group.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => onNavigate(item.id)}
                        title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition
                          ${
                            active
                              ? "bg-brand/15 text-ink"
                              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                          }`}
                      >
                        {/* Aktif göstergesi */}
                        <span
                          className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand transition-opacity ${
                            active ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        <Icon
                          className={`h-[18px] w-[18px] shrink-0 ${
                            active ? "text-brand-soft" : "text-ink-faint group-hover:text-ink-muted"
                          }`}
                        />
                        {!collapsed && (
                          <>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {item.label}
                            </span>
                            {item.badge !== undefined && item.badge !== 0 && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono-tech text-[10px] font-bold tabular ${
                                  item.tone === "danger"
                                    ? "bg-danger/15 text-danger"
                                    : active
                                    ? "bg-brand/25 text-brand-soft"
                                    : "bg-surface-3 text-ink-faint"
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                        {/* Daraltılmışken rozet noktası */}
                        {collapsed && item.tone === "danger" && item.badge !== 0 && (
                          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Kullanıcı & çıkış */}
        <div className="border-t border-line p-3 shrink-0">
          <div
            className={`flex items-center gap-2.5 rounded-xl bg-surface-2 p-2.5 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/20 font-mono-tech text-[11px] font-bold text-brand-soft">
              {initials(currentUser?.name)}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-ink">
                    {currentUser?.name ?? "Kullanıcı"}
                  </div>
                  <div className="truncate font-mono-tech text-[10px] text-ink-faint">
                    {currentUser?.role === "ADMIN"
                      ? "Sistem yöneticisi"
                      : `${currentUser?.storeCode ?? ""} yetkilisi`}
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  title="Güvenli çıkış"
                  aria-label="Güvenli çıkış"
                  className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-danger/15 hover:text-danger"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {/* Daralt/genişlet — yalnız masaüstü */}
          <button
            onClick={onToggleCollapse}
            className="mt-2 hidden w-full items-center justify-center gap-2 rounded-lg py-2 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-ink-faint transition hover:bg-surface-2 hover:text-ink-muted lg:flex"
          >
            {collapsed ? (
              <PanelLeft className="h-3.5 w-3.5" />
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5" /> Menüyü daralt
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
