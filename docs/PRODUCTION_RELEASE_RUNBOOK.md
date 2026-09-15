# CERBERUS Üretim Yayını ve Geri Dönüş Runbook'u

**Tarih:** 14 Eylül 2026

## 1. Go / No-Go kapısı

Aşağıdakilerin tamamı kanıtlanmadan yayın yapılmaz:

- [ ] Onaylı staging `DATABASE_URL` üzerinde `npm run db:migrate` başarılı.
- [ ] `/api/health/ready` staging'de `200` ve tüm `checks` değerleri `true`.
- [ ] `npm ci`, lint, typecheck, test, OpenAPI lint, production audit ve build başarılı.
- [ ] En az bir ADMIN hesabıyla giriş doğrulandı; bootstrap parola değiştirildi.
- [ ] STORE_USER yabancı mağazanın sipariş, batch, crawler job ve mağaza metadata'sını göremiyor.
- [ ] Backup/PITR etkin ve son geri yükleme noktası doğrulandı.
- [ ] Release sahibi, DB sahibi ve geri dönüş kararı verecek kişi belirlendi.

## 2. Zorunlu environment

- `DATABASE_URL`: pooled PostgreSQL bağlantısı; TLS zorunlu.
- `SESSION_SECRET`: rastgele, en az 32 karakter; secret manager'da tutulur.
- `SEED_ADMIN_PASSWORD`, `SEED_STORE_PASSWORD`: yalnız ilk seed sırasında; rutin runtime secret'ı değildir.

Opsiyonel entegrasyonlar:

- `KEEPA_API_KEY`, `KEEPA_API_DOMAIN`
- `SCRAPLING_SERVICE_URL`, `SCRAPLING_SERVICE_TOKEN`
- `CRAWLER_ALLOWED_HOSTS`
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `LOG_LEVEL`

`SCRAPLING_SERVICE_URL` tanımlanıyorsa token da tanımlanmalı ve servis private network/platform rate limit'i arkasında olmalıdır.

## 3. Yayın öncesi komutlar

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run openapi:lint
npm audit --omit=dev --audit-level=high
DATABASE_URL="$STAGING_DATABASE_URL" \
SESSION_SECRET="$STAGING_SESSION_SECRET" \
npm run build
```

Python güvenlik kontrolleri CI tarafından çalıştırılır. Lokal eşdeğeri:

```bash
PYTHONPATH=services/scrapling python -m unittest discover \
  -s services/scrapling -p 'test_*.py' -v
python -m py_compile services/scrapling/main.py
```

## 4. Veritabanı yayın sırası

1. Sağlayıcı üzerinde backup/PITR zamanını kaydedin.
2. Uygulama yazma trafiği yüksekse kısa bakım penceresi açın.
3. Yeni uygulamayı trafiğe vermeden önce:

```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" npm run db:migrate
```

4. `drizzle.__drizzle_migrations` içinde beklenen kayıt sayısını ve head hash'ini readiness ile doğrulayın.
5. Yeni uygulama sürümünü deploy edin.
6. Readiness `200` olmadan instance'ı load balancer'a eklemeyin.

Son migration `0007_icy_payback`, `orders.credit_card` ve `stores.default_card` kolonlarındaki yanıltıcı `1753` varsayılanını kaldırır. Mevcut değerleri silmez ve eski uygulama binary'siyle şema uyumludur.

## 5. Yayın sonrası smoke testi

### Sistem

```text
GET /api/health       → 200
GET /api/health/ready → 200, bütün checks=true
```

### Kimlik ve roller

- Hatalı giriş aynı generic 401 mesajını döndürür.
- ADMIN kullanıcı/mağaza ekranlarını görür.
- MANAGER kullanıcı ve database-reset araçlarını görmez.
- STORE_USER `/admin` ekranına alınmaz ve API'de kendi mağazasına kilitlenir.
- Parola reset'inden sonra eski oturum API çağrısında 401 olur.

### Sipariş akışı

- Sipariş listesi 50 kayıtlık sayfalarla ilerler.
- Arama, mağaza, kargo ve batch filtrelerinde `pagination.total` ve KPI aynı filtreyi temsil eder.
- CSV export ekrandaki sayfayı değil filtrelenmiş tüm sonucu içerir.
- 10.000 üzeri export `422` döner.
- P1–P4 toplamı veya sevk miktarı sipariş adedini aşarsa kayıt reddedilir.
- Sipariş silme audit log üretir.

### Finans

Bilinen bir örnekte elle doğrulayın:

```text
effectiveCost = max(0, totalCost - supplierRefund)
profit        = revenue - effectiveCost
```

Refund satış gelirinden ikinci kez düşülmemelidir.

### Crawler

- Private/local URL reddedilir.
- İzin verilmeyen host reddedilir.
- Aynı store/URL cache hit üretir; farklı store cache'i paylaşmaz.
- Altıncı kullanıcı isteği bir dakikalık pencerede `429` döner.

## 6. Geri dönüş

### Uygulama hatası

1. Yeni deployment'a trafik vermeyi durdurun.
2. Önceki başarılı uygulama artifact'ına dönün.
3. `/api/health/ready` ve temel rol smoke testini tekrar çalıştırın.
4. Correlation ID ve deployment ID ile incident kaydı açın.

### Migration hatası

- Otomatik “down migration” çalıştırmayın.
- Uygulama rollback'inin yeni şemayla uyumluluğunu değerlendirin.
- `0007` yalnız default kaldırdığı için eski binary'ye dönüşte DB rollback gerekmez.
- Veri değiştiren gelecekteki migration'larda forward-fix tercih edilir; veri bozulması varsa bakım penceresinde doğrulanmış PITR noktasına dönülür.
- Restore öncesi mevcut bozuk DB'nin ayrıca snapshot'ını alın.

### Güvenlik olayı

- `SESSION_SECRET` sızdıysa rotate edin; tüm oturumlar geçersiz olur.
- Scrapling token sızdıysa hem Node hem Python servisinde birlikte rotate edin.
- Etkilenen kullanıcı parolasını resetleyin; auth-version doğrulaması eski JWT'yi geçersiz kılar.
- Audit ve sağlayıcı access loglarını saklama politikasına göre koruyun.

## 7. Bilinen sınırlar ve kabul edilmeyen varsayımlar

- Amazon SP-API bağlı değildir; UI planlanan özellik olarak göstermelidir.
- Döviz dönüşümü yoktur; farklı para birimlerini tek finans toplamında birleştirmeyin.
- Crawler, üçüncü taraf sitelerin kullanım koşulları ve robots/policy gereklilikleri değerlendirilmeden geniş allowlist ile açılmamalıdır.
- Python browser container smoke testi ayrı deploy ortamında yapılmalıdır.
- OpenAPI yapısal olarak geçerlidir; operationId ve bazı 4xx dokümantasyon uyarıları yayın engelleyici değildir ancak aşamalı kapatılmalıdır.
- Tam dependency audit'te yalnız development zinciri `drizzle-kit → @esbuild-kit → esbuild` kaynaklı moderate bildirimler kalabilir; production audit sıfır olmalıdır.

## 8. Yayın kaydı şablonu

```text
Release/commit:
Tarih/saat:
Yayın sahibi:
DB migration head:
Backup/PITR noktası:
Readiness sonucu:
Smoke test sonucu:
Bilinen istisnalar:
Rollback kararı ve sahibi:
```
