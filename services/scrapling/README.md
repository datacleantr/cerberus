# Scrapling Crawler Servisi

> DataDome / Cloudflare / Akamai korumalı siteler için gerçek Chromium (Playwright)
> üzerinden çekim. Node `fetch` bu korumaları **aşılamaz** — TLS parmak izi
> (JA3/JA4) ve JavaScript çalıştırma gerektirirler.

## Neden bu servis var

`src/lib/crawler/scraper.ts` saf HTTP isteği atar. Bu yaklaşım:
- Cloudflare, DataDome, Akamai, PerimeterX, Imperva korumalarını **geçemez**;
- kolay UA/başlık filtrelerini geçer, ama gerçek koruma değildir.

`robots.txt` ve `ToS` politikalarına uymak, hız limitlerine saygı göstermek ve
kendi kaynaklarınızı taramak koşullarıyla kullanın.

## VitaminShoppe özelinde

VitaminShoppe `DataDome` kullanıyor:

```
server: DataDome
x-datadome: protected
x-dd-b: 1
set-cookie: datadome=...; Domain=.vitaminshoppe.com
<body> Please enable JS and disable any ad blocker
<script src="https://ct.captcha-delivery.com/c.js">
```

Engel sayfası **403** ile döner (200 değil). Bu nedenle 403'e bakarken
`blockedBy` değerini okumak, kullanıcıya "URL'yi kontrol edin" demekten çok daha
doğru bir mesaj verir.

## Deploy

### Fly.io (önerilen)

```bash
fly launch --no-deploy --config services/scrapling/fly.toml
fly secrets set SCRAPLING_SERVICE_TOKEN="$(openssl rand -hex 32)"
fly deploy --config services/scrapling/fly.toml
fly secrets set --config services/scrapling/fly.toml CRAWLER_ALLOWED_HOSTS=vitaminshoppe.com
```

**Bölgeyi ABD'de tutun.** DataDome coğrafya bazlı eleme yapar; TR/EU
datacenter IP'leri ABD perakende sitelerinde çok daha yüksek engelleme
olasılığına sahiptir. `fly.toml` içindeki `primary_region = "ewr"` ayarını
değiştirmeyin.

### Docker (kendi sunucunuz)

```bash
docker build -t cerberus-scrapling -f services/scrapling/Dockerfile .
docker run -d --name cerberus-scrapling \
  -p 8000:8000 \
  -e SCRAPLING_SERVICE_TOKEN="$(openssl rand -hex 32)" \
  -e CRAWLER_ALLOWED_HOSTS=vitaminshoppe.com \
  cerberus-scrapling
```

## Vercel'e **kadar** konmayın

| Kısıt | Vercel | Fly.io |
|---|---|---|
| Sıkıştırılmamış boyut | 250 MB | sınırsız |
| Chromium (~450 MB) | ❌ sığmaz | ✅ |
| Dosya sistemi | salt-okunur (`/tmp` hariç) | kalıcı |
| Timeout | 10 sn (Hobby) / 60 sn (Pro) | 300+ sn |
| Süreçler arası ısınma | ❌ her soğuk başlar | ✅ |

## Uygulama env

`.env` veya Vercel'de:

```dotenv
SCRAPLING_SERVICE_URL=https://cerberus-scrapling.fly.dev
SCRAPLING_SERVICE_TOKEN=<fly secrets ile aynı 32+ karakterlik değer>
```

Token iki tarafta **birebir aynı** olmalı. `scraper.ts` token'ı 32 karakterden
kısa bulursa servisi hiç çağırmaz — bu yüzden "403 alıyorum" hatası token
eksikliği anlamına da gelebilir.

## Doğrulama

```bash
curl -s http://localhost:8000/health
# {"ok":true,"engine":"scrapling","version":"1.1.0"}

curl -X POST http://localhost:8000/scrape \
  -H 'Content-Type: application/json' \
  -H "X-Scrapling-Token: $SCRAPLING_SERVICE_TOKEN" \
  -d '{"url":"https://www.vitaminshoppe.com/p/..."}'
```

## Dosya düzeni

| Dosya | Sorumluluk |
|---|---|
| `parsing.py` | Saf mantık: GTIN kontrolü, sahte ASIN tespiti, bot koruması tanıma, ürün ayrıştırma. Framework bağımsız, test edilebilir. |
| `main.py` | Transport: FastAPI, token doğrulama, boyut sınırı, Playwright çağrısı. |
| `security.py` | SSRF politikası (DNS/IP/port/izin listesi). |

`parsing.py` ve `src/lib/crawler/scraper.ts` **aynı davranışı** üretmelidir.
İki taraf ayrışırsa crawler sessizce farklı veri üretir.

## Testler

```bash
cd services/scrapling && python3 -m unittest test_main -v
```

`parsing.py` framework'den ayrıldığı için pip kurulumu gerekmez; CI'da
`python` job'ı bu testleri çalıştırır.
