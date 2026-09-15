import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  isRevokedLegacyPassword,
} from "@/lib/passwords";
import { createSessionToken, verifySessionToken } from "@/lib/session";
import { checkRateLimit, clearRateLimit } from "@/lib/rateLimit";

describe("Parola katmanı (F-03/F-04)", () => {
  it("hash bcrypt formatında ve doğrulanabilir", async () => {
    const hash = await hashPassword("gizli-parola-123");
    expect(isBcryptHash(hash)).toBe(true);
    expect(hash).not.toContain("gizli");
    expect((await verifyPassword("gizli-parola-123", hash)).ok).toBe(true);
    expect((await verifyPassword("yanlis", hash)).ok).toBe(false);
  });

  it("aynı parola iki kez hash'lenince farklı tuz üretir", async () => {
    const h1 = await hashPassword("ayni-parola-456");
    const h2 = await hashPassword("ayni-parola-456");
    expect(h1).not.toBe(h2);
  });

  it("legacy düz metin kayıt doğrulanır VE yükseltme işaretlenir", async () => {
    const r = await verifyPassword("eskiDuzMetin99", "eskiDuzMetin99");
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(true);
  });

  it("legacy düz metinde timing'e bakılmaksızın yanlış parola reddedilir", async () => {
    const r = await verifyPassword("baska-parola", "eskiDuzMetin99");
    expect(r.ok).toBe(false);
  });

  it("iptal edilmiş demo parolaları kalıcı olarak bloklu", () => {
    for (const p of ["admin2026", "store2026", "cerberus2026"]) {
      expect(isRevokedLegacyPassword(p)).toBe(true);
    }
    expect(isRevokedLegacyPassword("GucluY3niParola!")).toBe(false);
  });
});

describe("Oturum katmanı (F-01/F-06)", () => {
  const ORIGINAL_ENV = process.env.SESSION_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = "test-secret-key-must-be-at-least-32-chars-long!!";
  });
  afterAll(() => {
    process.env.SESSION_SECRET = ORIGINAL_ENV;
  });

  const user = {
    id: 7,
    name: "Test Kullanıcı",
    email: "t@cerberus.io",
    role: "STORE_USER" as const,
    storeCode: "HRN",
    avatar: "TK",
  };

  it("imzalı token üretir ve doğrular", async () => {
    const token = await createSessionToken(user, "test-auth-version");
    expect(token).toBeTruthy();
    const back = await verifySessionToken(token!);
    expect(back?.id).toBe(7);
    expect(back?.role).toBe("STORE_USER");
    expect(back?.storeCode).toBe("HRN");
  });

  it("kurcalanmış token reddedilir (imza doğrulaması)", async () => {
    const token = (await createSessionToken(user, "test-auth-version"))!;
    const parts = token.split(".");
    // payload'ı kurcala: rolü ADMIN yap
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), role: "ADMIN" })
    ).toString("base64url");
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("yanlış secret ile imzalanmış token reddedilir", async () => {
    const token = (await createSessionToken(user, "test-auth-version"))!;
    process.env.SESSION_SECRET = "baska-secret-key-must-be-at-least-32-chars!!";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("eski format (base64-JSON) çerez reddedilir", async () => {
    const legacy = Buffer.from(JSON.stringify(user)).toString("base64");
    expect(await verifySessionToken(legacy)).toBeNull();
  });

  it("bilinmeyen rol içeren token reddedilir", async () => {
    const token = await createSessionToken({ ...user, role: "SUPERADMIN" as any }, "test-auth-version");
    expect(await verifySessionToken(token!)).toBeNull();
  });
});

describe("Rate limiting (F-07)", () => {
  it("limit dolana kadar izin verir, sonra 429'lar", () => {
    const key = "test-login-1";
    clearRateLimit(key);
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("clear sonrası sayaç sıfırlanır", () => {
    const key = "test-login-2";
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60_000);
    clearRateLimit(key);
    expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
  });

  it("farklı anahtarlar birbirini etkilemez", () => {
    const keyA = "test-login-3a";
    clearRateLimit(keyA);
    for (let i = 0; i < 3; i++) checkRateLimit(keyA, 3, 60_000);
    expect(checkRateLimit("test-login-3b", 3, 60_000).allowed).toBe(true);
  });
});
