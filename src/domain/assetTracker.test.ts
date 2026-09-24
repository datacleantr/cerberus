import { describe, it, expect } from "vitest";
import { computeAssetStatus, computeAssetBoard, type AssetFact } from "./assetTracker";

const NOW = new Date("2026-09-25T00:00:00.000Z");

function makeAsset(overrides: Partial<AssetFact>): AssetFact {
  return {
    id: 1,
    storeCode: "HRN",
    assetType: "SUBSCRIPTION",
    name: "ASINZEN",
    provider: "ASINZEN",
    url: null,
    expiresAt: null,
    renewalCost: null,
    notes: null,
    lastCheckedAt: null,
    lastCheckedBy: null,
    ...overrides,
  };
}

describe("computeAssetStatus", () => {
  it("expiresAt yoksa NOT_TRACKED döner, uydurma 'aktif' üretmez", () => {
    const result = computeAssetStatus(makeAsset({ expiresAt: null }), NOW);
    expect(result.status).toBe("NOT_TRACKED");
    expect(result.daysUntilExpiry).toBeNull();
  });

  it("geçersiz tarih string'i NOT_TRACKED olarak ele alınır", () => {
    const result = computeAssetStatus(makeAsset({ expiresAt: "not-a-date" }), NOW);
    expect(result.status).toBe("NOT_TRACKED");
  });

  it("süresi geçmişse EXPIRED ve negatif gün sayısı döner", () => {
    const result = computeAssetStatus(
      makeAsset({ expiresAt: "2026-09-01T00:00:00.000Z" }),
      NOW
    );
    expect(result.status).toBe("EXPIRED");
    expect(result.daysUntilExpiry).toBeLessThan(0);
  });

  it("14 gün içinde doluyorsa EXPIRING_SOON döner", () => {
    const result = computeAssetStatus(
      makeAsset({ expiresAt: "2026-10-02T00:00:00.000Z" }),
      NOW
    );
    expect(result.status).toBe("EXPIRING_SOON");
    expect(result.daysUntilExpiry).toBeLessThanOrEqual(14);
  });

  it("14 günden uzun süre kaldıysa ACTIVE döner", () => {
    const result = computeAssetStatus(
      makeAsset({ expiresAt: "2027-01-01T00:00:00.000Z" }),
      NOW
    );
    expect(result.status).toBe("ACTIVE");
  });
});

describe("computeAssetBoard", () => {
  it("EXPIRED > EXPIRING_SOON > ACTIVE > NOT_TRACKED sırasıyla döner", () => {
    const assets: AssetFact[] = [
      makeAsset({ id: 1, name: "Aktif", expiresAt: "2027-01-01T00:00:00.000Z" }),
      makeAsset({ id: 2, name: "Takipsiz", expiresAt: null }),
      makeAsset({ id: 3, name: "Süresi Geçmiş", expiresAt: "2026-08-01T00:00:00.000Z" }),
      makeAsset({ id: 4, name: "Yakında Dolacak", expiresAt: "2026-10-01T00:00:00.000Z" }),
    ];
    const board = computeAssetBoard(assets, NOW);
    expect(board.map((a) => a.name)).toEqual([
      "Süresi Geçmiş",
      "Yakında Dolacak",
      "Aktif",
      "Takipsiz",
    ]);
  });
});
