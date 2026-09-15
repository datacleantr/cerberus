import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  createAuthVersion,
  isSessionRole,
  verifySessionToken,
} from "@/lib/session";
import type { SessionUser } from "@/lib/session";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type { SessionUser } from "@/lib/session";
export { SESSION_COOKIE };

export interface DefaultSystemUser {
  name: string;
  email: string;
  role: SessionUser["role"];
  storeCode: string;
  avatar: string;
}

/**
 * Varsayılan sistem kullanıcıları — PAROLA İÇERMEZ.
 * İlk parolalar seed sırasında SEED_ADMIN_PASSWORD / SEED_STORE_PASSWORD
 * ortam değişkenlerinden alınır ve bcrypt ile hash'lenerek saklanır.
 * (Eski `passwordHash: "admin2026"` alanı güvenlik audit'i F-03/F-04 kapsamında kaldırıldı.)
 */
export const DEFAULT_SYSTEM_USERS: DefaultSystemUser[] = [
  {
    name: "Ahmet Erdem (Sistem Yöneticisi)",
    email: "ahmet@cerberus-commerce.io",
    role: "ADMIN",
    storeCode: "ALL",
    avatar: "AE",
  },
  {
    name: "Harun (HRN Store Yöneticisi)",
    email: "harun@cerberus-commerce.io",
    role: "STORE_USER",
    storeCode: "HRN",
    avatar: "HRN",
  },
  {
    name: "Selin Yılmaz (SEL Store Yöneticisi)",
    email: "selin@cerberus-commerce.io",
    role: "STORE_USER",
    storeCode: "SEL",
    avatar: "SY",
  },
  {
    name: "Can Demir (MK Store Yöneticisi)",
    email: "can@cerberus-commerce.io",
    role: "STORE_USER",
    storeCode: "MK",
    avatar: "CD",
  },
  {
    name: "Mert Yılmaz",
    email: "mert@cerberus.io",
    role: "ADMIN",
    storeCode: "ALL",
    avatar: "MY",
  },
];

/**
 * İlk kurulum (bootstrap) parolası.
 * - ÜRETİM: env yoksa null döner → ilgili hesap seed EDİLMEZ (bilinen parolalı hesap açılmaz).
 * - GELİŞTİRME: yalnızca lokalde geçerli dev fallback parolaları döner.
 */
export function getBootstrapPassword(role: SessionUser["role"]): string | null {
  const isAdminSide = role === "ADMIN" || role === "MANAGER";
  const fromEnv = isAdminSide
    ? process.env.SEED_ADMIN_PASSWORD
    : process.env.SEED_STORE_PASSWORD;

  if (fromEnv && fromEnv.length >= 12) return fromEnv;

  if (process.env.NODE_ENV !== "production") {
    return isAdminSide ? "dev-admin-changeMe!!" : "dev-store-changeMe!!";
  }
  return null;
}

/**
 * İmzalı + süreli oturum çerezini doğrular, ardından hesabın güncel durumunu
 * veritabanından okur. Böylece kullanıcı silme, rol/mağaza değişikliği ve parola
 * sıfırlama mevcut JWT süresi dolmadan da yürürlüğe girer.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const [liveUser] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      storeCode: users.storeCode,
      avatar: users.avatar,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, claims.id))
    .limit(1);

  if (!liveUser || !isSessionRole(liveUser.role)) return null;
  if ((await createAuthVersion(liveUser.passwordHash)) !== claims.authVersion) return null;

  return {
    id: liveUser.id,
    name: liveUser.name,
    email: liveUser.email,
    role: liveUser.role,
    storeCode: liveUser.storeCode,
    avatar: liveUser.avatar,
  };
}
