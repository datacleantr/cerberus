# Crawler — Mimari ve Gerçeklik Sözleşmesi

> vitaminshoppe.com ve benzeri perakende kaynaklarından ürün keşfi, fiyat ve
> indirim takibi. **Kullanım amacı:** daha önce Amazon'da satılmış ürünlerin
> alış fiyatını izlemek, indirimi erken görüp kupon/peşin indirimle almak.

## Akış

```text
User URL → /api/crawler/scrape → scrapeUrl()
  ├─ ısınma turu (site kökü) → cookie jar (datadome çerezi)
  ├─ asıl istek (cookie + tutarlı client hint'ler)
  │    ├─ 200 → JSON-LD → OG → ham link toplama
  │    ├─ 403/429/503 → koruma gövdesini oku → blockedBy tespit et
  │    │    └─ SCRAPLING_SERVICE_URL varsa → gerçek Chromium'a düş
  │    │    └─ yoksa → korumanın adını söyleyen dürüst hata
  └─ GTIN/SKU çıkar → fiyat geçmişini güncelle → uyarılar
```

## İki motor, iki farklı yetenek

| | JS stealth (`scraper.ts`) | Scrapling (`parsing.py` + `main.py`) |
|---|---|---|
| Yöntem | `fetch` + başlık taklidi | Playwright/Chromium + TLS parmak izi |
| GTIN çıkarır | ✅ | ✅ |
| Basit bot filtrelerini geçer | ✅ | ✅ |
| **DataDome / Cloudflare / Akamai** | ❌ | ✅ (ABD egress şart) |
| Gereken altyapı | yok (Next.js içinde) | ayrı container |

`engine` alanı hangisinin çalıştığını söyler; `blockedBy` hangi korumanın
engellediğini.

## Koruma tespiti

`detectBotChallenge()` imzaları:

| Koruma | İmza | Engel sayfası HTTP durumu |
|---|---|---|
| DataDome | `captcha-delivery.com`, `x-datadome`, `var dd=` | **403** |
| Cloudflare | `cf-chl-`, `__cf_chl`, `turnstile`, `cdn-cgi/challenge` | 403 **veya** 200 |
| PerimeterX | `px-captcha`, `_pxhd` | 403 |
| Imperva | `incapsula`, `_incap_` | 403 |
| Akamai | `akamaighosts`, `ak_bmsc` | 403 |

> **Neden `blockedBy` önemli:** eski sürüm yalnız Cloudflare kalıplarına bakıyordu.
> DataDome'un 403'ü hiçbir kalıba uymadığı için kod, korumayı hiç görmeden
> `!response.ok` dalına düşüyor ve kullanıcıya *"URL'yi kontrol edin"* diyordu.
> Doğrusu: *"URL geçerli, erişim engellendi."*

## Stealth katmanının gerçek sınırları

Bu katman **yalnız** tutarsız başlık kombinasyonlarını düzeltir:

- `Sec-Ch-Ua-Platform` User-Agent'tan türetilir (sabit `"Windows"` değil).
- `Referer` varsa `Sec-Fetch-Site: "same-origin"`, yoksa `"none"` — ikisi asla karıştırılmaz.
- Retry **gerçekten farklı profil** kullanır (`pickProfile(url, attempt)`).
- `Accept-Encoding` elle yazılmaz; undici kendi kodlamasını yönetir.
- Cookie jar: `datadome` çerezi ısıtma turunda alınır, sonraki istekte taşınır.

**Header taklidi koruma geçmez.** DataDome TLS handshake parmak izi
(JA3/JA4) ve `c.js` çalıştırma ister. Node `fetch` ikisini de yapamaz.
Aynı IP'den tarayıcı açılıp Node 403 alması normaldir.

## Ürün kimliği — hangi alan ne işe yarar

| Alan | Kaynak | Güvenilirlik |
|---|---|---|
| `gtin` | JSON-LD `gtin13/12/14/8`, `upc`, `ean` | ✅ **birincil eşleştirme anahtarı** — kontrol hanesi doğrulanır |
| `asinCandidate` | yalnız Amazon kaynaklı URL | ✅ yalnız Amazon'da anlamlı |
| `sourceSku` | JSON-LD `sku` / `productID` | ⚠️ perakende kodu, Amazon SKU'suyla birebir tutmayabilir |
| `mpn` | JSON-LD `mpn` | ⚠️ ikincil sinyal |
| `title` / `brand` | JSON-LD | ❌ kupon sonrası değişebilir, eşleştirmede kullanma |

