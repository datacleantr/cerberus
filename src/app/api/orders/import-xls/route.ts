import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, auditLogs, stores } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { resolveProduct, normalizeAsin } from "@/db/resolveProduct";
import { parseBody, importXlsSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import {
  partitionRows,
  pgErrorCode,
  normalizeMoney,
  type ImportRowProblem,
} from "@/lib/importValidation";

/** storeCreateSchema ile uyumlu mağaza kodu üst sınırı */
const MAX_STORE_CODE_LENGTH = 32;

/** Satır bazlı DB hatasını okunabilir bir "atlandı" gerekçesine çevirir. */
function describeRowError(error: unknown): string {
  const code = pgErrorCode(error);
  if (code === "23505") return "Mükerrer kayıt: bu mağazada aynı Orderno + ASIN ikilisi zaten kayıtlı.";
  if (code === "23503") return "Başvuru hatası: satırdaki bir kod veritabanında tanımlı değil.";
  if (code === "23514") return "Satır değerleri veritabanı kurallarını ihlal etti.";
  return error instanceof Error ? error.message.slice(0, 200) : "Bilinmeyen hata.";
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1) + 15 MB gövde üst sınırı (T3.4, toplu import hacmi için)
    const parsed = await parseBody(req, importXlsSchema, 15 * 1024 * 1024);
    if ("response" in parsed) return parsed.response;
    // Şema satır "varlığını/boyutunu" kilitler; alan tipleri aşağıda
    // String()/Number() ile normalize edildiği için satırı any gevşekliğinde okuruz
    const { rows, defaultStore = "HRN" } = parsed.data as {
      rows: Record<string, any>[];
      defaultStore?: string;
    };

    // Mağaza kapsamı ve aktör oturumdan zorlanır (F-11, audit spoofing engeli)
    const scopedStore = resolveStoreScope(currentUser, defaultStore);
    const actorName = currentUser.name;

    const resolveRowStore = (r: Record<string, any>): string =>
      currentUser.role === "STORE_USER" && currentUser.storeCode !== "ALL"
        ? currentUser.storeCode
        : String(
            scopedStore !== "ALL" ? r.buyerStore || scopedStore : r.buyerStore || "HRN"
          ).trim();

    // ── İçe aktarma esnekliği: hatalı satırlar batch'i durdurmaz ──
    // Satır bazlı doğrulama + batch içi mükerrer tespiti yapılır; sorunlu
    // satırlar ayrılır ve RAPORLANARAK atlanır, kalanlar aktarılır.
    const { validRows, problems } = partitionRows(rows, resolveRowStore);

    // Mağaza kodu uzunluğu da bir satır sorunudur (otomatik oluşturma bunu kurtaramaz)
    const storeProblems: ImportRowProblem[] = [];
    for (const v of validRows) {
      const code = resolveRowStore(v.data);
      if (!code || code.length > MAX_STORE_CODE_LENGTH) {
        storeProblems.push({
          row: v.row,
          field: "Satın Alan (mağaza)",
          message: `"${code || "(boş)"}" geçerli bir mağaza kodu değil (1–${MAX_STORE_CODE_LENGTH} karakter olmalı).`,
        });
      }
    }
    if (storeProblems.length) {
      const badRows = new Set(storeProblems.map((p) => p.row));
      for (let i = validRows.length - 1; i >= 0; i--) {
        if (badRows.has(validRows[i].row)) validRows.splice(i, 1);
      }
      problems.push(...storeProblems);
    }

    if (validRows.length === 0) {
      const shown = problems.slice(0, 10);
      const first = shown[0];
      return NextResponse.json(
        {
          error: `İçe aktarılamadı: ${problems.length} satırda sorun var, aktarılacak geçerli satır kalmadı. İlk sorun: ${first.row}. satır — ${first.field}: ${first.message}`,
          details: shown,
        },
        { status: 400 }
      );
    }

    const insertedOrders: (typeof orders.$inferSelect)[] = [];
    const skippedRows: Array<ImportRowProblem & { reason: string }> = [];
    const createdStores: string[] = [];

    // T2.7: Insert'ler tek transaction'da. Kısmi hata ARTIK yalnızca ilgili
    // satırı etkiler (savepoint): hatalı satır atlanır, batch devam eder.
    await db.transaction(async (tx) => {
      // ── Tanımsız mağaza kodlarını otomatik oluştur ──
      // FK (orders.buyer_store → stores.store_code) yüzünden bilinmeyen bir
      // kod satırı düşürmeden önce, kodu mağaza filosuna tanıtıyoruz.
      const neededStores = [
        ...new Set(validRows.map((v) => resolveRowStore(v.data))),
      ];
      const existingStores = neededStores.length
        ? new Set(
            (
              await tx
                .select({ storeCode: stores.storeCode })
                .from(stores)
                .where(inArray(stores.storeCode, neededStores))
            ).map((s) => s.storeCode)
          )
        : new Set<string>();
      for (const code of neededStores) {
        if (existingStores.has(code)) continue;
        await tx
          .insert(stores)
          .values({
            storeCode: code,
            storeName: `${code} (Otomatik — XLS İçe Aktarım)`,
            marketplace: "AMAZON",
            buyerName: actorName,
            currency: "USD",
            defaultCard: null,
            notes: `XLS içe aktarımında tanımsız mağaza kodu olarak karşılaşıldı; ${actorName} tarafından ${new Date().toISOString().split("T")[0]} tarihinde otomatik oluşturuldu.`,
          })
          .onConflictDoNothing(); // paralel import yarışı: varsa sessizce geç
        createdStores.push(code);
      }

      for (const { row, data: r } of validRows) {
        try {
          const inserted = await tx.transaction(async (inner) => {
            const buyerStore = resolveRowStore(r);

            // AŞAMA 1.2: Her sipariş bir ürüne bağlanır. Doğrulama ASIN'siz
            // satırları zaten eler; buradaki kontrol savunma amaçlıdır.
            const rowAsin = normalizeAsin(r.asin);
            if (!rowAsin) {
              throw new Error(`Satır ${row}: ASIN boş. Her sipariş bir ürüne bağlanmalıdır.`);
            }

            const unitCost = String(normalizeMoney(r.unitCost) ?? 0);
            const sellingPrice = String(normalizeMoney(r.sellingPrice) ?? 0);
            const totalCost = String(normalizeMoney(r.totalCost) ?? 0);
            const correctedCost = String(
              normalizeMoney(r.correctedCost) ?? Number(totalCost)
            );
            const refundAmount = String(normalizeMoney(r.refundAmount) ?? 0);

            const { productId } = await resolveProduct(inner, {
              asin: rowAsin,
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
              unitCost,
              observedAt: r.orderDate,
              sourceType: "XLS_IMPORT",
            });

            const [recorded] = await inner
              .insert(orders)
              .values({
                productId,
                buyerStore,
                orderDate: r.orderDate || new Date().toISOString().split("T")[0],
                imageUrl: r.imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=200&auto=format&fit=crop&q=80",
                fulfillmentType: r.fulfillmentType || "FBA",
                productTitle: r.productTitle || "Amazon Ürünü",
                asin: rowAsin,
                msku: (r.msku || "").trim() || `${buyerStore}-${rowAsin}`,
                supplierName: r.supplierName || "THE VITAMINSHOPPE",
                supplierCode: r.supplierCode || "A198",
                supplierUrl: r.supplierUrl || "",
                amazonUrl: r.amazonUrl || `https://www.amazon.com/dp/${rowAsin}`,
                orderNumber: (r.orderNumber || "").trim(),
                driveLink: r.driveLink || "",
                packCount: Number(r.packCount) || 1,
                quantity: Number(r.quantity) || 1,
                unitCost: Number(unitCost).toFixed(2),
                sellingPrice: Number(sellingPrice).toFixed(2),
                totalCost: Number(totalCost).toFixed(2),
                orderEmail: r.orderEmail || "",
                // Kargo durumu serbest metin: XLS'teki değer olduğu gibi yazılır
                cargoStatus: String(r.cargoStatus || "").trim() || "Tam Geldi",
                shippedToAmazon: Number(r.shippedToAmazon) || 0,
                p1CancelQty: Number(r.p1CancelQty) || 0,
                p2MissingQty: Number(r.p2MissingQty) || 0,
                p3DefectiveQty: Number(r.p3DefectiveQty) || 0,
                p4ExpiredQty: Number(r.p4ExpiredQty) || 0,
                problemAction: r.problemAction || "",
                problemResult: r.problemResult || "",
                refundAmount: Number(refundAmount).toFixed(2),
                creditCard: r.creditCard || null,
                isFragile: r.isFragile || "NO",
                isMultiPack: r.isMultiPack || "NO",
                isBundle: r.isBundle || "NO",
                countPerBundle: Number(r.countPerBundle) || null,
                condition: r.condition || "New",
                brandName: r.brandName || "General",
                description1: r.description1 || "",
                description2: r.description2 || "",
                auditNote: r.auditNote || "",
                periodCode: r.periodCode || "O26",
                correctedCost: Number(correctedCost).toFixed(2),
                pshBatchNo: r.pshBatchNo || null,
                pshStatus: r.pshStatus || "BEKLIYOR",
                inventoryLabStatus: r.inventoryLabStatus || "GIRILMEDI",
              })
              .returning();
            return recorded;
          });
          insertedOrders.push(inserted);
        } catch (rowError: unknown) {
          // Satır bazlı hata: yalnızca bu satırı atla, batch'i durdurma.
          skippedRows.push({
            row,
            field: "Veritabanı kaydı",
            message: describeRowError(rowError),
            reason: "row_failed",
          });
        }
      }
    });

    const skippedCount = skippedRows.length;

    // ── Hiç kayıt giremediyse BAŞARI DEĞİL, HATA ──
    // Tüm geçerli satırların DB aşamasında başarısız olması (ör. hepsi
    // mükerrer) 200 + "0 adet başarıyla kaydedildi" olarak gösterilemez;
    // 400 + anlaşılır hata + satır bazlı details döner.
    if (insertedOrders.length === 0) {
      const first = skippedRows[0];
      await db.insert(auditLogs).values({
        actorName,
        storeCode: scopedStore === "ALL" ? "HRN" : scopedStore,
        actionType: "XLS_BATCH_IMPORT",
        targetEntity: "Google Drive XLS (0 Sipariş)",
        beforeState: "EXCEL_TABLOSU",
        afterState: "CERBERUS_VERITABANI",
        details: `İçe aktarma başarısız: 0 satır aktarıldı, ${skippedCount} satır atlandı, ${createdStores.length} mağaza otomatik oluşturuldu (${createdStores.join(", ") || "yok"}).`,
      });
      return NextResponse.json(
        {
          error: `İçe aktarılamadı: ${rows.length} satırdan hiçbiri kaydedilemedi. ${skippedCount} satır veritabanı aşamasında başarısız oldu. İlk sorun: ${first.row}. satır — ${first.field}: ${first.message}`,
          code: "NO_ROWS_INSERTED",
          importedCount: 0,
          skippedCount,
          skipped: skippedRows.slice(0, 100),
          details: skippedRows.slice(0, 100),
          createdStores,
        },
        { status: 400 }
      );
    }

    let message = `${insertedOrders.length} adet sipariş başarıyla veritabanına aktarıldı.`;
    if (createdStores.length) {
      message += ` ${createdStores.length} tanımsız mağaza kodu otomatik oluşturuldu (${createdStores.join(", ")}).`;
    }
    if (skippedCount) {
      message += ` ${skippedCount} hatalı satır atlandı.`;
    }

    await db.insert(auditLogs).values({
      actorName,
      storeCode: scopedStore === "ALL" ? "HRN" : scopedStore,
      actionType: "XLS_BATCH_IMPORT",
      targetEntity: `Google Drive XLS (${insertedOrders.length} Sipariş)`,
      beforeState: "EXCEL_TABLOSU",
      afterState: "CERBERUS_VERITABANI",
      details: `${insertedOrders.length} satır aktarıldı, ${skippedCount} satır atlandı, ${createdStores.length} mağaza otomatik oluşturuldu (${createdStores.join(", ") || "yok"}).`,
    });

    return NextResponse.json({
      message,
      importedCount: insertedOrders.length,
      skippedCount,
      skipped: skippedRows.slice(0, 100),
      createdStores,
    });
  } catch (error: unknown) {
    const code = pgErrorCode(error);
    if (code === "23505") return NextResponse.json({ error: "Mükerrer sipariş: aynı Orderno + ASIN bu mağazada zaten kayıtlı.", code }, { status: 409 });
    if (code === "23503") return NextResponse.json({ error: "Başvuru hatası: satırdaki bir kod veritabanında tanımlı değil.", code }, { status: 400 });
    if (code === "23514") return NextResponse.json({ error: "Satır değerleri veritabanı kurallarını ihlal etti.", code }, { status: 400 });
    return handleRouteError("POST /api/orders/import-xls", error);
  }
}
