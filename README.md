# CERBERUS Commerce OS

CERBERUS; çok mağazalı satın alma, ürün araştırma, sipariş/PSH operasyonu, gerçekleşen kârlılık ve karar desteğini aynı uygulamada yöneten bir Next.js + PostgreSQL sistemidir.

> **Entegrasyon durumu:** Amazon SP-API bağlı değildir. Keepa yalnız `KEEPA_API_KEY` tanımlandığında gerçek API'yi kullanır. Python Scrapling servisi opsiyoneldir. UI bu bağlantıları bağlıymış gibi göstermemelidir.

## İş akışı

```text
DISCOVER → NORMALIZE → ANALYZE → DECIDE → BUY → RECEIVE → LIST → SELL → RECONCILE → LEARN
```

Başlıca modüller:

- ürün zekâsı, karar kuyruğu ve kanıt zinciri;
- mağaza kapsamlı sipariş arama, filtreleme, sayfalama ve CSV dışa aktarma;
- XLS/XLSX/CSV önizleme ve kontrollü içe aktarma;
- PSH batch oluşturma, depo sayımı ve P1–P4 fire takibi;
- gerçekleşen ROI, operasyon analitiği ve yönetici brifingi;
- mağaza, kullanıcı ve ayar yönetimi;
- audit log, readiness/liveness ve veri saklama araçları.

Finansal sözleşme: `refundAmount`, tedarikçinin ödeme kartına yaptığı geri ödemedir. Bu nedenle satış gelirini düşürmez; etkin maliyet `max(0, totalCost - supplierRefund)` olarak hesaplanır.

## Teknik mimari

- **Web/API:** Next.js 16 App Router, React 19, TypeScript
- **Veri:** PostgreSQL, Drizzle ORM ve versiyonlu SQL migration'ları
- **Doğrulama:** Zod tabanlı, byte sınırı olan JSON parser
- **Kimlik:** bcrypt parola + imzalı HttpOnly JWT; rol/parola değişiklikleri canlı DB doğrulamasıyla mevcut oturumlara hemen uygulanır
- **Test:** Vitest ve PGlite
- **Gözlemlenebilirlik:** yapılandırılmış log, `/api/health`, `/api/health/ready`

Temel veri varlıkları `users`, `stores`, `products`, `product_masters`, `supplier_offers`, `product_lifecycle_events`, `researchers`, `research_sessions`, `orders`, `psh_batches`, `audit_logs`, `app_settings` ve crawler tablolarıdır. Şema için tek kaynak [`src/db/schema.ts`](./src/db/schema.ts), değişim geçmişi için `drizzle/` klasörüdür. Eski “kilitli 8 tablo” dokümanları güncel runtime sözleşmesi değildir.

## Roller ve mağaza izolasyonu

| Rol | Kapsam |
|---|---|
| `ADMIN` | Kullanıcı yönetimi dahil tüm mağazalar ve yönetim işlemleri |
| `MANAGER` | Operasyonel yönetim; kullanıcı yönetimi ve legacy generic silme yetkisi yok |
| `STORE_USER` | Yalnız kendi `storeCode` kapsamındaki operasyon verisi |

Mağaza kapsamı yalnız UI filtresine bırakılmaz; API guard'ları istemciden gelen yabancı `storeCode` değerini mağaza kullanıcısının oturum kapsamına kilitler. Kart ve e-posta gibi alanlar rol bazında maskelenir.

## Yerel kurulum

Gereksinimler: Node.js 22 ve PostgreSQL.

```bash
npm ci
cp .env.example .env.local
```

En az şu değerleri tanımlayın:

```dotenv
DATABASE_URL=postgresql://...
SESSION_SECRET=en-az-32-karakter-rastgele-bir-deger
SEED_ADMIN_PASSWORD=en-az-12-karakter
SEED_STORE_PASSWORD=en-az-12-karakter
```

Ardından:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Geliştirme sunucusu varsayılan olarak `http://localhost:3000` üzerinde açılır. Yayınlanmış demo parolaları iptal edilmiştir; seed parolaları yalnız environment üzerinden alınır. Üretimde parola env'i yoksa varsayılan hesap oluşturulmaz.

### Fixture gerçeği

