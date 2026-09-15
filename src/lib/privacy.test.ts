import { describe, it, expect } from "vitest";
import { maskOrderForRole, maskEmail, maskCreditCard, minimizeUsersForRole } from "@/lib/privacy";
import type { SessionUser } from "@/lib/session";

const admin: SessionUser = { id: 1, name: "A", email: "a@x.io", role: "ADMIN", storeCode: "ALL" };
const storeUser: SessionUser = { id: 2, name: "H", email: "h@x.io", role: "STORE_USER", storeCode: "HRN" };

describe("KVKK veri minimizasyonu (T7.2)", () => {
  it("kart son-4: ADMIN görür, STORE_USER göremez", () => {
    expect(maskOrderForRole({ creditCard: "1753" }, admin).creditCard).toBe("1753");
    expect(maskOrderForRole({ creditCard: "1753" }, storeUser).creditCard).toBe("••••");
  });

  it("e-posta: STORE_USER'a maskeli form döner", () => {
    const masked = maskOrderForRole({ orderEmail: "cerberusnisan@gmail.com" }, storeUser);
    expect(masked.orderEmail).toBe("c***@gmail.com");
    expect(masked.orderEmail).not.toContain("cerberusnisan");
  });

  it("maskeleme orijinal nesneyi değiştirmez (immutability)", () => {
    const original = { creditCard: "1753", orderEmail: "a@b.com" };
    maskOrderForRole(original, storeUser);
    expect(original.creditCard).toBe("1753");
  });

  it("maskEmail kenar durumlari", () => {
    expect(maskEmail("a@b.com")).toBe("a***@b.com");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("bozuk")).toBe("***");
  });

  it("maskCreditCard tanımlı değeri maskeler, eksik değer uydurmaz", () => {
    expect(maskCreditCard("9999")).toBe("••••");
    expect(maskCreditCard(null)).toBe("");
    expect(maskCreditCard(undefined)).toBe("");
  });

  it("kullanıcı listesi: ADMIN tam alir, STORE_USER minimal versiyon alir", () => {
    const list = [{ id: 5, name: "Selin", avatar: "SY", email: "selin@x.io", role: "STORE_USER" }];
    const adminView = minimizeUsersForRole(list, admin);
    expect((adminView[0] as any).email).toBe("selin@x.io");

    const storeView = minimizeUsersForRole(list, storeUser);
    expect(storeView[0]).not.toHaveProperty("email");
    expect(storeView[0].name).toBe("Selin");
  });
});
