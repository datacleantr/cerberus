# CERBERUS — Mimari ve Veritabanı Sözleşmesi

**Durum:** Yaşayan mimari belgesi

**Güncelleme:** 2026-09-13

Bu belge sistem sınırlarını ve korunması gereken veri sözleşmelerini açıklar. Eski “v3.0 locked / yalnız 8 tablo / 26 mağaza” yaklaşımı kaldırılmıştır: uygulama ürün merkezli modele genişlemiştir. Runtime şema için tek teknik kaynak [`src/db/schema.ts`](./src/db/schema.ts), sürüm geçmişi için `drizzle/` migration'larıdır.

## 1. Sistem bağlamı

CERBERUS üç ana bağlamı birleştirir:

1. **Ürün zekâsı:** keşif, tedarikçi teklifi, veri kalitesi, risk ve karar.
2. **Satın alma/operasyon:** sipariş, PSH batch, depo karşılama, P1–P4 fire ve tedarikçi iadesi.
3. **Ölçüm:** gerçekleşen ROI, ürün P&L, analitik, araştırmacı performansı ve yönetici brifingi.

```text
Browser
  └─ Next.js UI + Route Handlers
       ├─ Auth/RBAC + store scope
       ├─ Domain calculations
       ├─ Drizzle ORM ── PostgreSQL
       ├─ Public supplier HTTP fetches
       ├─ Keepa API (optional)
       └─ Scrapling service (optional, shared-token protected)
```

Amazon SP-API mevcut değildir. Bu veri kaynağı bağlanana kadar “Amazon'a sevk/satış” alanları operasyonel kullanıcı girdisi veya import verisidir.

## 2. Veri modeli

### Kimlik ve organizasyon

- `users`: bcrypt credential, rol ve mağaza kapsamı.
- `stores`: mağaza kodu, marketplace ve operasyonel varsayılanlar.
- `researchers`, `research_sessions`: sourcing kadrosu ve araştırma oturumları.

### Ürün çekirdeği

- `products`: ASIN merkezli normalize ürün kimliği; siparişlerin zorunlu `product_id` hedefi.
- `supplier_offers`: zaman damgalı tedarikçi fiyat kanıtları.
- `product_lifecycle_events`: append-only ürün yaşam döngüsü olayları.
- `product_masters`: legacy karar kasası görünümü/işlevleri. Yeni ilişkisel çekirdek ile geçiş döneminde birlikte bulunur; sessizce silinmemelidir.

### Operasyon

- `orders`: 40 kaynak kolonunu koruyan sipariş kaydı, ayrıca `product_id`, PSH ve Inventory Lab alanları.
- `psh_batches`: mağaza kapsamlı ön-envanter/sevkiyat partileri.
- `audit_logs`: kritik create/update/delete ve yönetim işlemlerinin denetim izi.
- `app_settings`: ROI eşikleri gibi yönetilebilir uygulama ayarları.
- crawler tabloları: scrape işi, gözlem ve cache/rate-limit kanıtları.

Şema genişletmeleri migration ile yapılır. Kaynak XLS kolonlarının anlamı geriye dönük uyum gözetilmeden değiştirilemez; yeni anlam gerekiyorsa migration, backfill ve doküman güncellemesi gerekir.

## 3. Finansal ve operasyonel invariant'lar

- `quantity >= 1`.
- `shippedToAmazon <= quantity`.
- `P1 + P2 + P3 + P4 <= quantity`.
- Bundle ürününde `countPerBundle` zorunludur.
- Sipariş store'u, referans verilen PSH batch store'u ile aynı olmalıdır.
- Bir sipariş aynı anda yalnız bir batch'e atanabilir.
- Sipariş ürün ilişkisi zorunludur; ASIN normalize edilerek `products` kaydına çözülür.
- `refundAmount`, **tedarikçinin ödeme kartına yaptığı maliyet iadesidir**:

```text
effectiveCost = max(0, totalCost - supplierRefund)
sellableUnits = max(0, quantity - P1 - P2 - P3 - P4)
revenue       = sellingPrice × sellableUnits
profit        = revenue - effectiveCost
ROI           = effectiveCost > 0 ? profit / effectiveCost × 100 : tanımsız
```

