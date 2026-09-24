import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_JSON_BODY_BYTES } from "@/lib/apiResponse";

/**
 * Merkezi gövde doğrulama (T3.1/T3.4).
 * - İstek boyutu content-length üzerinden ön kontrol edilir (413)
 * - JSON parse hatası -> 400, zod ihlali -> 422 (alan bazlı ilk 5 sorun)
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<{ data: z.output<S> } | { response: NextResponse }> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    const response = NextResponse.json(
      { error: `İstek gövdesi çok büyük (üst sınır ${limitMb} MB).` },
      { status: 413 }
    );
    return { response };
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("application/json")) {
    return {
      response: NextResponse.json(
        { error: "Content-Type application/json olmalıdır." },
        { status: 415 }
      ),
    };
  }

  let raw: unknown;
  try {
    // Content-Length istemci tarafından atlanabilir veya yanlış bildirilebilir.
    // Akışı parça parça okuyup gerçek byte sayısını sınırlayarak serverless
    // fonksiyonun belleğinin sınırsız JSON gövdesiyle tüketilmesini engelleriz.
    if (!req.body) throw new Error("empty body");
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytesRead = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          await reader.cancel("request body too large");
          const limitMb = Math.round(maxBytes / (1024 * 1024));
          return {
            response: NextResponse.json(
              { error: `İstek gövdesi çok büyük (üst sınır ${limitMb} MB).` },
              { status: 413 }
            ),
          };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    raw = JSON.parse(text);
  } catch {
    return {
      response: NextResponse.json({ error: "Geçersiz JSON gövdesi." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    return {
      response: NextResponse.json(
        { error: "Girdi doğrulaması başarısız.", details: issues },
        { status: 422 }
      ),
    };
  }
  return { data: parsed.data };
}

/* ---------------------------------- Şemalar ---------------------------------- */

const shortText = (max: number) => z.string().trim().max(max);
const money = z.coerce.number().min(0).max(10_000_000);
const countInt = z.coerce.number().int().min(0).max(100_000);
const moneyStr = money.transform((n) => n.toFixed(2));
const yesNo = z.enum(["YES", "NO"]).default("NO");
const emailStr = z.string().trim().toLowerCase().email().max(254);
const optionalEmail = z.union([z.literal(""), emailStr]);
const optionalLastFour = z.union([
  z.literal(""),
  z.string().trim().regex(/^\d{4}$/, "Kart alanı yalnızca son 4 haneyi içermelidir."),
]);
const optionalHttpUrl = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .url()
    .max(1000)
    .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
      message: "Yalnızca http/https bağlantısı kullanılabilir.",
    }),
]);
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalıdır.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Geçerli bir tarih girin.");

export const loginSchema = z.object({
  email: emailStr,
  password: z.string().min(1).max(128),
});