Depodaki geliştirme fixture'ı **24 sipariş** ve **4 başlangıç mağazası** içerir. Fixture canlı/müşteri verisi değildir. `/api/admin/database-reset` yalnız production dışı ortamda, `ADMIN` rolü ve `RESET-CERBERUS` onayıyla çalışır.

## İçe ve dışa aktarma

- Tarayıcı `.xlsx`, `.xls` ve `.csv` dosyalarını önizler; server write yolu satırları tekrar doğrular.
- Google Drive indirmeleri izinli URL politikası ve 20 MB gerçek stream sınırı kullanır.
- Sipariş CSV export'u aktif server filtrelerinin tüm sonucunu chunk'lar hâlinde üretir; 10.000 kaydı aşan sonuç sessizce kesilmez, `422` döner.
- Store kullanıcılarında hassas alanlar export sırasında da maskelenir.

### XLSX bağımlılık kaynağı

npm registry'deki tarihsel `xlsx` paketi yerine API uyumlu `@e965/xlsx@0.20.3`, yeniden üretilebilir kurulum için [`vendor/e965-xlsx-0.20.3.tgz`](./vendor/e965-xlsx-0.20.3.tgz) olarak vendored edilmiştir.

- SHA-256: `f93cd23533d5356f34d4b24ea48431f8cf8945d1ae1bd2045ab5d92163c82bb2`
- Kaynak bir **üçüncü taraf yeniden paketlemesidir**; SheetJS'in resmî dağıtımı değildir.
- Paket yükseltmesinde kaynak, lisans, checksum, runtime API testi ve `npm audit` yeniden doğrulanmalıdır.

## Crawler

Node crawler her redirect hop'unda URL/DNS/IP kontrolü yapar ve HTML'i 3 MB ile sınırlar. İsteğe bağlı Python browser servisi anti-bot fallback'i sağlar.

```dotenv
SCRAPLING_SERVICE_URL=https://crawler.example.internal
SCRAPLING_SERVICE_TOKEN=en-az-32-karakter-ortak-sir
CRAWLER_ALLOWED_HOSTS=vitaminshoppe.com,example-supplier.com
```

Python servisi için [`services/scrapling/README.md`](./services/scrapling/README.md) dosyasına bakın. Mikro-servisi yalnız shared-token'a güvenerek açık internete koymayın; private network ve platform rate limit'i de kullanın.

## Kalite kapısı

```bash
npm run lint
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ci_placeholder \
SESSION_SECRET=ci-only-build-secret-min-32-characters!! \
npm run build
python3 -m py_compile services/scrapling/main.py
```

Migration manifest testi, readiness'in beklediği migration sayısı ve son SQL SHA-256 değerinin Drizzle journal ile uyumunu denetler.

## Üretime alma

1. Managed PostgreSQL'i ve gerekli environment değerlerini hazırlayın.
2. Uygulama sürümü deploy edilmeden önce veya ayrı release job'ında `npm run db:migrate` çalıştırın.
3. İlk kurulumsa güçlü bootstrap parolalarıyla `npm run db:seed` çalıştırın; sonrasında seed'i rutin deploy adımı yapmayın.
4. Uygulamayı deploy edin.
5. `/api/health` liveness ve `/api/health/ready` readiness uçlarını platform probe'larına bağlayın.
6. Readiness'in `200` döndüğünü; migration head, session secret, başlangıç kullanıcı/mağaza kayıtları ve order-product bütünlüğü kontrollerini geçtiğini doğrulayın.
7. Backup/PITR, alarm, log saklama ve geri dönüş prosedürünü sağlayıcı tarafında etkinleştirin.

`db:push` yalnız lokal geliştirme/tek seferlik kontrollü eşitleme içindir; üretim değişiklikleri commit edilmiş migration ile yapılır.

## API ve ek dokümanlar

- OpenAPI: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Mimari yönlendirme: [`ARCHITECTURE_AND_DATABASE_SPEC.md`](./ARCHITECTURE_AND_DATABASE_SPEC.md)
- Operasyon/audit notları: [`docs/audit/`](./docs/audit/)

OpenAPI dosyası çekirdek dış API sözleşmesini belgeler; Next.js route implementasyonu ve Zod şemaları davranış için nihai kaynaktır.
