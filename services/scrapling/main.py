"""
Scrapling mikro-servisi — JS crawler 403/bot challenge'da buraya düşer.

BU DOSYA YALNIZ TRANSPORT KATMANIDIR: FastAPI, token doğrulama, boyut sınırı
ve Scrapling/Playwright çağrısı. GTIN kontrolü, sahte ASIN tespiti, bot
koruması tanıma ve ürün ayrıştırma `parsing.py` içindedir — framework
bağımlılığı olmadan test edilir. Python'daki davranışların
`src/lib/crawler/scraper.ts` ile birebir aynı olması gerekir.

Deploy: Dockerfile ile Fly.io / Render / Railway (ABD bölgesi ZORUNLU).
Local: pip install -r requirements.txt && python main.py

POST /scrape  { "url": "https://..." }
→  { sourceUrl, sourceDomain, products, warnings, fetchedAt, isListingPage, engine, blockedBy }
"""
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl
import os
import urllib.parse
from datetime import datetime, timezone
from security import (
    OutboundSecurityError,
    require_service_token as enforce_service_token,
    validate_outbound_url as enforce_outbound_url,
)

app = FastAPI(title="Cerberus Scrapling Service", version="1.2.0")
MAX_HTML_BYTES = 3 * 1024 * 1024

class ScrapeReq(BaseModel):
    url: HttpUrl
    # Sunucuda ekran (XServer) yoktur; headed mod "Looks like you launched a
    # headed browser without having a XServer running" hatasıyla çöker.
    # Bu yüzden varsayılan HEADLESS'tR. Scrapling'in headed modda daha iyi
    # sonuç verdiği iddiası yalnız `xvfb-run` altında geçerlidir; bu imajda
    # xvfb kurulu değil, dolayısıyla headless tek doğru seçimdir.
    # İstek gövdesiyle override edilebilir ama pratikte gerekmez.
    headless: bool = True

def _proxy_url() -> str | None:
    """ABD kaynaklı proxy URL'si.

    NEDEN ZORUNLU: DataDome yalnız TLS parmak izine değil, IP'nin
    DATACENTER olmasına da bakar. Fly/Render/Hetzner gibi bulut IP'leri
    yayınlanmış listelerdedir; gerçek Chromium kullansanız bile yüksek
    engelleme olasılığı vardır. ABD RESIDENTIAL proxy bu eşiği belirgin
    biçimde düşürür.

    Proxy env'den okunur, istek gövdesinden DEĞİL: aksi halde kullanıcı
    başka bir proxy'yi (veya proxy'siz çalışmayı) enjekte edebilirdi.
    """
    raw = (os.environ.get("SCRAPER_PROXY_URL") or "").strip()
    if not raw:
        return None
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https", "socks5", "socks5h"):
        return None
    if not parsed.hostname:
        return None
    return raw

def extract_domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).hostname or "unknown"
    except:
        return "unknown"


def _headless_override() -> bool:
    """SCRAPING_HEADLESS=false ile headed moda geçilebilir (yalnız xvfb altında)."""
    raw = (os.environ.get("SCRAPING_HEADLESS") or "true").strip().lower()
    return raw not in ("false", "0", "no")


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



from parsing import (  # saf katman: framework'den bagimsiz, test edilebilir
    decode_html,
    detect_bot_challenge,
    extract_asin_candidate,
    extract_jsonld,
    is_plausible_product,
    is_valid_gtin,
    offer_list,
    parse_generic,
    pick_gtin,
    to_price,
)


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
        fetch_kwargs = {
            # İstek gövdesindeki değer env ile ezilebilir; sunucu ortamında
            # headed mod çalışmaz, bu yüzden env açıkça "false" demedikçe
            # headless zorlanır.
            "headless": _headless_override() if req.headless else False,
            "network_idle": True,
            "adaptive": True,
            "disable_resources": True,
            "timeout": 30_000,
            "page_setup": secure_page_setup,
        }
        # Scrapling 0.4.x'te proxy parametre adı sürüme göre değişebiliyor
        # (`proxy` / `proxy_url`). Bu yüzden tek seferde denemek yerine
        # imzaya göre seçiyoruz: yanlış parametre TypeError yerine sessizce
        # proxy'siz gidip korumaya çarpmasın.
        proxy = _proxy_url()
        if proxy:
            import inspect as _inspect
            accepted = set(_inspect.signature(StealthyFetcher.fetch).parameters)
            for candidate in ("proxy", "proxy_url", "proxies"):
                if candidate in accepted:
                    fetch_kwargs[candidate] = proxy
                    break
            else:
                raise HTTPException(
                    status_code=500,
                    detail="SCRAPER_PROXY_URL tanımlı ama bu Scrapling sürümü proxy parametresini desteklemiyor.",
                )

        page = StealthyFetcher.fetch(url, **fetch_kwargs)  # type: ignore

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

        # Gerçek Chromium çalıştı ve yine de engellendiysek bu, korumanın
        # IP/egress tarafında olduğu demektir (DataDome datacenter IP'lerini
        # coğrafya ile eler). Sessizce "ürün bulunamadı" demek yerce adıyla söyle.
        protection, label = detect_bot_challenge(html)
        if protection:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Gerçek tarayıcıyla da engellendi ({label}). Bu koruma IP/egress "
                    "tarafında: ABD kaynaklı (datacenter veya residential) proxy gerekiyor."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrapling hatası: {e}")

    products = parse_generic(html, url, domain)

    # Güvenilirlik süzgeci — SPA iskeleti / splash screen / hata sayfasından
    # gelen sahte kayıtları ele.
    before_filter = len(products)
    products = [p for p in products if is_plausible_product(p)]
    discarded = before_filter - len(products)

    if not products:
        raise HTTPException(
            status_code=422,
            detail=(
                "Sayfa yüklendi ama ürün verisi doğrulanamadı. Site muhtemelen "
                "JavaScript ile veri çekiyor veya hâlâ koruma katmanının arkasında."
            ),
        )

    warnings = []
    if discarded:
        warnings.append(f"{discarded} kayıt ürün olarak doğrulanamadı ve elendi (sayfa iskeleti veya splash screen).")
    missing_price = sum(1 for p in products if p["price"] is None)
    if missing_price:
        warnings.append(f"{missing_price} üründe fiyat bulunamadı.")

    with_gtin = sum(1 for p in products if p.get("gtin"))
    if with_gtin == 0:
        warnings.append(
            "GTIN/UPC bulunamadı. Amazon'daki karşılığı bulmak için ürün SAYFASINI "
            "(kategori listesi değil) tarayın."
        )
    elif with_gtin < len(products):
        warnings.append(f"{len(products) - with_gtin} üründe GTIN yok; Amazon eşleştirmesinde atlanacak.")

    discounted = sum(1 for p in products if p.get("isDiscounted"))
    if discounted:
        warnings.append(f"{discounted} ürün liste fiyatının altında — indirim fırsatı.")

    return {
        "sourceUrl": url,
        "sourceDomain": domain,
        "products": products[:30],
        "warnings": warnings,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "isListingPage": len(products) > 3,
        "engine": "scrapling-service",
        "blockedBy": None,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
