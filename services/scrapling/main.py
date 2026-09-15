"""
Scrapling mikro-servisi — JS crawler 403/bot challenge'da buraya düşer.

Deploy: Dockerfile ile Render / Fly / Railway / Vercel Python Function.
Local: pip install -r requirements.txt && python main.py

POST /scrape  { "url": "https://..." }
→  { sourceUrl, sourceDomain, products: [{title, brand, price, ...}], warnings, fetchedAt, isListingPage, engine }

Scrapling dokümantasyonu: https://github.com/D4Vinci/Scrapling
StealthyFetcher + adaptif parser — JS katmanıyla birebir aynı ürün şemasını döner.
"""
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl
import re, json, urllib.parse
from datetime import datetime, timezone
from security import (
    OutboundSecurityError,
    require_service_token as enforce_service_token,
    validate_outbound_url as enforce_outbound_url,
)

app = FastAPI(title="Cerberus Scrapling Service", version="1.1.0")
MAX_HTML_BYTES = 3 * 1024 * 1024

class ScrapeReq(BaseModel):
    url: HttpUrl
    # opsiyonel: proxy, headless vs. genişletilebilir
    headless: bool = False

def extract_domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).hostname or "unknown"
    except:
        return "unknown"


def validate_outbound_url(url: str, enforce_allowlist: bool = True) -> None:
    """Map dependency-free security policy failures to FastAPI responses."""
    try:
        enforce_outbound_url(url, enforce_allowlist)
    except OutboundSecurityError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


def require_service_token(provided: str | None) -> None:
    try:
        enforce_service_token(provided)
    except OutboundSecurityError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


def extract_asin_candidate(url: str, html: str):
    m = re.search(r"/p/([^/?#]+)", url, re.I)
    if m: return m.group(1)[:32].upper()
    m = re.search(r"\b(B0[A-Z0-9]{8})\b", url, re.I)
    if m: return m.group(1).upper()
    m = re.search(r"\b(VS-\d+|VS\d+)\b", html, re.I)
    if m: return m.group(1).upper()
    return None

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
            offers = p.get("offers") or {}
            price = None
            currency = "USD"
            avail = "UNKNOWN"
            if isinstance(offers, dict):
                if offers.get("price") is not None:
                    try: price = float(str(offers["price"]).replace(",",""))
                    except: pass
                currency = offers.get("priceCurrency") or "USD"
                av = str(offers.get("availability") or "").lower()
                if "instock" in av: avail = "IN_STOCK"
                elif "outofstock" in av: avail = "OUT_OF_STOCK"
            img = p.get("image")
            if isinstance(img, list): img = img[0] if img else None
            prod_url = str(p.get("url") or base_url)
            items.append({
                "sourceUrl": prod_url,
                "sourceDomain": domain,
                "title": decode_html(name)[:300],
                "brand": decode_html(str(brand))[:80],
                "price": price if isinstance(price,(int,float)) and price==price else None,
                "currency": currency,
                "imageUrl": str(img) if img else None,
                "availability": avail,
                "asinCandidate": extract_asin_candidate(prod_url, html),
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
        if pm:
            try: price = float(pm.group(1).replace(",",""))
            except: pass
        items.append({
            "sourceUrl": base_url,
            "sourceDomain": domain,
            "title": decode_html(og)[:300],
            "brand": domain.split(".")[0].upper(),
            "price": price,
            "currency": "USD",
            "imageUrl": None,
            "availability": "UNKNOWN",
            "asinCandidate": extract_asin_candidate(base_url, html),
        })
    return items

@app.get("/health")
def health():
    return {"ok": True, "engine": "scrapling", "version": "1.1.0"}

@app.post("/scrape")
def scrape(req: ScrapeReq, x_scrapling_token: str | None = Header(default=None)):
    require_service_token(x_scrapling_token)
    url = str(req.url)
    validate_outbound_url(url)
    domain = extract_domain(url).replace("www.","")
    # --- Scrapling çekimi ---
    try:
        from scrapling.fetchers import StealthyFetcher  # type: ignore

        oversized_document = {"detected": False}

        def secure_page_setup(browser_page):
            # Playwright bu route'u ilk navigasyondan önce kurar. Böylece ana
            # isteğin yanı sıra her redirect ve alt kaynak URL'si DNS/IP
            # politikasından geçer. Allowlist yalnız navigasyon hedeflerine
            # uygulanır; güvenli public CDN alt kaynakları çalışmaya devam eder.
            def secure_route(route):
                request = route.request
                try:
                    validate_outbound_url(
                        request.url,
                        enforce_allowlist=request.is_navigation_request(),
                    )
                    route.continue_()
                except HTTPException:
                    route.abort("blockedbyclient")

            def inspect_response(response):
                try:
                    if response.request.resource_type != "document":
                        return
                    content_length = int(response.headers.get("content-length", "0"))
                    if content_length > MAX_HTML_BYTES:
                        oversized_document["detected"] = True
                except (TypeError, ValueError):
                    return

            browser_page.route("**/*", secure_route)
            browser_page.on("response", inspect_response)

        # v0.4.15 API'si `fetch` kullanır. page_setup navigasyondan önce çalışır.
        page = StealthyFetcher.fetch(
            url,
            headless=req.headless,
            network_idle=True,
            adaptive=True,
            disable_resources=True,
            timeout=30_000,
            page_setup=secure_page_setup,
        )  # type: ignore

        final_url = str(getattr(page, "url", "") or url)
        validate_outbound_url(final_url)
        url = final_url
        domain = extract_domain(final_url).replace("www.", "")
        if oversized_document["detected"]:
            raise HTTPException(status_code=413, detail="HTML yanıtı 3 MB sınırını aşıyor.")

        # Scrapling page.html_content / page.html olarak döner — versiyona göre değişir
        html = getattr(page, "html_content", None) or getattr(page, "html", None) or getattr(page, "text", "")
        if callable(html): html = html()
        if not html or len(str(html)) < 500:
            raise HTTPException(status_code=422, detail="Sayfa boş veya engellendi (Scrapling).")
        html = str(html)
        if len(html.encode("utf-8")) > MAX_HTML_BYTES:
            raise HTTPException(status_code=413, detail="HTML yanıtı 3 MB sınırını aşıyor.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrapling hatası: {e}")

    products = parse_generic(html, url, domain)
    if not products:
        raise HTTPException(status_code=422, detail="Bu sayfadan ürün bilgisi çıkarılamadı.")

    warnings = []
    if any(p["price"] is None for p in products):
        warnings.append(f"{sum(1 for p in products if p['price'] is None)} üründe fiyat bulunamadı.")

    return {
        "sourceUrl": url,
        "sourceDomain": domain,
        "products": products[:30],
        "warnings": warnings,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "isListingPage": len(products) > 3,
        "engine": "scrapling-service",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
