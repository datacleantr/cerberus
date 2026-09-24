/**
 * POST /api/orders/import-xls — route seviyesi testler.
 *
 * Önemli senaryo: tüm satırların DB aşamasında başarısız olması
 * (ör. hepsi mükerrer) "0 adet başarıyla kaydedildi" diye BAŞARI
 * OLARAK gösterilemez → 400 + anlaşılır hata + satır bazlı details.
 *
 * DB (@/db), auth guard'ları ve resolveProduct mocklanır; zod şeması,
 * partitionRows ve hata sarmalayıcı GERÇEK modüllerdir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock hali: fabrikalar ve test gövdeleri arasında paylaşılan durum ──
const h = vi.hoisted(() => ({
  state: {
    existingStores: [] as string[],
    /** 1-tabanlı orders insert sırası → fırlatılacak PG hata kodu */
    orderFailCodes: new Map<number, string>(),
    orderInsertCount: 0,
    auditWrites: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/lib/guards", () => ({
  requireUser: async () => ({
    user: {
      id: 1,
      name: "Ahmet",
      email: "ahmet@cerberus-commerce.io",
      role: "ADMIN",
      storeCode: "ALL",
      avatar: "A",
    },
  }),
  isDenied: () => false,
  resolveStoreScope: (_u: unknown, defaultStore?: string) => defaultStore ?? "HRN",
}));

vi.mock("@/db/resolveProduct", () => ({
  resolveProduct: async () => ({ productId: 777 }),
  normalizeAsin: (v: unknown) => String(v ?? "").trim().toUpperCase(),
}));

vi.mock("@/db", async () => {
  // Tablo kimlik karşılaştırması için GERÇEK şema modülünü kullan
  const { orders, stores, auditLogs } = await import("@/db/schema");

  const insertBuilder = (table: unknown) => {
    const b: { _values?: unknown } & Record<string, unknown> = {};
    b.values = (v: unknown) => {
      b._values = v;
      return b;
    };
    b.onConflictDoNothing = () => Promise.resolve([]);
    b.returning = async () => {
      if (table === orders) {
        h.state.orderInsertCount += 1;
        const code = h.state.orderFailCodes.get(h.state.orderInsertCount);
        if (code) {
          const e = new Error(
            code === "23505"
              ? "duplicate key value violates unique constraint"
              : "check constraint violation"
          );
          (e as { code?: string }).code = code;
          throw e;
        }
      }
      return [b._values];
    };
    return b;
  };

  const tx: Record<string, unknown> = {
    select: () => ({
      from: () => ({
        where: async () => h.state.existingStores.map((c) => ({ storeCode: c })),
      }),
    }),
    insert: (table: unknown) => insertBuilder(table),
    transaction: async (fn: (inner: unknown) => Promise<unknown>) => fn(tx),
  };

  return {
    db: {
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      insert: (table: unknown) => {
        const b: { _values?: unknown } = {};
        return {
          values(v: unknown) {
            b._values = v;
            return {
              then(
                onfulfilled?: (v: unknown) => unknown,
                onrejected?: (e: unknown) => unknown
              ) {
                if (table === auditLogs) h.state.auditWrites.push(b._values as Record<string, unknown>);
                return Promise.resolve(b._values).then(onfulfilled, onrejected);
              },
            };
          },
        };
      },
    },
  };
});

import { POST } from "./route";

// ── Test yardımcıları ──
const makeRow = (i: number) => ({
  buyerStore: "HRN",
  orderDate: "2026-09-01",
  fulfillmentType: "FBA",
  productTitle: `Ürün ${i}`,
  asin: `B0TEST${String(i).padStart(3, "0")}`,
  orderNumber: `WO-RT-${i}`,
  quantity: 1,
  shippedToAmazon: 0,
  unitCost: "10.00",
  sellingPrice: "20.00",
  totalCost: "10.00",
});

const makeRequest = (rows: Record<string, unknown>[]) =>
  new Request("http://localhost/api/orders/import-xls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows, defaultStore: "HRN" }),
  });

describe("POST /api/orders/import-xls — sıfır kayıt ve kısmi başarı", () => {
  beforeEach(() => {
    h.state.existingStores = ["HRN"];
    h.state.orderFailCodes = new Map();
    h.state.orderInsertCount = 0;
    h.state.auditWrites = [];
  });

  it("tüm satırlar DB'de başarısız olursa 400 + NO_ROWS_INSERTED + details döner", async () => {
    h.state.orderFailCodes.set(1, "23505"); // mükerrer
    h.state.orderFailCodes.set(2, "23505"); // mükerrer

    const res = await POST(makeRequest([makeRow(1), makeRow(2)]));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("NO_ROWS_INSERTED");
    expect(body.importedCount).toBe(0);
    expect(body.skippedCount).toBe(2);
    expect(body.error).toContain("İçe aktarılamadı");
    expect(body.error).toContain("hiçbiri kaydedilemedi");
    expect(body.error).toContain("1. satır");

    // details: satır bazlı, okunabilir gerekçeler
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details).toHaveLength(2);
    expect(body.details[0].row).toBe(1);
    expect(body.details[0].message).toContain("Mükerrer kayıt");
    expect(body.skipped).toHaveLength(2);
    expect(body.skipped[0].reason).toBe("row_failed");

    // Deneme yine de denetim kaydına işlenir
    expect(h.state.auditWrites).toHaveLength(1);
    expect(String(h.state.auditWrites[0].details)).toContain("0 satır aktarıldı");
    expect(String(h.state.auditWrites[0].details)).toContain("2 satır atlandı");
  });

  it("kısmi başarıda 200 + skippedCount raporu döner", async () => {
    h.state.orderFailCodes.set(1, "23505"); // yalnızca 1. satır mükerrer

    const res = await POST(makeRequest([makeRow(1), makeRow(2)]));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.importedCount).toBe(1);
    expect(body.skippedCount).toBe(1);
    expect(body.skipped[0].row).toBe(1);
    expect(body.skipped[0].reason).toBe("row_failed");
    expect(body.message).toContain("1 adet sipariş başarıyla");
    expect(body.message).toContain("1 hatalı satır atlandı");
  });

  it("kısmi başarıda DOĞRULAMADA elenen satırlar da skipped listesinde raporlanır (sessizce kaybolmaz)", async () => {
    // Regresyon: partitionRows'un elediği satırlar (ör. ASIN boş) yalnızca
    // "validRows.length === 0" durumunda değil, en az bir satır başarıyla
    // eklendiğinde de kullanıcıya raporlanmalı.
    const res = await POST(makeRequest([makeRow(1), { ...makeRow(2), asin: "" }]));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.importedCount).toBe(1);
    expect(body.skippedCount).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].row).toBe(2);
    expect(body.skipped[0].reason).toBe("pre_validation");
    expect(body.skipped[0].field).toBe("ASIN");
    expect(body.message).toContain("1 hatalı satır atlandı");
  });

  it("tüm satırlar doğrulamada elenirse mevcut 400 + details davranışı korunur", async () => {
    const res = await POST(
      makeRequest([{ ...makeRow(1), asin: "" }, { ...makeRow(2), orderNumber: "" }])
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    // Doğrulama aşaması 400'ü — DB aşaması NO_ROWS_INSERTED değil
    expect(body.code).toBeUndefined();
    expect(body.error).toContain("İçe aktarılamadı");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThanOrEqual(2);
  });
});
