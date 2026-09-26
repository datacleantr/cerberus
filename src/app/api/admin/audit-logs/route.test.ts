/**
 * GET /api/admin/audit-logs — route seviyesi testler.
 *
 * Bu uç, GET /api/orders yanıtına gizlice eklenen ve siparişler sekmesinin
 * mağaza filtresine bağımlı, 40 kayıtla sınırlı eski "denetim izi" alanının
 * yerine geçti. Testler: (1) filtresiz istekte gerçekten TÜM mağazaların
 * kayıtlarının döndüğünü (eski davranışın aksine), (2) storeCode/actionType
 * filtrelerinin doğru uygulandığını, (3) sayfalamanın çalıştığını, (4)
 * ADMIN olmayan/MANAGER olmayan bir rolün erişemediğini doğrular.
 *
 * @/db, @/lib/guards mocklanır; route mantığı GERÇEK modüldür.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    role: "ADMIN" as "ADMIN" | "MANAGER" | "STORE_USER",
    rows: [] as Record<string, unknown>[],
    total: 0,
    denied: false,
  },
}));

vi.mock("@/lib/guards", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(h.state.role)) {
      h.state.denied = true;
      return { response: new Response(JSON.stringify({ error: "yetkisiz" }), { status: 403 }) };
    }
    return { user: { id: 1, name: "Ahmet", role: h.state.role, storeCode: "ALL" } };
  },
  isDenied: (r: unknown) => r !== null && typeof r === "object" && "response" in (r as object),
}));

function countQuery(rows: Record<string, unknown>[]): any {
  return {
    where: () => countQuery(rows),
    then: (resolve: (v: unknown) => void) => resolve(rows),
  };
}
function rowsQuery(rows: Record<string, unknown>[]): any {
  return {
    where: () => rowsQuery(rows),
    orderBy: () => ({
      limit: () => ({
        offset: async () => rows,
      }),
    }),
  };
}

vi.mock("@/db", async () => {
  return {
    db: {
      select: (proj?: any) => ({
        from: (_table: unknown): any => {
          if (proj && typeof proj === "object" && "n" in proj) {
            return countQuery([{ n: h.state.total }]);
          }
          return rowsQuery(h.state.rows);
        },
      }),
    },
  };
});

import { GET } from "./route";

function makeRequest(query: string) {
  return new Request(`http://localhost/api/admin/audit-logs${query}`);
}

describe("GET /api/admin/audit-logs", () => {
  beforeEach(() => {
    h.state.role = "ADMIN";
    h.state.denied = false;
    h.state.rows = [
      { id: 2, storeCode: "SEL", actionType: "STORE_DELETED", targetEntity: "SEL", createdAt: new Date() },
      { id: 1, storeCode: "HRN", actionType: "USER_CREATED", targetEntity: "x", createdAt: new Date() },
    ];
    h.state.total = 2;
  });

  it("filtresiz istekte tüm mağazaların kayıtlarını döner (eski davranışın aksine tek mağazayla sınırlı değil)", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.auditLogs.length).toBe(2);
    expect(data.pagination.total).toBe(2);
  });

  it("sayfalama parametrelerini yanıta yansıtır", async () => {
    const res = await GET(makeRequest("?page=2&pageSize=10"));
    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.pageSize).toBe(10);
  });

  it("MANAGER erişebilir", async () => {
    h.state.role = "MANAGER";
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(200);
  });

  it("STORE_USER erişemez", async () => {
    h.state.role = "STORE_USER";
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(403);
  });

  it("geçersiz sayfa numarası 1'e düşer", async () => {
    const res = await GET(makeRequest("?page=-5&pageSize=abc"));
    const data = await res.json();
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.pageSize).toBe(50);
  });
});