export const orderCreateSchema = z
  .object({
    buyerStore: shortText(32).optional(),
    orderDate: isoDate.optional(),
    imageUrl: optionalHttpUrl.optional(),
    fulfillmentType: z.enum(["FBA", "FBM"]).default("FBA"),
    productTitle: shortText(500).min(1, "Ürün adı zorunludur"),
    asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "ASIN 10 harf/rakam olmalıdır."),
    msku: shortText(64).optional(),
    supplierName: shortText(200).optional(),
    supplierCode: shortText(32).optional(),
    supplierUrl: optionalHttpUrl.optional(),
    amazonUrl: optionalHttpUrl.optional(),
    orderNumber: shortText(64).min(1, "Sipariş No zorunludur"),
    driveLink: optionalHttpUrl.optional(),
    packCount: z.coerce.number().int().min(1).max(100_000).optional(),
    quantity: z.coerce.number().int().min(1).max(100_000).optional(),
    unitCost: money.optional(),
    sellingPrice: money.optional(),
    totalCost: money.optional(),
    orderEmail: optionalEmail.optional(),
    cargoStatus: shortText(60).optional(),
    shippedToAmazon: countInt.optional(),
    p1CancelQty: countInt.optional(),
    p2MissingQty: countInt.optional(),
    p3DefectiveQty: countInt.optional(),
    p4ExpiredQty: countInt.optional(),
    problemAction: shortText(1000).optional(),
    problemResult: shortText(1000).optional(),
    refundAmount: money.optional(),
    creditCard: optionalLastFour.optional(),
    isFragile: yesNo.optional(),
    isMultiPack: yesNo.optional(),
    isBundle: yesNo.optional(),
    countPerBundle: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    condition: shortText(40).optional(),
    brandName: shortText(120).optional(),
    description1: shortText(2000).optional(),
    description2: shortText(2000).optional(),
    auditNote: shortText(2000).optional(),
    periodCode: shortText(16).optional(),
    correctedCost: money.optional(),
    pshBatchNo: shortText(64).nullable().optional(),
    pshStatus: z.enum(["BEKLIYOR", "BATCH_OLUSTURULDU", "DEPO_SAYILDI", "AMAZONA_SEVK"]).optional(),
    inventoryLabStatus: z.enum(["GIRILMEDI", "GIRILDI", "AKTIF_SATISTA"]).optional(),
    actorName: shortText(120).optional(), // geriye dönük uyumluluk; sunucu oturum adını kullanır
  })
  .superRefine((value, ctx) => {
    const quantity = value.quantity ?? 1;
    if ((value.shippedToAmazon ?? 0) > quantity) {
      ctx.addIssue({
        code: "custom",
        path: ["shippedToAmazon"],
        message: "Amazon'a sevk edilen adet sipariş adedini aşamaz.",
      });
    }
    const fire =
      (value.p1CancelQty ?? 0) +
      (value.p2MissingQty ?? 0) +
      (value.p3DefectiveQty ?? 0) +
      (value.p4ExpiredQty ?? 0);
    if (fire > quantity) {
      ctx.addIssue({
        code: "custom",
        path: ["p1CancelQty"],
        message: "P1–P4 fire toplamı sipariş adedini aşamaz.",
      });
    }
    if (value.isBundle === "YES" && !value.countPerBundle) {
      ctx.addIssue({
        code: "custom",
        path: ["countPerBundle"],
        message: "Bundle ürünlerde paket içi adet zorunludur.",
      });
    }
  });

export const orderUpdateSchema = z
  .object({
    cargoStatus: shortText(60).optional(),
    shippedToAmazon: countInt.optional(),
    p1CancelQty: countInt.optional(),
    p2MissingQty: countInt.optional(),
    p3DefectiveQty: countInt.optional(),
    p4ExpiredQty: countInt.optional(),
    problemAction: shortText(1000).optional(),
    problemResult: shortText(1000).optional(),
    refundAmount: moneyStr.optional(),
    pshBatchNo: shortText(64).nullable().optional(),
    pshStatus: shortText(40).optional(),
    inventoryLabStatus: shortText(40).optional(),
    description1: shortText(2000).optional(),
    description2: shortText(2000).optional(),
    auditNote: shortText(2000).optional(),
    driveLink: shortText(1000).optional(),
    sellingPrice: moneyStr.optional(),
    unitCost: moneyStr.optional(),
    quantity: countInt.optional(),
    totalCost: moneyStr.optional(),
    correctedCost: moneyStr.optional(),
  })
  .strict();

const xlsRowSchema = z.record(z.string(), z.unknown()); // satır alanları route içinde normalize edilir

export const importXlsSchema = z.object({
  rows: z.array(xlsRowSchema).min(1, "Satır gerekli").max(5000, "Tek seferde en fazla 5.000 satır"),
  defaultStore: shortText(32).optional(),
});

export const driveUrlSchema = z.object({
  driveUrl: z.string().trim().min(10).max(500),
  defaultStore: shortText(32).optional(),
});

export const batchCreateSchema = z.object({
  batchNumber: shortText(64).min(1, "Batch no zorunludur"),
  storeCode: shortText(32).optional(),
  title: shortText(200).min(1, "Başlık zorunludur"),
  orderIds: z.array(z.coerce.number().int().positive()).max(5000).default([]),
  notes: shortText(2000).optional(),
});

export const batchUpdateSchema = z.object({
  status: z.enum(["HAZIRLANIYOR", "DEPODA", "SAYILDI", "AMAZONA_GONDERILDI"]),
  notes: shortText(2000).optional(),
});