> **Neden `asinCandidate` artık `null` dönüyor:** eski sürüm `/p/<slug>`
> değerini ASIN sayıyordu. `omega-3-fish-oil` → `OMEGA3FIS` gibi 10 karakterlik
> slug'lar `/^[A-Z0-9]{10}$/` kontrolünden geçip `products.asin` olarak
> yazılıyordu. Perakende sitesinin URL'si ASIN üretmez. Bu, kullanıcının
> SKU→Amazon→ASIN akışında **yanlış ürüne bağlanma** riski demekti.

## Fiyat geçmişi ve indirim tespiti

`scraped_products` her taramada yeni satır açmaz; GTIN bazlı mevcut kaydı
günceller. Kesintisiz seri olmadan "indirimi erken görmek" mümkün değildir.

| Alan | Anlam |
|---|---|
| `baseline_price` | Kesintisiz fiyat listesinde ilk gözlem; fiyat yükselirse yeni tepe olur |
| `baseline_at` | `baseline_price`ın alındığı an |
| `first_below_baseline_at` | Fiyatın tepe altına **ilk kez** indiği an — kupon alarmının tetikleyicisi |
| `last_price_change_at` | Son fiyat değişimi |

Tek taramada indirim yalnız `offers.highPrice` / `priceSpecification` gibi
gerçek bir liste fiyatı varsa raporlanır. JSON-LD `lowPrice` "en ucuz varyant"
olduğu için tek başına indirim sayılmaz — aksi halde her ürün %50 indirimli
görünürdü.

## Sınırlar

- **Koruma ne zaman aşılırsa aşılmaz.** Doğrusal/akış tabanlı korumalar
  kapsam dışıdır.
- **Coğrafya belirleyicidir.** TR/EU egress ile ABD perakende sitelerinde
  engelleme olasılığı yüksektir. Servis ABD'de çalışmalıdır.
- **Hız limitleri.** `/api/crawler/scrape` kullanıcı başına dakikada 5 istek,
  URL başına 6 saatlik önbellek uygular. Bu kotayı kasıtlı olarak düşüktür.
- `CRAWLER_ALLOWED_HOSTS` tanımlıysa yalnız o host'lar taranır.

## Yapılandırma

**Uygulama (`.env` / Vercel):**

```dotenv
# Boş bırakılırsa yalnız JS stealth çalışır (korumalı sitelerde başarısız).
SCRAPLING_SERVICE_URL=https://cerberus-scrapling.fly.dev
SCRAPLING_SERVICE_TOKEN=<en az 32 karakter, iki tarafta aynı>

# Boşsa tüm public host'lar crawl edilebilir. Üretimde daraltın.
CRAWLER_ALLOWED_HOSTS=vitaminshoppe.com,iherb.com
```

**Servis (`fly secrets set`):**

```dotenv
SCRAPLING_SERVICE_TOKEN=<aynı değer>
# ABD residential proxy — DataDome datacenter IP'sini (Fly dahil) eler.
SCRAPER_PROXY_URL=http://user:pass@gate.provider.com:7000
```

> **Sıralı gerçeklik:** gerçek Chromium **gerekli ama yeterli değil**.
> DataDome yalnız TLS parmak izine değil, IP'nin datacenter olmasına da bakar.
> Fly/Render/Hetzner IP'leri yayınlanmış listelerdedir. Üçüncü katman
> **ABD residential proxy**'dir. Bütçe buna ayrılmalı — indirim takibi
> işinizin temelidir, engellenmemek her şeyden ucuzdur.

## İlgili dosyalar

| Dosya | Rol |
|---|---|
| `src/lib/crawler/scraper.ts` | stealth fetch, koruma tespiti, GTIN/indirim ayrıştırma |
| `src/lib/crawler/scraper.test.ts` | GTIN kontrol hanesi testleri |
| `src/lib/crawler/crawlerBehavior.test.ts` | sahte ASIN + koruma tespiti regresyonları |
| `src/app/api/crawler/scrape/route.ts` | throttle, önbellek, fiyat geçmişi, audit |
| `src/app/api/crawler/import/route.ts` | GTIN/ASIN ile ürün eşleştirme, katalog yazımı |
| `services/scrapling/` | gerçek Chromium servisi → [servis README'si](./../services/scrapling/README.md) |
| `src/features/crawler/CrawlerPanel.tsx` | arayüz: indirim rozeti, GTIN, engel paneli |
