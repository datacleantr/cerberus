/**
 * POST /api/batches/[batchNumber]/prepship-import — route seviyesi testler.
 *
 * commit=false yalnızca önizleme döner, hiçbir update çağrılmamalı;
 * commit=true yalnızca eşleşen siparişlerin inventoryLabStatus'unu yazmalı
 * ve YALNIZCA tüm batch eşleştiyse psh_batches.inventoryLabSynced=true
 * yapmalı. shippedToAmazon/p2MissingQty gibi fiziksel alanlara ASLA
 * dokunmamalı (denetim raporu §17 düzeltmesi).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    canAccess: true,
    existingBatch: null as Record<string, unknown> | null,
    batchOrders: [] as Record<string, unknown>[],
    orderUpdateCalls: [] as Array<{ set: unknown }>,
    batchUpdateCalls: [] as Array<{ set: unknown }>,
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

  const tx = {
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          then: (resolve: (v: unknown[]) => unknown) => {
            if (table === orders) h.state.orderUpdateCalls.push({ set: vals });
            if (table === pshBatches) h.state.batchUpdateCalls.push({ set: vals });
            return Promise.resolve([]).then(resolve);
          },
        }),
      }),
    }),
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
        from: (table: unknown) => ({
          where: () => {
            if (table === pshBatches) {
              return { limit: async () => (h.state.existingBatch ? [h.state.existingBatch] : []) };
            }
            return Promise.resolve(table === orders ? h.state.batchOrders : []);
          },
        }),
      }),
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

import { POST } from "./route";

const makeRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/batches/PSH-1/prepship-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ctx = { params: Promise.resolve({ batchNumber: "PSH-1" }) };

describe("POST /api/batches/[batchNumber]/prepship-import", () => {
  beforeEach(() => {
    h.state.canAccess = true;
    h.state.existingBatch = { id: 1, batchNumber: "PSH-1", storeCode: "HRN", status: "HAZIRLANIYOR" };
    h.state.batchOrders = [
      { id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 6 },
      { id: 2, orderNumber: "WO-2", msku: "HRN-B002", quantity: 4 },
    ];
    h.state.orderUpdateCalls = [];
    h.state.batchUpdateCalls = [];
    h.state.auditWrites = [];
  });

  it("batch bulunamazsa 404 döner", async () => {
    h.state.existingBatch = null;
    const res = await POST(makeRequest({ rows: [{ msku: "HRN-B001", quantity: 6 }] }), ctx);
    expect(res.status).toBe(404);
  });

  it("mağaza kapsamı dışındaysa 403 döner", async () => {
    h.state.canAccess = false;
    const res = await POST(makeRequest({ rows: [{ msku: "HRN-B001", quantity: 6 }] }), ctx);
    expect(res.status).toBe(403);
  });

  it("commit=false iken yalnızca önizleme döner, hiçbir update çağrılmaz", async () => {
    const res = await POST(
      makeRequest({ rows: [{ msku: "HRN-B001", quantity: 6 }, { msku: "HRN-B002", quantity: 4 }] }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.committed).toBe(false);
    expect(body.preview.matchedCount).toBe(2);
    expect(h.state.orderUpdateCalls).toHaveLength(0);
    expect(h.state.batchUpdateCalls).toHaveLength(0);
    expect(h.state.auditWrites).toHaveLength(0);
  });

  it("commit=true, tüm siparişler eşleştiğinde inventoryLabStatus + inventoryLabSynced yazar, fiziksel alanlara dokunmaz", async () => {
    const res = await POST(
      makeRequest({
        rows: [{ msku: "HRN-B001", quantity: 6 }, { msku: "HRN-B002", quantity: 4 }],
        commit: true,
      }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.committed).toBe(true);
    expect(h.state.orderUpdateCalls).toHaveLength(2);
    for (const call of h.state.orderUpdateCalls) {
      expect(call.set).toMatchObject({ inventoryLabStatus: "GIRILDI" });
      expect(call.set).not.toHaveProperty("shippedToAmazon");
      expect(call.set).not.toHaveProperty("p2MissingQty");
      expect(call.set).not.toHaveProperty("cargoStatus");
      expect(call.set).not.toHaveProperty("pshStatus");
    }
    expect(h.state.batchUpdateCalls).toHaveLength(1);
    expect(h.state.batchUpdateCalls[0].set).toMatchObject({ inventoryLabSynced: true });
    expect(h.state.auditWrites).toHaveLength(1);
  });

  it("commit=true, yalnızca bazı siparişler eşleştiğinde batch inventoryLabSynced=true YAPMAZ", async () => {
    const res = await POST(
      makeRequest({ rows: [{ msku: "HRN-B001", quantity: 6 }], commit: true }), // HRN-B002 dosyada yok
      ctx
    );
    expect(res.status).toBe(200);
    expect(h.state.orderUpdateCalls).toHaveLength(1); // yalnızca eşleşen sipariş güncellendi
    expect(h.state.batchUpdateCalls).toHaveLength(0); // batch tam senkron değil
  });
});
