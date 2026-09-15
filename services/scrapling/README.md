# Scrapling Mikro-Servisi

`src/lib/crawler/scraper.ts` tek başına çalışır (stealth JS). Bu Python servisi **opsiyoneldir** — yalnız anti-bot engelin aşılamadığı durumlarda devreye girer.

## Güvenlik sözleşmesi

- `/scrape` yalnız `X-Scrapling-Token` başlığıyla çağrılabilir. `SCRAPLING_SERVICE_TOKEN` iki serviste de aynı, rastgele ve en az 32 karakter olmalıdır.
- Yalnız HTTP/HTTPS ve 80/443 kabul edilir; credential içeren URL'ler, local/internal hostlar ve private/reserved IP sonuçları reddedilir.
- `CRAWLER_ALLOWED_HOSTS` tanımlıysa ana navigasyon ve her redirect hop'u bu allowlist'e uymalıdır.
- Browser alt istekleri de public IP politikasından geçer. HTML çıktısı en fazla 3 MB'dir.
- Servisi yine de public internete doğrudan açmak yerine private network ve platform rate limit'i arkasında çalıştırın.

## Neden ayrı servis?

- Scrapling browser otomasyonu ile bot/JS challenge durumlarında ikinci çekim motoru sağlar.
- Vercel Node runtime Python çalıştıramaz; servis Render / Fly / Railway / Docker üzerinde ayrı deploy edilir.
- `SCRAPLING_SERVICE_URL` ve geçerli token yoksa JS crawler çalışmaya devam eder.

## Deploy

```bash
export SCRAPLING_SERVICE_TOKEN="$(openssl rand -hex 32)"
docker build -t cerberus-scrapling ./services/scrapling
docker run --rm -p 8000:8000 \
  -e SCRAPLING_SERVICE_TOKEN="$SCRAPLING_SERVICE_TOKEN" \
  -e CRAWLER_ALLOWED_HOSTS="vitaminshoppe.com" \
  cerberus-scrapling

curl http://localhost:8000/health
curl -X POST http://localhost:8000/scrape \
  -H 'Content-Type: application/json' \
  -H "X-Scrapling-Token: $SCRAPLING_SERVICE_TOKEN" \
  -d '{"url":"https://www.vitaminshoppe.com/p/..."}'
```

Node uygulamasında iki değişkeni birlikte tanımlayın:

```bash
SCRAPLING_SERVICE_URL=http://localhost:8000 \
SCRAPLING_SERVICE_TOKEN="$SCRAPLING_SERVICE_TOKEN" \
npm run dev
```

Üretimde `SCRAPLING_SERVICE_URL` HTTPS olmalıdır.
