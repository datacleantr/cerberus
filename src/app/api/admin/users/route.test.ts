/**
 * DELETE /api/admin/users — route seviyesi testler.
 *
 * Admin panelinde eksik olan kullanıcı silme işlemi eklendi (kullanıcı
 * talebi). `users` tablosuna hiçbir tablo FK ile referans vermiyor, bu
 * yüzden gerçek silme güvenli — ama iki guard mutlaka doğru çalışmalı:
 * (1) aktif oturumdaki yönetici kendini silemez, (2) sistemdeki son ADMIN
 * silinemez. Bu testler tam olarak bunları doğrular.
 *
 * @/db, @/lib/guards mocklanır; zod şeması ve route mantığı GERÇEK modüllerdir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    currentUserId: 1,
    targetUser: null as Record<string, unknown> | null,
    adminCount: 2,
    deleteCalls: [] as Array<{ where: unknown }>,
    auditWrites: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/lib/guards", () => ({
  requireRole: async () => ({
    user: { id: h.state.currentUserId, name: "Ahmet", email: "a@x.io", role: "ADMIN", storeCode: "ALL", avatar: "A" },
  }),
  isDenied: () => false,
}));

vi.mock("@/db", async () => {
  const { users } = await import("@/db/schema");

  return {
    db: {
      select: (proj?: any) => ({
        from: (table: any) => ({
          where: (_whereArg: unknown): any => {
            // count() sorgusu (adminCount kontrolü) — proj varlığıyla ayırt ediyoruz
            if (proj && typeof proj === "object" && "adminCount" in proj) {
              return Promise.resolve([{ adminCount: h.state.adminCount }]);
            }
            return {
              limit: async () => (table === users && h.state.targetUser ? [h.state.targetUser] : []),
            };
          },
        }),
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
  return new Request("http://localhost/api/admin/users", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/admin/users", () => {
  beforeEach(() => {
    h.state.currentUserId = 1;
    h.state.targetUser = {
      id: 2,
      name: "Ayşe",
      email: "ayse@x.io",
      role: "STORE_USER",
      storeCode: "HRN",
    };
    h.state.adminCount = 2;
    h.state.deleteCalls = [];
    h.state.auditWrites = [];
  });

  it("hedef kullanıcı varsa ve guard'lar geçerse kalıcı olarak siler", async () => {
    const res = await DELETE(makeRequest({ id: 2 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain("Ayşe");
    expect(h.state.deleteCalls.length).toBe(1);
    expect(h.state.auditWrites[0].actionType).toBe("USER_DELETED");
  });

  it("kullanıcı bulunamazsa 404 döner", async () => {
    h.state.targetUser = null;
    const res = await DELETE(makeRequest({ id: 999 }));
    expect(res.status).toBe(404);
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("aktif oturumdaki yönetici kendini silemez", async () => {
    h.state.targetUser = { id: 1, name: "Ahmet", email: "a@x.io", role: "ADMIN", storeCode: "ALL" };
    const res = await DELETE(makeRequest({ id: 1 }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("kendi hesabını silemez");
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("sistemdeki son ADMIN silinemez", async () => {
    h.state.targetUser = { id: 2, name: "Diğer Admin", email: "b@x.io", role: "ADMIN", storeCode: "ALL" };
    h.state.adminCount = 1;
    const res = await DELETE(makeRequest({ id: 2 }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("son ADMIN");
    expect(h.state.deleteCalls.length).toBe(0);
  });

  it("2 veya daha fazla ADMIN varsa bir ADMIN silinebilir", async () => {
    h.state.targetUser = { id: 2, name: "Diğer Admin", email: "b@x.io", role: "ADMIN", storeCode: "ALL" };
    h.state.adminCount = 2;
    const res = await DELETE(makeRequest({ id: 2 }));
    expect(res.status).toBe(200);
    expect(h.state.deleteCalls.length).toBe(1);
  });
});
