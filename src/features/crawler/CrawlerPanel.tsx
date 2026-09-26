"use client";

import { useState } from "react";
import { Globe, Search, Loader2, ExternalLink, Plus, CheckCircle2, AlertTriangle, ImageIcon, TrendingDown, Barcode, ShieldAlert } from "lucide-react";

interface ScrapedRow {
  id: number;
  jobId: number;
  sourceUrl: string;
  sourceDomain: string;
  title: string;
  brand: string;
  price: string | null;
  currency: string;
  imageUrl: string | null;
  availability: string;
  asinCandidate: string | null;
  sourceSku: string | null;
  gtin: string | null;
  baselinePrice: string | null;
  baselineAt: string | null;
  firstBelowBaselineAt: string | null;
  status: string;
}

interface PriceDrop {
  title: string;
  from: string;
  to: string;
  pct: number;
}

export function CrawlerPanel({ defaultStore }: { defaultStore: string }) {
  const [url, setUrl] = useState("https://www.vitaminshoppe.com/");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobId: number; sourceDomain: string; products: ScrapedRow[]; warnings: string[]; priceDrops?: PriceDrop[]; engine?: string; blockedBy?: string | null; cached: boolean; fetchedAt: string; isListingPage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const presets = [
    { label: "Vitamin Shoppe — Vitaminler", url: "https://www.vitaminshoppe.com/c/vitamins-supplements" },
    { label: "Vitamin Shoppe — Protein", url: "https://www.vitaminshoppe.com/c/sports-nutrition/protein" },
    { label: "iHerb (örnek)", url: "https://www.iherb.com/c/vitamins" },
    { label: "Walgreens (örnek)", url: "https://www.walgreens.com/store/c/vitamins-and-supplements/ID=360518-tier2general" },
  ];

  const BLOCK_LABEL: Record<string, string> = {
    datadome: "DataDome",
    cloudflare: "Cloudflare",
    akamai: "Akamai",
    perimeterx: "PerimeterX",
    imperva: "Imperva",
    generic: "bilinmeyen koruma",
  };

  async function handleScrape() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setBlockedBy(null);
    setResult(null);
    setSelected(new Set());
    setImportMsg(null);
    try {
      const res = await fetch("/api/crawler/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), storeCode: defaultStore }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlockedBy(data.blockedBy ?? null);
        throw new Error(data.error || "Tarama başarısız");
      }
      setResult(data);
      // varsayılan hepsini seç
      setSelected(new Set(data.products.map((p: ScrapedRow) => p.id)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!selected.size || !result) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/crawler/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrapedIds: Array.from(selected), storeCode: defaultStore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Aktarım başarısız");
      setImportMsg(`✓ ${data.imported} ürün kataloğa aktarıldı — Ürün Portföyü ve Analitik otomatik güncellenecek. ${data.warnings?.length ? data.warnings.join(" ") : ""}`);
      // işaretlileri temizle
      setResult((prev) => prev ? { ...prev, products: prev.products.map((p) => selected.has(p.id) ? { ...p, status: "IMPORTED" } : p) } : prev);
      setSelected(new Set());
    } catch (e: unknown) {
      setImportMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-brand/20 bg-surface-1 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 border border-brand/30 text-brand-soft">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-ink">Crawler Keşif Masası</h2>
            <p className="text-xs text-ink-muted font-mono-tech">
              <span className="text-brand-soft font-bold">İndirim Takip Masası</span> — daha önce sattığınız ürünlerin
              alış fiyatını izleyin, indirimi erken görün. İlk sürüm{" "}
              <span className="text-brand-soft font-bold">vitaminshoppe.com</span> için optimize.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.vitaminshoppe.com/p/... veya https://.../c/..."
                className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand/50 focus:outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleScrape()}
              />
            </div>
            <button
              onClick={handleScrape}
              disabled={loading || !url.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Tara
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-ink-faint font-mono-tech py-1">Hızlı dene:</span>
            {presets.map((p) => (
              <button
                key={p.url}
                onClick={() => setUrl(p.url)}
                className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-muted hover:border-brand/30 hover:text-brand-soft transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-surface-2 border border-line p-3 text-[11px] font-mono-tech text-ink-faint leading-relaxed">
            <span className="font-bold text-ink-muted">Nasıl çalışır?</span> Sunucu URL’yi{" "}
            <span className="text-ink">15 sn timeout + 3 MB limit</span> ile çeker. Önce{" "}
            <code className="bg-surface-3 px-1 rounded">JSON-LD</code>, sonra generic fallback dener.
            <br />
            <span className="font-bold text-ink-muted">Fiyat geçmişi:</span> her tarama GTIN bazlı satırı
            günceller; ilk fiyat <code className="bg-surface-3 px-1 rounded">baseline</code> olur. Fiyat baseline’ın
            altına düşünce <span className="text-positive">ilk kez düştüğü tarih</span> kilitlenir — kupon/peşin indirim
            fırsatını kaçırmamak için gereken budur.
            <br />
            <span className="font-bold text-ink-muted">GTIN:</span> perakende slug’ı Amazon ASIN’i{" "}
            <span className="text-danger">değildir</span>. Amazon’daki karşılığı bulmak için{" "}
            <span className="text-ink">GTIN/UPC</span> kullanılır — başlık metni kupon sonrası değiştiği için
            güvenilmezdir. Tarama yaparken <span className="text-ink">ürün sayfası</span> (kategori listesi değil)
            kullanın; GTIN orada bulunur.
            <br />
            Aynı URL 6 saat içinde tekrar taranırsa <span className="text-positive">önbellekten</span> döner (kota
            koruması). Seçtikleriniz tek tıkla ürün kataloğuna eklenir ve fiyat gözlemi oluşturur.
          </div>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {blockedBy ? <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <div>{error}</div>
            {blockedBy && (
              <div className="mt-2 rounded-lg border border-danger/25 bg-surface-1/60 px-3 py-2 text-[11px] font-mono-tech leading-relaxed text-ink-muted">
                <span className="font-bold text-ink">Engelleyen: {BLOCK_LABEL[blockedBy] ?? blockedBy}</span>
                <br />
                Tarayıcıda çalışması normal — koruma gerçek bir tarayıcı parmak izi
                (TLS + JavaScript) istiyor. Header taklidi yetmez. Çözüm: gerçek
                Chromium çalıştıran Scrapling servisi, tercihen ABD kaynaklı.
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
            <div className="text-xs font-mono-tech">
              <span className="text-ink font-bold">{result.products.length} ürün</span>
              <span className="text-ink-muted"> • {result.sourceDomain}</span>
              <span className="text-ink-faint"> • {result.isListingPage ? "Liste sayfası" : "Tek ürün sayfası"}</span>
              {result.cached && <span className="ml-2 rounded bg-positive/15 text-positive px-1.5 py-0.5 text-[10px] font-bold">ÖNBELLEK</span>}
              {result.engine === "scrapling-service" && <span className="ml-2 rounded bg-brand/15 text-brand-soft px-1.5 py-0.5 text-[10px] font-bold">GERÇEK TARAYICI</span>}
              {result.priceDrops && result.priceDrops.length > 0 && (
                <span className="ml-2 rounded bg-positive/15 text-positive px-1.5 py-0.5 text-[10px] font-bold">
                  {result.priceDrops.length} FİYAT DÜŞÜŞÜ
                </span>
              )}
              <span className="text-ink-faint ml-2">{new Date(result.fetchedAt).toLocaleString("tr-TR")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint font-mono-tech">{selected.size} seçili</span>
              <button onClick={() => setSelected(new Set(result.products.filter((p) => p.status === "PENDING").map((p) => p.id)))} className="text-xs text-brand-soft hover:underline">Hepsini seç</button>
              <span className="text-ink-faint">·</span>
              <button onClick={() => setSelected(new Set())} className="text-xs text-ink-faint hover:text-ink">Temizle</button>
              <button
                onClick={handleImport}
                disabled={!selected.size || importing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-positive px-3 py-1.5 text-xs font-bold text-white hover:bg-positive/90 disabled:opacity-40"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Seçilenleri Kataloğa Ekle
              </button>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-caution/30 bg-caution/10 px-4 py-3 text-xs text-caution">
              <div className="font-bold flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Uyarılar</div>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {importMsg && (
            <div className={`rounded-xl border px-4 py-3 text-xs ${importMsg.startsWith("✓") ? "border-positive/30 bg-positive/10 text-positive" : "border-danger/30 bg-danger/10 text-danger"}`}>
              {importMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {result.products.map((p) => {
              const isSelected = selected.has(p.id);
              const imported = p.status === "IMPORTED";
              return (
                <div
                  key={p.id}
                  className={`group relative flex flex-col rounded-2xl border bg-surface-1 p-3 transition ${isSelected ? "border-brand/40 bg-brand/5" : "border-line hover:border-line-strong"} ${imported ? "opacity-60" : ""}`}
                >
                  <label className="absolute left-3 top-3 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={isSelected} disabled={imported} onChange={() => toggle(p.id)} className="h-4 w-4 rounded border-line bg-surface-2 text-brand focus:ring-brand/30" />
                    {imported && <span className="inline-flex items-center gap-1 rounded bg-positive/15 text-positive px-1.5 py-0.5 text-[10px] font-bold"><CheckCircle2 className="h-3 w-3" /> Eklendi</span>}
                  </label>
                  <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="absolute right-3 top-3 text-ink-faint hover:text-brand-soft">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>

                  <div className="mt-6 flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-ink-faint"><ImageIcon className="h-6 w-6" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-medium leading-snug text-ink">{p.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-caution">{p.brand}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.availability === "IN_STOCK" ? "bg-positive/15 text-positive" : p.availability === "OUT_OF_STOCK" ? "bg-danger/15 text-danger" : "bg-surface-3 text-ink-faint"}`}>
                          {p.availability === "IN_STOCK" ? "Stokta" : p.availability === "OUT_OF_STOCK" ? "Tükendi" : "Bilinmiyor"}
                        </span>
                        {p.asinCandidate && <span className="font-mono-tech text-[10px] text-brand-soft">{p.asinCandidate}</span>}
                        {p.sourceSku && <span className="font-mono-tech text-[10px] text-ink-faint">SKU {p.sourceSku}</span>}
                      </div>

                      {/* GTIN: Amazon eşleştirmenin gerçek anahtarı. */}
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint font-mono-tech">
                        <Barcode className="h-3 w-3 shrink-0" />
                        {p.gtin ? (
                          <span className="text-ink-muted" title="GTIN/UPC — Amazon kataloğunda bu numara birebir tutar">
                            GTIN {p.gtin}
                          </span>
                        ) : (
                          <span title="GTIN yok — Amazon eşleştirmesi yapılamaz. Ürün sayfasını (kategori değil) tarayın.">
                            GTIN yok
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                        {p.price !== null ? (
                          <span className="text-sm font-bold text-caution tabular">${Number(p.price).toFixed(2)}</span>
                        ) : (
                          <span className="text-xs text-ink-faint">Fiyat yok</span>
                        )}
                        {/* Geçmişe göre indirim — kullanıcının asıl takip ettiği şey. */}
                        {p.baselinePrice !== null && p.price !== null && Number(p.price) < Number(p.baselinePrice) && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-positive/15 px-1.5 py-0.5 text-[10px] font-bold text-positive">
                            <TrendingDown className="h-3 w-3" />
                            %{Math.round(((Number(p.baselinePrice) - Number(p.price)) / Number(p.baselinePrice)) * 100)} indirim
                          </span>
                        )}
                        {p.firstBelowBaselineAt && (
                          <span className="text-[10px] font-mono-tech text-positive">
                            ilk kez {new Date(p.firstBelowBaselineAt).toLocaleDateString("tr-TR")} altında
                          </span>
                        )}
                        <span className="text-[11px] text-ink-faint">{p.sourceDomain}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 truncate font-mono-tech text-[10px] text-ink-faint">{p.sourceUrl}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-line bg-surface-1/50 p-10 text-center">
          <Globe className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mt-2 text-sm font-medium text-ink-muted">Henüz tarama yok</p>
          <p className="mx-auto mt-1 max-w-md text-xs font-mono-tech text-ink-faint">Yukarıya bir ürün veya kategori URL’si yapıştırıp <span className="text-brand-soft">Tara</span> deyin. Sonuçlar burada listelenecek.</p>
        </div>
      )}
    </div>
  );
}
