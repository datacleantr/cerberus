/**
 * CERBERUS — Ürün Çözümleyici (Product Resolver)
 *
 * AŞAMA 1.2: Sipariş yazan HER yol bu fonksiyondan geçer.
 *
 * Neden merkezî?
 * `orders.product_id` NOT NULL yapılacak. Bunun güvenli olması için ürün
 * bağlamanın tek bir yerden, tutarlı biçimde yapılması gerekir. Beş ayrı
 * yazma yolu (import-xls, import-drive-url, manuel sipariş, seed,
 * database-reset) kendi mantığını yazarsa er ya da geç biri unutulur ve
 * NOT NULL kısıtı üretimde patlar.
 *
 * Davranış: "get-or-create". ASIN varsa mevcut ürün döner, yoksa yaratılır.
 * Her iki durumda da fiyat gözlemi (`supplier_offers`) kaydedilir — çünkü
 * her sipariş aynı zamanda o anki tedarikçi fiyatının bir gözlemidir.
 */
import { eq, sql } from "drizzle-orm";
import { products, supplierOffers, productLifecycleEvents } from "./schema";
import { extractDomain } from "@/domain/productBackfill";

export interface ResolveProductInput {
  asin: string;
  productTitle?: string | null;
  brandName?: string | null;
  imageUrl?: string | null;
  amazonUrl?: string | null;
  upc?: string | null;
  packCount?: number | null;
  isFragile?: string | boolean | null;
  isMultiPack?: string | boolean | null;
  isBundle?: string | boolean | null;
  countPerBundle?: number | null;

  /** Fiyat gözlemi için — sipariş aynı zamanda bir fiyat kanıtıdır */
  supplierName?: string | null;
  supplierCode?: string | null;
  supplierUrl?: string | null;
  unitCost?: string | number | null;
  observedAt?: Date | string | null;
  sourceType?: "XLS_IMPORT" | "MANUAL" | "SCRAPER" | "API" | "MIGRATION";
}

export interface ResolveProductResult {
  productId: number;
  created: boolean;
  offerRecorded: boolean;
}

const truthy = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  return String(v ?? "").trim().toUpperCase() === "YES";
};

/**
 * ASIN normalizasyonu — tek yerde.
 * Büyük harf + kırpma. Bu normalizasyon `products.asin` unique kısıtının
 * doğru çalışması için kritik: " b0abc " ile "B0ABC" aynı ürün olmalı.
 */
