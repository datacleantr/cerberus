"""
Saf yardımcılar — HTTP/framework bağımsız.

Bu modül bilerek `fastapi`/`pydantic` içe aktarmaz. Amaç: GTIN kontrolü, sahte
ASIN tespiti, bot koruması tanıma ve ürün ayrıştırma mantığı framework
bağımlılığı olmadan test edilebilsin. `main.py` yalnız transport katmanıdır.

Bu davranışların JS karşılıkları `src/lib/crawler/scraper.ts` ile birebir
aynı olmalıdır; iki taraf ayrışırsa crawler sessizce farklı veri üretir.
"""
import json
import re
import urllib.parse

def extract_asin_candidate(url: str, html: str = ""):
    """Yalnız Amazon kaynaklı URL'den gerçek ASIN kabul et.

    ESKİ DAVRANIŞ: /p/<slug> değerini büyük harfe çevirip ASIN sayıyordu.
    "omega-3-fish-oil" -> "OMEGA3FIS" gibi 10 karakterlik slug'lar
    /^[A-Z0-9]{10}$/ kontrolünden geçip ürün kataloğunda ASIN olarak yazılıyordu.
    Perakende sitesinin URL'si ASIN üretmez.
    """
    amazon = re.search(
        r"amazon\.[a-z.]{2,12}/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})(?:[/?#]|$)",
        url, re.I)
    if amazon: return amazon.group(1).upper()
    m = re.search(r"(?:^|[/=])(B0[A-Z0-9]{8})(?=$|[/?#&])", url)
    if m: return m.group(1).upper()
    return None

def is_valid_gtin(raw) -> bool:
    """GTIN kontrol hanesi — yanlış UPC/EAN sessizce eşleşmesin diye elenir."""
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) not in (8, 12, 13, 14): return False
    body = digits[:-1]
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - (total % 10)) % 10 == int(digits[-1])

def pick_gtin(p: dict, html: str):
    """SKU metnine göre çok daha güvenilir eşleştirme anahtarı (UPC/EAN)."""
    for key in ("gtin13", "gtin12", "gtin14", "gtin", "gtin8", "upc", "ean", "isbn"):
        value = p.get(key)
        if isinstance(value, list): value = value[0] if value else None
        if value is not None and is_valid_gtin(value):
            return re.sub(r"\D", "", str(value))
    for key in ("gtin13", "gtin12", "gtin", "upc", "ean"):
        m = re.search(r'<[^>]+itemprop=["\']%s["\'][^>]*content=["\']([^"\']+)["\']' % key, html, re.I)
        if m and is_valid_gtin(m.group(1)):
            return re.sub(r"\D", "", m.group(1))
    m2 = re.search(r'<meta[^>]+itemprop=["\']upc["\'][^>]*>(\d{8,14})<', html, re.I)
    if m2 and is_valid_gtin(m2.group(1)): return m2.group(1)
    return None

def offer_list(offers):
    if not offers: return []
    if isinstance(offers, list): return offers
    if isinstance(offers, dict):
        if isinstance(offers.get("offers"), list): return offers["offers"]
        if isinstance(offers.get("aggregateOffer"), dict): return [offers["aggregateOffer"]]
        return [offers]
    return []

def to_price(value):
    if value is None: return None
    try:
        parsed = float(re.sub(r"[$,\s]", "", str(value)))
        return parsed if parsed == parsed else None
    except (TypeError, ValueError):
        return None

# JS katmanıyla birebir aynı imzalar. DataDome 403 + bu gövdeyi döner; eski
# sürüm yalnız Cloudflare kalıplarına baktığı için korumayı hiç görmüyordu.
BOT_CHALLENGE_SIGNATURES = [
    ("datadome", r"captcha-delivery\.com|x-datadome|\bvar dd\s*=|geo\.captcha-delivery", "DataDome"),
    ("cloudflare", r"cf-chl-|cf_chl_|__cf_chl|turnstile|checking if the site connection is secure|ddos protection by cloudflare|attention required|cdn-cgi/challenge", "Cloudflare"),
    ("perimeterx", r"px-captcha|_pxhd|perimeterx", "PerimeterX"),
    ("imperva", r"incapsula|_incap_|imperva", "Imperva"),
    ("akamai", r"akamaighosts|ak_bmsc", "Akamai"),
]

def detect_bot_challenge(html: str):
    head = html[:8000]
    for protection, pattern, label in BOT_CHALLENGE_SIGNATURES:
        if re.search(pattern, head, re.I):
            return protection, label
    return None, None

def decode_html(s: str) -> str:
    return s.replace("&amp;","&").replace("&quot;",'"').replace("&#39;","'").replace("&lt;","<").replace("&gt;",">").replace("&nbsp;"," ")

def extract_jsonld(html: str):
    results = []
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.I):
        raw = m.group(1).strip()
        try:
            parsed = json.loads(raw)
            arr = parsed if isinstance(parsed, list) else [parsed]
            for o in arr:
                if o.get("@type") in ("Product","ItemList") or isinstance(o.get("@graph"), list):
                    results.append(o)
                if isinstance(o.get("@graph"), list):
                    for g in o["@graph"]:
                        if isinstance(g, dict) and g.get("@type") == "Product":
                            results.append(g)
        except:
            pass
    return results

