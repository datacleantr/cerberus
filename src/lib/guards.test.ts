import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/session";

vi.mock("@/lib/auth", () => {
  let currentUser: SessionUser | null = null;
  return {
    __setCurrentUser: (user: SessionUser | null) => {
      currentUser = user;
    },
    getCurrentUser: async () => currentUser,
  };
});

import * as authMock from "@/lib/auth";
import { requireUser, requireRole, resolveStoreScope, canAccessStore } from "@/lib/guards";

const storeUser: SessionUser = {
  id: 3,
  name: "Harun",
  email: "harun@cerberus-commerce.io",
  role: "STORE_USER",
  storeCode: "HRN",
  avatar: "HR",
};
const adminUser: SessionUser = {
  ...storeUser,
  id: 1,
  role: "ADMIN",
  storeCode: "ALL",
  name: "Ahmet",
};

describe("Yetki guard'ları (F-02/F-05/F-11)", () => {
  beforeEach(() => {
    (authMock as unknown as { __setCurrentUser: (user: SessionUser | null) => void })
      .__setCurrentUser(null);
  });

  it("oturum yoksa requireUser 401 döner", async () => {
    const gate = await requireUser();
    expect("response" in gate && gate.response.status).toBe(401);
  });

  it("geçerli oturumla requireUser kullanıcıyı döner", async () => {
    (authMock as unknown as { __setCurrentUser: (user: SessionUser) => void })
      .__setCurrentUser(storeUser);
    const gate = await requireUser();
    expect("user" in gate && gate.user.email).toBe(storeUser.email);
  });

  it("STORE_USER, ADMIN uçlarında 403 alır (requireRole)", async () => {
    (authMock as unknown as { __setCurrentUser: (user: SessionUser) => void })
      .__setCurrentUser(storeUser);
    const gate = await requireRole("ADMIN");
    expect("response" in gate && gate.response.status).toBe(403);
  });

  it("ADMIN, ADMIN uçlarından geçer", async () => {
    (authMock as unknown as { __setCurrentUser: (user: SessionUser) => void })
      .__setCurrentUser(adminUser);
    const gate = await requireRole("ADMIN");
    expect("user" in gate && gate.user.role).toBe("ADMIN");
  });

  it("mağaza kapsamı: STORE_USER istediği storeCode'u GÖNDERSE BİLE kilitlenir", () => {
    expect(resolveStoreScope(storeUser, "SEL")).toBe("HRN");
    expect(resolveStoreScope(storeUser, "ALL")).toBe("HRN");
    expect(resolveStoreScope(adminUser, "SEL")).toBe("SEL");
  });

  it("canAccessStore: STORE_USER yabancı mağazayı göremez, ADMIN hepsini görür", () => {
    expect(canAccessStore(storeUser, "HRN")).toBe(true);
    expect(canAccessStore(storeUser, "MK")).toBe(false);
    expect(canAccessStore(adminUser, "MK")).toBe(true);
  });
});