export const prepshipImportRowSchema = z.object({
  asin: shortText(20).optional(),
  msku: shortText(64).optional(),
  quantity: z.coerce.number().min(0).max(1_000_000).optional(),
  costUnit: z.coerce.number().min(0).max(1_000_000).optional(),
});

export const prepshipImportSchema = z.object({
  rows: z.array(prepshipImportRowSchema).min(1, "Dosyada satır bulunamadı").max(20_000),
  commit: z.boolean().optional().default(false),
});

export const userCreateSchema = z.object({
  name: shortText(100).min(2, "İsim zorunludur"),
  email: emailStr,
  role: z.enum(["ADMIN", "MANAGER", "STORE_USER"]).default("STORE_USER"),
  storeCode: shortText(32).optional(),
  password: z.string().min(12, "Parola en az 12 karakter olmalıdır").max(128),
});

export const userUpdateSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    name: shortText(100).min(2).optional(),
    role: z.enum(["ADMIN", "MANAGER", "STORE_USER"]).optional(),
    storeCode: shortText(32).optional(),
    password: z.string().min(12, "Parola en az 12 karakter olmalıdır").max(128).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.role !== undefined ||
      value.storeCode !== undefined ||
      value.password !== undefined,
    { message: "Güncellenecek en az bir alan gönderin." }
  );

export const storeCreateSchema = z.object({
  storeCode: shortText(32).min(1, "Mağaza kodu zorunludur"),
  storeName: shortText(200).min(1, "Mağaza adı zorunludur"),
  marketplace: shortText(32).optional(),
  buyerName: shortText(100).optional(),
  currency: z.string().trim().length(3).optional(),
  defaultCard: optionalLastFour.optional(),
  defaultEmail: optionalEmail.optional(),
  notes: shortText(2000).optional(),
  // NULL/boş = eşik yok (varsayılan). Girilirse: bu tutarı aşan ve bir
  // STORE_USER tarafından girilen siparişler PENDING_APPROVAL'a düşer.
  purchaseApprovalThreshold: z.coerce.number().nonnegative().nullable().optional(),
});

export const storeUpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  storeName: shortText(200).optional(),
  buyerName: shortText(100).optional(),
  status: z.enum(["ACTIVE", "PASSIVE"]).optional(),
  defaultCard: optionalLastFour.optional(),
  defaultEmail: optionalEmail.optional(),
  notes: shortText(2000).optional(),
  purchaseApprovalThreshold: z.coerce.number().nonnegative().nullable().optional(),
});

export const orderApprovalDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

/**
 * Mağaza rutin kontrol listesi (F-07) — kaynak: "Amazon Mağaza Ekibi Rutin"
 * belgesi. Rutin kataloğu statik (src/domain/routineCatalog.ts); burada
 * yalnız hangi mağaza/rutin işaretleniyor ve isteğe bağlı kanıt notu
 * doğrulanır.
 */
export const routineCompleteSchema = z.object({
  storeCode: shortText(32).min(1, "Mağaza kodu zorunludur"),
  routineId: shortText(80).min(1, "Rutin kimliği zorunludur"),
  note: shortText(500).nullable().optional(),
});

/**
 * Araç/varlık takibi (F-07, ikinci bölüm) — ASINZEN/Keepa üyelik,
 * GoDaddy alan adı/hosting, Shopify site vb. storeCode boş/null = şirket
 * geneli varlık (yalnız ADMIN/MANAGER oluşturabilir, route katmanında
 * zorlanır).
 */
export const assetCreateSchema = z.object({
  storeCode: shortText(32).min(1).nullable().optional(),
  assetType: z.enum(["SUBSCRIPTION", "DOMAIN", "HOSTING", "SHOPIFY_SITE", "OTHER"]),
  name: shortText(200).min(1, "Varlık adı zorunludur"),
  provider: shortText(100).nullable().optional(),
  url: z.union([z.literal(""), z.string().trim().url().max(500)]).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  renewalCost: z.coerce.number().nonnegative().nullable().optional(),
  notes: shortText(2000).nullable().optional(),
});

