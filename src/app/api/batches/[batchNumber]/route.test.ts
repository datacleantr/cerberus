/**
 * PATCH /api/batches/[batchNumber] — route seviyesi testler.
 *
 * Denetim raporu §13: bu endpoint eklenene kadar `psh_batches.status` ve
 * sayaç kolonları hiçbir zaman gerçek veriden hesaplanmıyordu. Testler bu
 * yeniden hesaplamayı ve "Amazona Sevk" geçişinde yalnızca fiilen sevk
 * edilmiş (shippedToAmazon > 0) siparişlerin taşındığını doğrular.
 *
 * @/db, @/lib/guards mocklanır; zod şeması ve route mantığı GERÇEK modüllerdir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    canAccess: true,
    existingBatch: null as Record<string, unknown> | null,
    batchOrders: [] as Record<string, unknown>[],
    updateCalls: [] as Array<{ table: string; set: unknown; where: unknown }>,
    auditWrites: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/lib/guards", () => ({
  requireUser: async () => ({
    user: { id: 1, name: "Ahmet", email: "a@x.io", role: "ADMIN", storeCode: "ALL", avatar: "A" },
  }),
  isDenied: () => false,
  canAccessStore: () => h.state.canAccess,
}));

vi.mock("@/db", async () => {
  const { pshBatches, orders, auditLogs } = await import("@/db/schema");

  const updateBuilder = (table: unknown, tableName: string) => ({
    set: (vals: unknown) => ({
      where: (whereArg: unknown) => ({
        returning: async (proj?: unknown) => {
          h.state.updateCalls.push({ table: tableName, set: vals, where: whereArg });
          if (table === pshBatches) return [{ ...h.state.existingBatch, ...(vals as object) }];
          if (table === orders) {
            const shipped = h.state.batchOrders.filter((o) => Number(o.shippedToAmazon) > 0);
            return proj ? shipped.map((o) => ({ id: o.id })) : shipped;
          }
          return [];
        },
      }),
    }),
  });

  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => (table === orders ? h.state.batchOrders : []),
      }),
    }),
    update: (table: unknown) =>
      updateBuilder(table, table === pshBatches ? "psh_batches" : table === orders ? "orders" : "unknown"),
    insert: (table: unknown) => ({
      values: async (v: unknown) => {
        if (table === auditLogs) h.state.auditWrites.push(v as Record<string, unknown>);
        return [v];
      },
    }),
  };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (h.state.existingBatch ? [h.state.existingBatch] : []),
          }),
        }),
      }),
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

import { PATCH } from "./route";

const makeRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/batches/PSH-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ctx = { params: Promise.resolve({ batchNumber: "PSH-1" }) };

describe("PATCH /api/batches/[batchNumber]", () => {
  beforeEach(() => {
    h.state.canAccess = true;
    h.state.existingBatch = {
      id: 1,
      batchNumber: "PSH-1",
      storeCode: "HRN",
      status: "HAZIRLANIYOR",
      title: "Test Batch",
    };
    h.state.batchOrders = [];
    h.state.updateCalls = [];
    h.state.auditWrites = [];
  });

  it("batch bulunamazsa 404 döner", async () => {
    h.state.existingBatch = null;
    const res = await PATCH(makeRequest({ status: "DEPODA" }), ctx);
    expect(res.status).toBe(404);
  });

  it("mağaza kapsamı dışındaysa 403 döner", async () => {
    h.state.canAccess = false;
    const res = await PATCH(makeRequest({ status: "DEPODA" }), ctx);
    expect(res.status).toBe(403);
  });

  it("sayaçları siparişlerden yeniden hesaplayıp yazar", async () => {
    h.state.batchOrders = [
      { id: 1, quantity: 10, p2MissingQty: 2, p3DefectiveQty: 1, shippedToAmazon: 7 },
      { id: 2, quantity: 5, p2MissingQty: 0, p3DefectiveQty: 0, shippedToAmazon: 5 },
    ];
    const res = await PATCH(makeRequest({ status: "DEPODA" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch.totalItemsCount).toBe(2);
    expect(body.batch.totalUnitsCount).toBe(15);
    expect(body.batch.missingUnitsCount).toBe(2);
    expect(body.batch.defectiveUnitsCount).toBe(1);
    expect(body.batch.receivedUnitsCount).toBe(13); // (10-2) + (5-0)
  });

  it("AMAZONA_GONDERILDI geçişinde yalnızca fiilen sevk edilmiş siparişleri taşır", async () => {
    h.state.batchOrders = [
      { id: 1, quantity: 10, p2MissingQty: 10, p3DefectiveQty: 0, shippedToAmazon: 0 }, // tamamen eksik geldi
      { id: 2, quantity: 5, p2MissingQty: 0, p3DefectiveQty: 0, shippedToAmazon: 5 },
    ];
    const res = await PATCH(makeRequest({ status: "AMAZONA_GONDERILDI" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shippedOrderCount).toBe(1);

    const orderUpdate = h.state.updateCalls.find((c) => c.table === "orders");
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate?.set).toMatchObject({ pshStatus: "AMAZONA_SEVK" });
  });

  it("geçersiz status değeri 422 ile reddedilir", async () => {
    const res = await PATCH(makeRequest({ status: "GECERSIZ" }), ctx);
    expect(res.status).toBe(422);
  });
});
