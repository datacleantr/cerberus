import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createAuthVersion,
  createSessionToken,
  isSessionRole,
} from "@/lib/session";
import { hashPassword, isRevokedLegacyPassword, verifyPassword } from "@/lib/passwords";
import { checkRateLimit, clearRateLimit } from "@/lib/rateLimit";
import { parseBody, loginSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { log } from "@/lib/logger";

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  try {
    // Zod doğrulama (T3.1): format/uzunluk kuralları şemada merkezileşti
    const parsed = await parseBody(req, loginSchema);
    if ("response" in parsed) return parsed.response;
    const cleanEmail = parsed.data.email;
    const cleanPassword = parsed.data.password.trim();

    // Brute-force koruması (F-07): IP+hesap 5/15dk, IP geneli 30/15dk
    const ip = getClientIp(req);
    const accountKey = `login:${ip}:${cleanEmail}`;
    const ipKey = `login-ip:${ip}`;
    const accountLimit = checkRateLimit(accountKey, 5, 15 * 60_000);
    const ipLimit = checkRateLimit(ipKey, 30, 15 * 60_000);
    if (!accountLimit.allowed || !ipLimit.allowed) {
      return NextResponse.json(
        { error: "Çok fazla başarısız deneme. Lütfen bir süre sonra tekrar deneyin." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(accountLimit.retryAfterSec, ipLimit.retryAfterSec)),
          },
        }
      );
    }

    const matched = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    // Kullanıcı sayımını (enumeration) önlemek için tek generic mesaj
    const genericFailure = NextResponse.json(
      { error: "E-posta veya parola hatalı." },
      { status: 401 }
    );

    if (!matched.length) {
      return genericFailure;
    }

    const user = matched[0];
    if (!isSessionRole(user.role)) {
      log.error("auth/login", "Kullanıcı kaydında desteklenmeyen rol", {
        userId: user.id,
        role: user.role,
      });
      return genericFailure;
    }

    // Repoda yayınlanmış eski demo parolaları kalıcı olarak iptal (F-04)
    if (isRevokedLegacyPassword(cleanPassword)) {
      return NextResponse.json(
        {
          error:
            "Bu parola güvenlik gerekçesiyle iptal edilmiştir. Lütfen sistem yöneticinizden yeni bir parola isteyin.",
        },
        { status: 401 }
      );
    }

    const verification = await verifyPassword(cleanPassword, user.passwordHash);
    if (!verification.ok) {
      return genericFailure;
    }

    // Geçiş penceresi (F-03): düz metin kayıt başarılı giriş anında bcrypt'e yükseltilir
    let effectivePasswordHash = user.passwordHash;
    if (verification.needsUpgrade) {
      try {
        const upgradedHash = await hashPassword(cleanPassword);
        await db
          .update(users)
          .set({ passwordHash: upgradedHash })
          .where(eq(users.id, user.id));
        effectivePasswordHash = upgradedHash;
      } catch (upgradeErr) {
        log.warn("auth/login", "Legacy parola hash yükseltmesi başarısız (ertelendi)", { err: String(upgradeErr) });
      }
    }

    clearRateLimit(accountKey);

    const token = await createSessionToken(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeCode: user.storeCode || "HRN",
        avatar: user.avatar,
      },
      await createAuthVersion(effectivePasswordHash)
    );

    if (!token) {
      return NextResponse.json(
        { error: "Oturum altyapısı yapılandırılamadı (SESSION_SECRET). Yöneticiyle iletişime geçin." },
        { status: 500 }
      );
    }

    // Yanıtta kritik alan yok; id/name/role UI için yeterli
    const res = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeCode: user.storeCode || "HRN",
        avatar: user.avatar,
      },
      message: `${user.name} olarak başarıyla giriş yapıldı.`,
    });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });

    return res;
  } catch (error: unknown) {
    return handleRouteError("POST /api/auth/login", error);
  }
}
