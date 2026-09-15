import { SignJWT, jwtVerify } from "jose";
import { logger } from "@/lib/logger";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "STORE_USER";
  storeCode: string; // 'ALL' or specific like 'HRN'
  avatar?: string | null;
}

export interface SessionClaims extends SessionUser {
  /** Password-hash fingerprint; password reset immediately revokes old JWTs. */
  authVersion: string;
}

export const SESSION_COOKIE = "cerberus_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 saat (kaydırmalı yenileme Faz 6'da)

const ALLOWED_ROLES: ReadonlyArray<SessionUser["role"]> = ["ADMIN", "MANAGER", "STORE_USER"];

export function isSessionRole(value: string): value is SessionUser["role"] {
  return ALLOWED_ROLES.includes(value as SessionUser["role"]);
}

// YALNIZCA lokal geliştirme içindir. Üretimde (NODE_ENV=production) SESSION_SECRET
// zorunludur; eksikse oturumlar fail-closed olarak tamamen devre dışı kalır.
const DEV_ONLY_SECRET = "cerberus-dev-only-insecure-secret-do-not-use-in-prod!!";

function getSecretKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    logger.error(
      "[CERBERUS][SECURITY] SESSION_SECRET eksik veya 32 karakterden kısa. Üretimde zorunlu; tüm oturumlar reddedilecek (fail-closed)."
    );
    return null;
  }
  return new TextEncoder().encode(DEV_ONLY_SECRET);
}

export async function createAuthVersion(passwordHash: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passwordHash));
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Oturum için imzalı JWT (HS256) üretir.
 * Önceki base64-JSON çerezinin aksine içerik kurcalanamaz ve 8 saatte sona erer.
 * SESSION_SECRET üretimde tanımsızsa null döner (route 500 döner, kullanıcı açığa çıkmaz).
 */
export async function createSessionToken(
  user: SessionUser,
  authVersion: string
): Promise<string | null> {
  const key = getSecretKey();
  if (!key) return null;

  return new SignJWT({
    name: user.name,
    email: user.email,
    role: user.role,
    storeCode: user.storeCode,
    avatar: user.avatar ?? null,
    authVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuer("cerberus-auth")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

/**
 * İmzayı ve süreyi doğrular; herhangi bir hata/eksikte null döner.
 * Eski (base64-JSON) çerezler doğal olarak reddedilir.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const key = getSecretKey();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(token, key, { issuer: "cerberus-auth" });
    const id = Number(payload.sub);
    const role = payload.role as SessionUser["role"];
    const authVersion = String(payload.authVersion ?? "");
    if (!Number.isFinite(id) || !ALLOWED_ROLES.includes(role) || !authVersion) return null;

    return {
      id,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      role,
      storeCode: String(payload.storeCode ?? ""),
      avatar: (payload.avatar as string | null) ?? null,
      authVersion,
    };
  } catch {
    return null;
  }
}