export function normalizeAsin(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * Ürünü bulur ya da yaratır; fiyat gözlemini kaydeder.
 *
 * @param tx Drizzle db veya transaction — çağıran katman kendi
 *           transaction'ını yönetir, böylece kısmi yazma olmaz.
 */
export async function resolveProduct(
  tx: any,
  input: ResolveProductInput
): Promise<ResolveProductResult> {
  const asin = normalizeAsin(input.asin);

  if (!asin) {
    // ASIN olmadan ürün kimliği kurulamaz. Sessizce "bilinmeyen ürün"
    // yaratmak katalogu çöple doldurur; çağıran katman bunu ele almalı.
    throw new Error(
      "Ürün çözümlenemedi: ASIN boş. Sipariş bir ürüne bağlanmadan kaydedilemez."
    );
  }

  const [existing] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.asin, asin))
    .limit(1);

  let productId: number;
  let created = false;

  if (existing) {
    productId = existing.id;
  } else {
    const title = String(input.productTitle ?? "").trim() || `Ürün ${asin}`;
    const brand = String(input.brandName ?? "").trim().toUpperCase() || "GENERAL";

    const [inserted] = await tx
      .insert(products)
      .values({
        asin,
        upc: input.upc ?? null,
        title,
        brand,
        category: "UNCATEGORIZED",
        imageUrl: input.imageUrl ?? null,
        amazonUrl: input.amazonUrl ?? `https://www.amazon.com/dp/${asin}`,
        isFragile: truthy(input.isFragile),
        isMultiPack: truthy(input.isMultiPack),
        isBundle: truthy(input.isBundle),
        countPerBundle: input.countPerBundle ?? null,
        packCount: Math.max(1, Number(input.packCount) || 1),
        // Yeni ürün satın alma yoluyla geliyorsa yolculuğun bu durağındadır
        lifecycleStage: "PURCHASING",
      })
      // Yarış durumu koruması: iki eşzamanlı import aynı ASIN'i yazarsa
      // ikincisi çakışmaz, mevcut kaydı döndürür.
      .onConflictDoUpdate({
        target: products.asin,
        set: { updatedAt: new Date() },
      })
      .returning({ id: products.id });

    productId = inserted.id;
    created = true;

    await tx.insert(productLifecycleEvents).values({
      productId,
      fromStage: null,
      toStage: "PURCHASING",
      actorName: "SYSTEM",
      reason: "Sipariş kaydı sırasında katalogda oluşturuldu",
      contextSnapshot: { asin, sourceType: input.sourceType ?? "MANUAL" },
    });
  }

  // --- Fiyat gözlemi ---
  // Her sipariş, o anki tedarikçi fiyatının bir kanıtıdır. Bu olmadan
  // fiyat trendi (B-02) beslenmez ve arbitraj sinyali üretilemez.
  let offerRecorded = false;
  const price = Number(String(input.unitCost ?? "").replace(",", "."));

  if (Number.isFinite(price) && price >= 0 && input.unitCost != null) {
    let observedAt = input.observedAt
      ? input.observedAt instanceof Date
        ? input.observedAt
        : new Date(input.observedAt)
      : new Date();

    // Kaynak veri bozuksa (ör. Excel serial sayısı yanlışlıkla "yıl 44281" gibi
    // yorumlanırsa) Postgres timestamp'i patlatmadan makul bir tarihe düş.
    const OBSERVED_AT_MIN_YEAR = 2000;
    const observedAtYear = observedAt.getUTCFullYear();
    if (
      Number.isNaN(observedAt.getTime()) ||
      observedAtYear < OBSERVED_AT_MIN_YEAR ||
      observedAtYear > new Date().getUTCFullYear() + 1
    ) {
      observedAt = new Date();
    }

    if (!Number.isNaN(observedAt.getTime())) {
      const supplierName = String(input.supplierName ?? "").trim() || "BİLİNMEYEN";
      const unitPrice = price.toFixed(2);

      // Aynı gün + tedarikçi + fiyat üçlüsü tek gözlemdir; toplu import
      // aynı fiyatı 5 kez yazmamalı.
      const [dup] = await tx
        .select({ id: supplierOffers.id })
        .from(supplierOffers)
        .where(
          sql`${supplierOffers.productId} = ${productId}
              and ${supplierOffers.supplierName} = ${supplierName}
              and ${supplierOffers.unitPrice} = ${unitPrice}
              and date(${supplierOffers.observedAt}) = date(${observedAt})`
        )
        .limit(1);

      if (!dup) {
        await tx.insert(supplierOffers).values({
          productId,
          supplierName,
          supplierCode: input.supplierCode ?? null,
          sourceUrl: input.supplierUrl ?? null,
          sourceDomain: extractDomain(input.supplierUrl),
          unitPrice,
          observedAt,
          sourceType: input.sourceType ?? "MANUAL",
        });
        offerRecorded = true;
      }
    }
  }

  return { productId, created, offerRecorded };
}

/**
 * Toplu fixture/seed yükleme yardımcısı.
 *
 * `ALL_38_XLS_ORDERS` gibi ham satır dizilerini ürünlere bağlayarak yazar.
 * Seed ve database-reset yolları bunu kullanır; böylece bu yollar da
 * NOT NULL kısıtını karşılar ve katalog tutarlı kalır.
 */
export async function insertOrdersWithProducts(
  tx: any,
  ordersTable: any,
  rows: Array<Record<string, any>>
): Promise<number> {
  let written = 0;

  for (const [i, r] of rows.entries()) {
    const asin = normalizeAsin(r.asin);
    // ASIN'siz satırı SESSİZCE ATLAMAK veri kaybıdır: çağıran 24 satır
    // gönderip 23 yazıldığını fark etmez. Hata fırlatıp transaction'ı geri
    // aldırıyoruz; kaynak veri düzeltilmeli.
    if (!asin) {
      throw new Error(
        `Toplu yükleme durduruldu: ${i + 1}. satırda ASIN yok ` +
          `(sipariş no: ${r.orderNumber ?? "—"}). Ürüne bağlanamayan sipariş kaydedilemez.`
      );
    }

    const { productId } = await resolveProduct(tx, {
      asin,
      productTitle: r.productTitle,
      brandName: r.brandName,
      imageUrl: r.imageUrl,
      amazonUrl: r.amazonUrl,
      packCount: Number(r.packCount) || 1,
      isFragile: r.isFragile,
      isMultiPack: r.isMultiPack,
      isBundle: r.isBundle,
      countPerBundle: Number(r.countPerBundle) || null,
      supplierName: r.supplierName,
      supplierCode: r.supplierCode,
      supplierUrl: r.supplierUrl,
      unitCost: r.unitCost,
      observedAt: r.orderDate,
      sourceType: "XLS_IMPORT",
    });

    await tx.insert(ordersTable).values({ ...r, asin, productId });
    written++;
  }

  return written;
}
