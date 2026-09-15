import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  pshBatches,
  auditLogs,
  productMasters,
  products,
  supplierOffers,
  productLifecycleEvents,
  researchSessions,
  users,
  stores,
} from "@/db/schema";
import { requireRole, isDenied } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { parseBody, dbResetSchema } from "@/lib/validation";
import { insertOrdersWithProducts } from "@/db/resolveProduct";
import { ne } from "drizzle-orm";

export async function POST(req: Request) {
  // T0.2: Bu yıkıcı araç üretim ortamında tamamen devre dışıdır.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }

  try {
    // Anonim geçiş kapatıldı (F-02): oturum yoksa 401, ADMIN değilse 403
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // T2.5: Demo/fixture verisi yalnızca bu dev-only araç içinde, ihtiyaç anında yüklenir
    const { ALL_38_XLS_ORDERS: FIXTURE_ORDERS, INITIAL_BATCHES } = await import(
      "@fixtures/mockData"
    );

    const parsed = await parseBody(req, dbResetSchema);
    if ("response" in parsed) return parsed.response;
    const { actionType } = parsed.data;

    if (actionType === "CLEAN_ORDERS_ONLY") {
      // 1. Sadece Siparişleri ve PSH Partilerini Temizle (Kullanıcılar & Mağazalar Kalır)
      // Ürün kataloğu KORUNUR: keşfedilmiş ürün bilgisi siparişten bağımsız
      // bir varlıktır. Ama fiyat gözlemleri siparişlerden türediği için
      // onlarla birlikte gider.
      await db.transaction(async (tx) => {
        await tx.delete(orders);
        await tx.delete(pshBatches);
        await tx.delete(supplierOffers);

        await tx.insert(auditLogs).values({
          actorName: currentUser.name,
          storeCode: "ALL",
          actionType: "DATABASE_CLEAN_ORDERS",
          targetEntity: "orders & psh_batches",
          beforeState: "DOLU_VERITABANI",
          afterState: "TEMIZ_SIPARIS_HAVUZU",
          details: "Tüm siparişler ve PSH partileri temizlendi. Kullanıcı ve mağaza tanımları korundu.",
        });
      });

      return NextResponse.json({
        success: true,
        message: "Siparişler ve PSH partileri tertemiz silindi. Kullanıcı hesapları ve mağazalarınız korundu. Artık kendi gerçek Excel/Drive verilerinizi yükleyebilirsiniz.",
      });
    }

    if (actionType === "RESTORE_REAL_XLS") {
      // Siparişler psh_batches'e FK ile bağlıdır. Eski sipariş -> eski batch
      // silme ve yeni batch -> yeni sipariş ekleme sırası tek transaction'dadır.
      const restoredCount = await db.transaction(async (tx) => {
        await tx.delete(orders);
        await tx.delete(supplierOffers);
        await tx.delete(pshBatches);
        await tx.insert(pshBatches).values(
          INITIAL_BATCHES.map((b) => ({
            batchNumber: b.batchNumber,
            storeCode: b.storeCode,
            title: b.title,
            status: b.status,
            totalItemsCount: b.totalItemsCount,
            totalUnitsCount: b.totalUnitsCount,
            receivedUnitsCount: b.receivedUnitsCount,
            missingUnitsCount: b.missingUnitsCount,
            defectiveUnitsCount: b.defectiveUnitsCount,
            inventoryLabSynced: b.inventoryLabSynced,
            notes: b.notes,
          }))
        );

        const written = await insertOrdersWithProducts(tx, orders, FIXTURE_ORDERS);
        await tx.insert(auditLogs).values({
          actorName: currentUser.name,
          storeCode: "ALL",
          actionType: "DATABASE_RESTORE_XLS",
          targetEntity: `${written} fixture siparişi`,
          beforeState: "MEVCUT_DURUM",
          afterState: "FIXTURE_GERI_YUKLENDI",
          details: `${written} sipariş ve PSH sevkiyat partileri geliştirme fixture'ından yeniden yüklendi.`,
        });
        return written;
      });

      return NextResponse.json({
        success: true,
        message: `${restoredCount} fixture siparişi ve PSH partileri başarıyla geri yüklendi.`,
      });
    }

    if (actionType === "FRESH_START_REAL_DATA") {
      // 4. GERÇEK VERİYLE BAŞLANGIÇ
      // Tüm demo/fixture operasyonel verisini siler ama kurumsal yapıyı
      // (mağazalar, kullanıcılar, araştırmacı kadrosu) korur.
      //
      // CLEAN_ORDERS_ONLY'den farkı: ürün ana kayıtlarını (productMasters) da
      // temizler. Aksi halde demo ürünler kalır ve gerçek siparişlerle
      // eşleşmediği için gerçekleşen ROI ölçümü kirlenir — sabah brifingi
      // olmayan ürünler üzerinden skor üretir.
      await db.transaction(async (tx) => {
        await tx.delete(orders);
        await tx.delete(pshBatches);
        await tx.delete(productMasters);
        // Ürün merkezli çekirdek de sıfırlanır: demo ürünler kalırsa gerçek
        // siparişlerle eşleşmeyip katalogu ve ROI ölçümünü kirletir.
        await tx.delete(supplierOffers);
        await tx.delete(productLifecycleEvents);
        await tx.delete(products);
        await tx.delete(researchSessions);

        await tx.insert(auditLogs).values({
          actorName: currentUser.name,
          storeCode: "ALL",
          actionType: "DATABASE_FRESH_START",
          targetEntity: "orders, psh_batches, product_masters, research_sessions",
          beforeState: "DEMO_VERISI",
          afterState: "GERCEK_VERI_ICIN_HAZIR",
          details:
            "Tüm demo operasyonel verisi temizlendi. Mağazalar, kullanıcılar ve araştırmacı kadrosu korundu. Sistem gerçek Excel/Drive verisi için hazır.",
        });
      });

      return NextResponse.json({
        success: true,
        message:
          "Sistem gerçek veriyle başlangıç için hazırlandı. Siparişler, PSH partileri, ürün ana kayıtları ve araştırma oturumları silindi. Mağazalarınız, kullanıcı hesaplarınız ve araştırmacı kadronuz korundu. Artık kendi XLS/Drive verinizi yükleyebilirsiniz.",
      });
    }

    if (actionType === "NUKE_ALL_KEEP_ADMIN") {
      // 3. Admin Hariç Tüm Tabloları Temizle
      await db.transaction(async (tx) => {
        await tx.delete(orders);
        await tx.delete(pshBatches);
        await tx.delete(productMasters);
        // Ürün merkezli çekirdek de sıfırlanır: demo ürünler kalırsa gerçek
        // siparişlerle eşleşmeyip katalogu ve ROI ölçümünü kirletir.
        await tx.delete(supplierOffers);
        await tx.delete(productLifecycleEvents);
        await tx.delete(products);
        await tx.delete(researchSessions);
        await tx.delete(auditLogs);

        // Admin dışındaki kullanıcıları temizle; en az aktif admin oturumu kalır.
        await tx.delete(users).where(ne(users.role, "ADMIN"));

        await tx.insert(auditLogs).values({
          actorName: currentUser.name,
          storeCode: "ALL",
          actionType: "DATABASE_FACTORY_RESET",
          targetEntity: "Tüm Tablolar",
          beforeState: "DOLU",
          afterState: "SIFIRLANDI",
          details: "Fabrika ayarlarına dönüldü. ADMIN hesapları ve mağaza tanımları korundu.",
        });
      });

      return NextResponse.json({
        success: true,
        message: "Veritabanı fabrika ayarlarına sıfırlandı. ADMIN hesapları ve mağaza tanımları korundu.",
      });
    }

    return NextResponse.json({ error: "Geçersiz işlem tipi" }, { status: 400 });
  } catch (error: unknown) {
    return handleRouteError("POST /api/admin/database-reset", error);
  }
}