# JS ağırlıklı (SPA) mağazalar ürün verisi yüklenmeden önce bir uygulama
# iskeleti döndürür. Parser bu iskeletten rastgele sayıları ürün sanıyordu —
# gerçek gözlem: "MENA Splash Screen Used by Yotta", fiyat $1299. Sessizce
# yanlış ürün, ürün BULAMAMAKTAN daha kötüdür. JS katmanı
# (`src/lib/crawler/scraper.ts`) ile birebir aynı kurallar uygulanır.
NON_PRODUCT_PATTERNS = [
    r"splash\s*screen",
    r"loading\.?\.?\.?|yükleniyor",
    r"enable\s+javascript",
    r"\b(page not found|404|not found|access denied)\b",
    r"\b(cookie|consent|privacy) (policy|settings|notice)\b",
    r"^[\s\-_=.|]+$",
]
GENERIC_TITLE_PATTERN = r"^(https?://)?([a-z0-9-]+\.)+[a-z]{2,}/?$"

def is_plausible_product(item: dict) -> bool:
    title = (item.get("title") or "").strip()
    if len(title) < 4:
        return False
    if re.match(GENERIC_TITLE_PATTERN, title, re.I):
        return False
    for pattern in NON_PRODUCT_PATTERNS:
        if re.search(pattern, title, re.I):
            return False
    has_identity = bool(
        item.get("gtin")
        or (item.get("brand") or "").strip() not in ("", "BILINMIYOR")
        or item.get("sourceSku")
    )
    price = item.get("price")
    if price is None and not has_identity:
        return False
    # Takviye bağlamında beklenmeyen fiyat aralığı: genelde stok adedi veya
    # ürün numarası gibi yanlış alandan okunmuş sayılar.
    # İkincil savunma: yalnız kesin çöp fiyatlar elenir. Asıl koruma başlık
    # denetimidir — SPA iskeleti başlıktan yakalanır.
    if price is not None and (price < 0.5 or price > 2000):
        return False
    return True


def parse_generic(html: str, base_url: str, domain: str):
    items = []
    ld = extract_jsonld(html)
    for p in ld:
        if p.get("@type") == "Product":
            name = str(p.get("name") or p.get("title") or "").strip()
            if not name: continue
            brand = p.get("brand")
            if isinstance(brand, dict): brand = brand.get("name")
            brand = str(brand or domain.split(".")[0].upper())

            offers = offer_list(p.get("offers"))
            price = None
            list_price = None
            currency = "USD"
            avail = "UNKNOWN"
            for offer in offers:
                if not isinstance(offer, dict): continue
                raw_price = offer.get("price") if offer.get("price") is not None else offer.get("lowPrice")
                candidate = to_price(raw_price)
                if candidate is not None and (price is None or candidate < price):
                    price = candidate
                high = to_price(offer.get("highPrice"))
                if high is not None and (list_price is None or high > list_price):
                    list_price = high
                if offer.get("priceCurrency"): currency = offer["priceCurrency"]
                av = str(offer.get("availability") or "").lower()
                if "instock" in av or "in_stock" in av or "limitedavailability" in av: avail = "IN_STOCK"
                elif "outofstock" in av or "out_of_stock" in av or "soldout" in av or "backorder" in av: avail = "OUT_OF_STOCK"

            # Gerçek indirim: liste fiyatı biliniyorsa ve fark anlamlıysa.
            # Aksi halde her varyant "indirimli" görünürdü.
            is_discounted, discount_pct = False, None
            if price is not None and list_price is not None and list_price > price:
                pct = ((list_price - price) / list_price) * 100
                if pct >= 1:
                    is_discounted, discount_pct = True, round(pct)

            img = p.get("image")
            if isinstance(img, list): img = img[0] if img else None
            if isinstance(img, dict): img = img.get("url")
            prod_url = str(p.get("url") or base_url)
            sku = p.get("sku") or p.get("productID") or p.get("retailer_item_id")
            items.append({
                "sourceUrl": prod_url,
                "sourceDomain": domain,
                "title": decode_html(name)[:300],
                "brand": decode_html(str(brand))[:80],
                "price": price,
                "listPrice": list_price,
                "currency": currency,
                "imageUrl": str(img) if img else None,
                "availability": avail,
                "asinCandidate": extract_asin_candidate(prod_url),
                "sourceSku": str(sku)[:64] if sku else None,
                "gtin": pick_gtin(p, html),
                "mpn": str(p.get("mpn"))[:64] if p.get("mpn") else None,
                "isDiscounted": is_discounted,
                "discountPct": discount_pct,
            })
    if items: return items
    # OG fallback
    m = re.search(r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
    if not m:
        m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*og:title', html, re.I)
    og = decode_html(m.group(1)) if m else (re.search(r"<title[^>]*>([^<]+)</title>", html, re.I).group(1).strip() if re.search(r"<title[^>]*>([^<]+)</title>", html, re.I) else "")
    if og and len(og) > 5:
        price = None
        pm = re.search(r'["\']price["\']\s*:\s*["\']?\$?([\d.,]+)', html, re.I)
        if pm: price = to_price(pm.group(1))
        sku_m = re.search(r'"sku"\s*:\s*"([^"]+)"', html, re.I)
        items.append({
            "sourceUrl": base_url,
            "sourceDomain": domain,
            "title": decode_html(og)[:300],
            "brand": domain.split(".")[0].upper(),
            "price": price,
            "listPrice": None,
            "currency": "USD",
            "imageUrl": None,
            "availability": "UNKNOWN",
            "asinCandidate": extract_asin_candidate(base_url),
            "sourceSku": sku_m.group(1)[:64] if sku_m else None,
            "gtin": pick_gtin({}, html),
            "mpn": None,
            "isDiscounted": False,
            "discountPct": None,
        })
    return items

