"use client";

import { clientLog } from "@/lib/clientLogger";
import React, { useState } from "react";
import { X, Plus, DollarSign, Package, Truck, ExternalLink, ShieldCheck } from "lucide-react";

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (order: any) => void;
  currentStore: string;
}

export function NewOrderModal({
  isOpen,
  onClose,
  onCreated,
  currentStore,
}: NewOrderModalProps) {
  const store = currentStore === "ALL" ? "HRN" : currentStore;

  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0]);
  const [productTitle, setProductTitle] = useState("");
  const [asin, setAsin] = useState("");
  const [msku, setMsku] = useState("");
  const [brandName, setBrandName] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [supplierName, setSupplierName] = useState("THE VITAMINSHOPPE");
  const [supplierCode, setSupplierCode] = useState("A198");
  const [supplierUrl, setSupplierUrl] = useState("");
  const [amazonUrl, setAmazonUrl] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [quantity, setQuantity] = useState("4");
  const [unitCost, setUnitCost] = useState("29.99");
  const [sellingPrice, setSellingPrice] = useState("65.00");
  const [orderEmail, setOrderEmail] = useState("heyberus@gmail.com");
  const [cargoStatus, setCargoStatus] = useState("Tam Geldi");
  const [creditCard, setCreditCard] = useState("");
  const [periodCode, setPeriodCode] = useState("Ş26");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const totalCost = (Number(quantity) * Number(unitCost)).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productTitle || !asin || !orderNumber) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerStore: store,
          orderDate,
          productTitle,
          asin,
          msku: msku || `${store}-${asin}`,
          brandName: brandName || "Genel",
          orderNumber,
          supplierName,
          supplierCode,
          supplierUrl: supplierUrl || `https://www.vitaminshoppe.com/search?q=${encodeURIComponent(productTitle)}`,
          amazonUrl: amazonUrl || `https://www.amazon.com/dp/${asin}`,
          driveLink,
          quantity: Number(quantity),
          unitCost: Number(unitCost),
          sellingPrice: Number(sellingPrice),
          totalCost: Number(totalCost),
          orderEmail,
          cargoStatus,
          creditCard,
          periodCode,
          correctedCost: Number(totalCost),
        }),
      });

      const data = await res.json();
      if (res.ok && data.order) {
        onCreated(data.order);
        onClose();
      }
    } catch (err) {
      clientLog.error("orders/create", "Sipariş eklenemedi", { err: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#161C28] border border-line rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-[#0E1420]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-info/10 border border-info/30 text-info">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-ink">
                Yeni Sipariş Girişi ({store} Mağazası)
              </h2>
              <p className="text-xs text-ink-muted font-mono-tech">
                Google Drive XLS formatında sipariş ve maliyet kaydı
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Satın Alan Mağaza
              </label>
              <input
                type="text"
                disabled
                value={store}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-positive font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Sipariş Tarihi
              </label>
              <input
                type="date"
                required
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Order No (Sipariş No)
              </label>
              <input
                type="text"
                required
                placeholder="Örn: WO110086220"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-info/40 rounded-lg text-xs font-mono-tech text-info font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
              Ürün Adı (Amazon Başlığı)
            </label>
            <input
              type="text"
              required
              placeholder="Örn: MegaFood One Daily Multivitamin 180 Tabs"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs text-ink"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Amazon ASIN
              </label>
              <input
                type="text"
                required
                placeholder="B00014DAJ8"
                value={asin}
                onChange={(e) => setAsin(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                MSKU
              </label>
              <input
                type="text"
                placeholder={`${store}-${asin || "ASIN"}`}
                value={msku}
                onChange={(e) => setMsku(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Marka Adı
              </label>
              <input
                type="text"
                placeholder="MegaFood / Vital / FORCE"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs text-ink"
              />
            </div>
          </div>

          {/* Fiyatlandırma ve Maliyet */}
          <div className="p-4 rounded-xl bg-[#0E1420] border border-line space-y-3">
            <span className="text-xs font-mono-tech uppercase text-caution font-bold flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" /> Maliyet ve Fiyat Bilgileri
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-mono-tech text-ink-muted mb-1">
                  Ürün Adedi
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-base border border-line rounded text-xs font-mono-tech text-ink"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono-tech text-ink-muted mb-1">
                  Birim Alış Maliyeti ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-base border border-line rounded text-xs font-mono-tech text-caution font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono-tech text-ink-muted mb-1">
                  Satış Fiyatı ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-base border border-emerald-500/50 rounded text-xs font-mono-tech text-positive font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono-tech text-ink-muted mb-1">
                  Toplam Maliyet
                </label>
                <div className="w-full px-3 py-1.5 bg-surface-base border border-info/40 rounded text-xs font-mono-tech text-info font-bold">
                  ${totalCost}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Sipariş Maili (Google Account)
              </label>
              <input
                type="email"
                value={orderEmail}
                onChange={(e) => setOrderEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Google Drive Fatura Linki
              </label>
              <input
                type="url"
                placeholder="https://drive.google.com/..."
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Kargo Durumu
              </label>
              <select
                value={cargoStatus}
                onChange={(e) => setCargoStatus(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              >
                <option value="Tam Geldi">Tam Geldi</option>
                <option value="Yolda">Yolda</option>
                <option value="İPTAL">İPTAL</option>
                <option value="Kayıp Depoya gelmiş">Kayıp Depoya gelmiş</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Kredi Kartı Son 4
              </label>
              <input
                type="text"
                maxLength={4}
                value={creditCard}
                onChange={(e) => setCreditCard(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono-tech text-ink-muted mb-1">
                Dönem Kodu
              </label>
              <input
                type="text"
                value={periodCode}
                onChange={(e) => setPeriodCode(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-line rounded-lg text-xs font-mono-tech text-ink"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-mono-tech text-ink-muted hover:text-ink transition"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-ink font-mono-tech text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-sky-500/20"
            >
              {submitting ? "Kaydediliyor..." : "Siparişi Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
