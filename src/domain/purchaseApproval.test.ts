import { describe, it, expect } from "vitest";
import { evaluatePurchaseApproval, canResolveApproval } from "./purchaseApproval";

describe("evaluatePurchaseApproval", () => {
  it("eşik tanımlı değilse (null) her zaman AUTO_APPROVED döner", () => {
    const result = evaluatePurchaseApproval({ totalCost: 999999, creatorRole: "STORE_USER", threshold: null });
    expect(result.status).toBe("AUTO_APPROVED");
  });

  it("STORE_USER eşiği aşan bir sipariş girerse PENDING_APPROVAL döner", () => {
    const result = evaluatePurchaseApproval({ totalCost: 600, creatorRole: "STORE_USER", threshold: 500 });
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.reason).toContain("600.00");
    expect(result.reason).toContain("500.00");
  });

  it("STORE_USER eşiğin altında/eşit kalırsa AUTO_APPROVED döner", () => {
    expect(evaluatePurchaseApproval({ totalCost: 500, creatorRole: "STORE_USER", threshold: 500 }).status).toBe(
      "AUTO_APPROVED"
    );
    expect(evaluatePurchaseApproval({ totalCost: 100, creatorRole: "STORE_USER", threshold: 500 }).status).toBe(
      "AUTO_APPROVED"
    );
  });

  it("ADMIN eşiği aşsa bile kendi kendini onaylar (AUTO_APPROVED)", () => {
    const result = evaluatePurchaseApproval({ totalCost: 5000, creatorRole: "ADMIN", threshold: 500 });
    expect(result.status).toBe("AUTO_APPROVED");
  });

  it("MANAGER eşiği aşsa bile kendi kendini onaylar (AUTO_APPROVED)", () => {
    const result = evaluatePurchaseApproval({ totalCost: 5000, creatorRole: "MANAGER", threshold: 500 });
    expect(result.status).toBe("AUTO_APPROVED");
  });
});

describe("canResolveApproval", () => {
  it("yalnız PENDING_APPROVAL durumundaki bir sipariş onaylanabilir/reddedilebilir", () => {
    expect(canResolveApproval("PENDING_APPROVAL")).toBe(true);
    expect(canResolveApproval("AUTO_APPROVED")).toBe(false);
    expect(canResolveApproval("APPROVED")).toBe(false);
    expect(canResolveApproval("REJECTED")).toBe(false);
  });
});
