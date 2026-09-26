/**
 * DELETE /api/admin/stores — route seviyesi testler.
 *
 * Admin panelinde eksik olan mağaza silme işlemi eklendi (kullanıcı talebi).
 * Dürüstlük ilkesiyle aynı mantık: gerçek sipariş/rutin/varlık/PSH batch/
 * tarama geçmişi olan bir mağaza ASLA kalıcı silinemez (yalnız PASİF
 * yapılabilir, bkz. PATCH .status) — kalıcı silme yalnız hiç kullanılmamış
 * mağazalar için izinlidir. Bu testler her bir geçmiş türünün ayrı ayrı
 * silmeyi engellediğini ve geçmişsiz mağazanın silinebildiğini doğrular.
 *
 * @/db, @/lib/guards mocklanır; zod şeması ve route mantığı GERÇEK modüllerdir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    targetStore: null as Record<string, unknown> | null,
    orderCount: 0,
    routineCount: 0,
    assetCount: 0,
    batchCount: 0,
    scrapeCount: 0,
    userCount: 0,
    deleteCalls: [] as Array<{ where: unknown }>,
    auditWrites: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/lib/guards", () => ({
  requireRole: async () => ({
    user: { id: 1, name: "Ahmet", email: "a@x.io", role: "ADMIN", storeCode: "ALL", avatar: "A" },
  }),
  isDenied: () => false,
}));

vi.mock("@/db", async () => {
  const { stores, orders, routineCompletions, storeAssets, pshBatches, scrapeJobs, users } = await import(
    "@/db/schema"
  );

  return {
    db: {
      select: (proj?: any) => ({
        from: (table: any): any => {
          // count() sorguları — hedef tabloya göre doğru sayacı döndür
          if (proj && typeof proj === "object" && "n" in proj) {
            let n = 0;
            if (table === orders) n = h.state.orderCount;
            else if (table === routineCompletions) n = h.state.routineCount;
            else if (table === storeAssets) n = h.state.assetCount;
            else if (table === pshBatches) n = h.state.batchCount;
            else if (table === scrapeJobs) n = h.state.scrapeCount;
            else if (table === users) n = h.state.userCount;
            return { where: async () => [{ n }] };
          }
          // hedef mağazayı çeken sorgu
          return {
            where: () => ({
              limit: async () => (table === stores && h.state.targetStore ? [h.state.targetStore] : []),
            }),
          };
        },
      }),
      insert: (_table: unknown) => ({
        values: async (v: unknown) => {
          h.state.auditWrites.push(v as Record<string, unknown>);
          return [v];
        },
      }),
      delete: (_table: unknown) => ({
        where: async (whereArg: unknown) => {
          h.state.deleteCalls.push({ where: whereArg });
          return [];
        },
      }),
    },
  };
});

import { DELETE } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/stores", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/admin/stores", () => {
  beforeEach(() => {
    h.state.targetStore = { id: 5, storeCode: "TEST01", storeName: "Test Mağaza", status: "ACTIVE" };
    h.state.orderCount = 0;
    h.state.routineCount = 0;
    h.state.assetCount = 0;
    h.state.batchCount = 0;
    h.state.scrapeCount = 0;
    h.state.userCount = 0;
    h.state.deleteCalls = [];
    h.state.auditWrites = [];
  });

  it("hiç geçmişi olmayan mağazayı kalıcı olarak siler", async () => {
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain("TEST01");
    expect(h.state.deleteCalls.length).toBe(1);
    expect(h.state.auditWrites[0].actionType).toBe("STORE_DELETED");
  });

  it("mağaza bulunamazsa 404 döner", async () => {
    h.state.targetStore = null;
    const res = await DELETE(makeRequest({ id: 999 }));
    expect(res.status).toBe(404);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("gerçek sipariş geçmişi varsa silinemez", async () => {
    h.state.orderCount = 3;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("gerçek geçmişi var");
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("rutin tamamlama kaydı varsa silinemez", async () => {
    h.state.routineCount = 1;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("varlık (asset) kaydı varsa silinemez", async () => {
    h.state.assetCount = 1;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("PSH batch kaydı varsa silinemez", async () => {
    h.state.batchCount = 1;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("tarama işi (scrape job) kaydı varsa silinemez", async () => {
    h.state.scrapeCount = 1;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("mağazaya atanmış kullanıcı varsa silinemez", async () => {
    h.state.userCount = 2;
    const res = await DELETE(makeRequest({ id: 5 }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("kullanıcı atanmış");
    expect(h.state.deleteCalls.length).toBe(0);
  });
});