Döviz dönüşümü yapılmamaktadır. Farklı para birimleri tek toplama dahil edilecekse önce FX veri modeli eklenmelidir.

## 4. Yetkilendirme ve veri minimizasyonu

- `ADMIN`: tüm mağazalar ve kullanıcı yönetimi.
- `MANAGER`: mağazalar arası operasyonel yetki; kullanıcı yönetimi yok.
- `STORE_USER`: yalnız atanmış `storeCode`.

Kurallar hem liste hem kayıt-mutasyonu uçlarında uygulanır. İstemci `storeCode=ALL` göndererek mağaza kapsamını yükseltemez. Hassas kart/e-posta alanları API ve CSV export'ta rol bazında maskelenir. Kullanıcı dizini ve audit kayıtları ihtiyaç dışı rollere sipariş payload'ı içinde verilmez.

JWT, imza ve süre kontrolüne ek olarak her API isteğinde canlı kullanıcı kaydıyla doğrulanır. Kullanıcı silme, rol/mağaza değişikliği ve parola reset'i eski oturum yetkisini derhal etkiler.

## 5. Sipariş sorgu sözleşmesi

`GET /api/orders`:

- varsayılan 50, en fazla 200 kayıtlık server pagination;
- güvenli çok-alanlı server-side arama;
- store/cargo/batch filtreleri;
- KPI'ları yalnız mevcut sayfadan değil, filtrelenmiş tüm kümeden SQL ile üretme;
- `pagination: { page, pageSize, total, totalPages }` metadata'sı.

`GET /api/orders/export`, aynı filtrelerin tüm sonucunu 250 satırlık chunk'larla CSV stream eder. Güvenlik üst sınırı 10.000 satırdır; daha büyük sonuç `422` ile reddedilir.

## 6. Import ve fixture sözleşmesi

- XLS/XLSX/CSV import'u kullanıcı önizlemesi ve server doğrulaması içerir.
- Google Drive indirmesi yalnız izinli Drive URL'lerini ve 20 MB stream sınırını kabul eder.
- Import transaction'ı ürün çözümleme + sipariş insert işlemlerini atomik yapmalıdır.
- Depodaki fixture 24 sipariş ve 4 başlangıç mağazasıdır; müşteri/canlı veri olarak adlandırılmaz.
- Database reset araçları production'da 404'tür; development'ta ADMIN + açık onay gerektirir ve FK sıralı transaction kullanır.

## 7. Dış ağ güvenliği

Crawler hedefleri için:

- yalnız HTTP/HTTPS ve 80/443;
- credential, localhost/internal adları ve non-global IP'ler yasak;
- DNS ve URL politikası her redirect hop'unda tekrar uygulanır;
- HTML 3 MB ile sınırlıdır;
- kullanıcı başına DB tabanlı dakika limiti vardır;
- cache mağaza kapsamlıdır.

Python servis ayrıca en az 32 karakterlik `SCRAPLING_SERVICE_TOKEN` ister. Production'da private network/egress policy ve platform rate limit'i uygulama katmanına eklenmelidir.

## 8. Migration ve yayın sözleşmesi

1. Şema değişikliği `src/db/schema.ts` içinde yapılır.
2. `npm run db:generate` ile SQL ve journal üretilir.
3. SQL inceleme/backfill ve rollback planı PR'da değerlendirilir.
4. `src/db/migrationManifest.ts` yeni head sayısı/hash'iyle güncellenir; test drift'i yakalar.
5. Migration uygulama deploy'undan önce ayrı release adımında çalışır.
6. `/api/health/ready`, migration count + head hash, session secret, başlangıç kayıtları ve order-product bütünlüğünü doğrular.

`db:push` üretim yayın mekanizması değildir.

## 9. Değişiklik kontrol listesi

- [ ] Store-scope ve rol etkisi incelendi.
- [ ] Finansal semantik tek domain fonksiyonunda güncellendi.
- [ ] Input sınırı, content type ve hata statüsü tanımlandı.
- [ ] Kritik mutasyon audit olayı üretiyor.
- [ ] Migration + manifest + backfill/rollback planı mevcut.
- [ ] Test, typecheck, lint, audit ve production build geçti.
- [ ] README/OpenAPI ve kullanıcı metinleri davranışla uyumlu.
