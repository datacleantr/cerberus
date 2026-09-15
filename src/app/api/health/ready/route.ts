import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { log } from "@/lib/logger";
import { MIGRATION_MANIFEST } from "@/db/migrationManifest";

/**
 * T6.3 — Derin sağlık kontrolü (readiness): uptime sistemleri /api/health'i,
 * gerçek "trafiğe hazır mı?" kontrolünü bu ucu çağırır.
 *
 * 2026-09-06: "veritabanı kurulu mu?" sorusu artık bu uçtan, giriş yapmadan
 * görülebilir. Eski hâli yalnızca `SELECT 1` yapıyordu; Neon erişilebilir ama
 * migration/seed uygulanmamış olsa bile "ready" diyordu. Artık:
 *   - migration sayısı ve son migration hash'i kodun beklediği head ile eşleşiyor mu
 *   - seed var mı (users > 0 && stores > 0)
 *   - ürüne bağlanmamış (yetim) sipariş var mı
 * bilgileri `checks` + `detail` altında raporlanır. Şema eksikse 500 değil,
 * ilgili kontrol false döner; hata detayları yalnız sunucu loguna yazılır.
 */

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const r = (result as { rows?: unknown })?.rows;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
}

async function countOf(query: string): Promise<number | null> {
  try {
    const rows = rowsOf(await db.execute(sql.raw(query)));
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null; // tablo yok veya sorgu başarısız
  }
}

export async function GET() {
  const checks: Record<string, boolean> = {
    database: false,
    sessionSecretConfigured:
      !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32,
    migrationsApplied: false,
    seedPresent: false,
    orderProductIntegrity: false,
  };

  const detail: Record<string, unknown> = {
    migrations: null,
    expectedMigrations: MIGRATION_MANIFEST.count,
    migrationHead: null,
    expectedMigrationHead: MIGRATION_MANIFEST.latestTag,
    expectedMigrationHash: MIGRATION_MANIFEST.latestHash,
    users: null,
    stores: null,
    orders: null,
    orphanOrders: null,
  };

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch (error) {
    log.error("GET /api/health/ready", "Readiness DB kontrolü başarısız", error);
  }

  if (checks.database) {
    try {
      const applied = await countOf(
        "select count(*)::int as n from drizzle.__drizzle_migrations"
      );
      const headRows = rowsOf(
        await db.execute(
          sql.raw(
            "select hash from drizzle.__drizzle_migrations order by created_at desc limit 1"
          )
        )
      );
      const appliedHead = String(headRows[0]?.hash ?? "");
      detail.migrations = applied;
      detail.migrationHead = appliedHead || null;
      checks.migrationsApplied =
        applied === MIGRATION_MANIFEST.count &&
        appliedHead === MIGRATION_MANIFEST.latestHash;
    } catch (error) {
      log.error("GET /api/health/ready", "Migration kontrolü başarısız", error);
    }

    detail.users = await countOf("select count(*)::int as n from users");
    detail.stores = await countOf("select count(*)::int as n from stores");
    detail.orders = await countOf("select count(*)::int as n from orders");
    detail.orphanOrders = await countOf(
      "select count(*)::int as n from orders where product_id is null"
    );

    checks.seedPresent =
      Number(detail.users ?? 0) > 0 && Number(detail.stores ?? 0) > 0;
    checks.orderProductIntegrity =
      detail.orphanOrders !== null && Number(detail.orphanOrders) === 0;
  }

  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { ready, checks, detail, timestamp: new Date().toISOString() },
    { status: ready ? 200 : 503 }
  );
}