export const assetUpdateSchema = z
  .object({
    assetType: z.enum(["SUBSCRIPTION", "DOMAIN", "HOSTING", "SHOPIFY_SITE", "OTHER"]).optional(),
    name: shortText(200).min(1).optional(),
    provider: shortText(100).nullable().optional(),
    url: z.union([z.literal(""), z.string().trim().url().max(500)]).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    renewalCost: z.coerce.number().nonnegative().nullable().optional(),
    notes: shortText(2000).nullable().optional(),
    /** true: lastCheckedAt/lastCheckedBy'ı şimdiki kullanıcı+an ile günceller */
    markChecked: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.assetType !== undefined ||
      value.name !== undefined ||
      value.provider !== undefined ||
      value.url !== undefined ||
      value.expiresAt !== undefined ||
      value.renewalCost !== undefined ||
      value.notes !== undefined ||
      value.markChecked !== undefined,
    { message: "Güncellenecek en az bir alan gönderin." }
  );

export const intelligenceCreateSchema = z.object({
  sourceUrl: z.union([z.literal(""), z.string().trim().url().max(1000)]).optional(),
  title: shortText(500).min(1, "Ürün başlığı zorunludur"),
  brand: shortText(120).optional(),
  category: shortText(120).optional(),
  upc: shortText(32).optional(),
  asin: shortText(20).optional(),
  sourcePrice: money.optional(),
  sellingPrice: money.optional(),
  prepCost: money.optional(),
  researcherName: shortText(120).optional(),
  supplierName: shortText(200).optional(),
  notes: shortText(2000).optional(),
});

export const intelligencePatchSchema = z
  .object({
    decisionAction: z
      .enum(["BUY", "TEST", "WAIT", "REJECT", "REPRICE", "REORDER", "PAUSE", "LIQUIDATE"])
      .optional(),
    lifecycleStage: shortText(40).optional(),
    policyStatus: shortText(60).optional(),
    dataQualityStatus: shortText(40).optional(),
    sellingPrice: money.optional(),
    actorName: shortText(120).optional(),
  })
  .strict();

export const masterCrudDeleteSchema = z.object({
  // Generic tablo silme kapatıldı: UI yalnızca tek sipariş satırı silebilir.
  tableName: z.literal("orders"),
  id: z.coerce.number().int().positive(),
});

export const dbResetSchema = z.object({
  actionType: z.enum([
    "CLEAN_ORDERS_ONLY",
    "RESTORE_REAL_XLS",
    "FRESH_START_REAL_DATA",
    "NUKE_ALL_KEEP_ADMIN",
  ]),
  confirmationCode: z.literal("RESET-CERBERUS", {
    error: "Güvenlik kodu hatalı. Lütfen 'RESET-CERBERUS' onay kodunu girin.",
  }),
});

// ── Crawler & Keepa (Arbitraj V2) ──
export const crawlerScrapeSchema = z.object({
  url: z.string().trim().url().max(2000),
  storeCode: shortText(32).optional(),
  maxPages: z.coerce.number().int().min(1).max(3).optional(),
});

export const crawlerImportSchema = z.object({
  scrapedIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  storeCode: shortText(32).optional(),
});

export const keepaAnalyzeSchema = z.object({
  asin: shortText(20).min(10).max(10),
  domain: z.coerce.number().int().min(1).max(11).optional(),
  sourcePrice: money.optional(),
  sellingPrice: money.optional(),
  sourceDomain: shortText(200).optional(),
  duplicateScore: z.coerce.number().int().min(0).max(100).optional(),
});

export const analyticsQuerySchema = z.object({
  storeCode: shortText(32).optional(),
  period: z.enum(["7d", "30d", "90d", "all"]).optional(),
});

export const settingsUpdateSchema = z
  .object({
    rejectRoi: z.coerce.number().min(0).max(100),
    testRoi: z.coerce.number().min(0).max(100),
    keepaKey: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.rejectRoi >= value.testRoi) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectRoi"],
        message: "REJECT eşiği TEST eşiğinden küçük olmalıdır.",
      });
    }
    if (value.keepaKey && value.keepaKey.length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["keepaKey"],
        message: "Keepa anahtarı çok kısa.",
      });
    }
  });
