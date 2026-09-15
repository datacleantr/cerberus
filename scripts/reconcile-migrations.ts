import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

const MIGRATIONS_FOLDER = "drizzle";
const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL tanımlı değil.");
}

interface LedgerRow {
  hash: string;
  created_at: string;
}

type EffectState = "applied" | "absent" | "partial";

async function relationExists(pool: Pool, name: string): Promise<boolean> {
  const result = await pool.query<{ relation: string | null }>(
    "select to_regclass($1) as relation",
    [`public.${name}`]
  );
  return Boolean(result.rows[0]?.relation);
}

async function migrationEffectState(
  pool: Pool,
  index: number
): Promise<EffectState> {
  if (index === 4) {
    const [newIndex, oldIndex, oldConstraintResult] = await Promise.all([
      relationExists(pool, "orders_order_number_store_asin_uq"),
      relationExists(pool, "orders_order_number_store_uq"),
      pool.query<{ exists: boolean }>(
        "select exists(select 1 from pg_constraint where conname = 'orders_cargo_status_enum') as exists"
      ),
    ]);
    const oldConstraint = Boolean(oldConstraintResult.rows[0]?.exists);
    if (newIndex && !oldIndex && !oldConstraint) return "applied";
    if (!newIndex && (oldIndex || oldConstraint)) return "absent";
    return "partial";
  }

  if (index === 5) {
    const objects = [
      "keepa_cache",
      "scrape_jobs",
      "scraped_products",
      "keepa_cache_asin_domain_uq",
      "keepa_cache_expires_idx",
      "keepa_cache_sales_rank_idx",
      "scrape_jobs_domain_idx",
      "scrape_jobs_store_idx",
      "scraped_products_job_idx",
      "scraped_products_domain_idx",
      "scraped_products_status_idx",
    ];
    const states = await Promise.all(objects.map((name) => relationExists(pool, name)));
    if (states.every(Boolean)) return "applied";
    if (states.every((value) => !value)) return "absent";
    return "partial";
  }

  if (index === 6) {
    return (await relationExists(pool, "app_settings")) ? "applied" : "absent";
  }

  if (index === 7) {
    const result = await pool.query<{ table_name: string; column_default: string | null }>(
      `select table_name, column_default
       from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('orders', 'credit_card'), ('stores', 'default_card'))
       order by table_name`
    );
    if (result.rows.length !== 2) return "partial";
    const dropped = result.rows.map((row) => row.column_default === null);
    if (dropped.every(Boolean)) return "applied";
    if (dropped.every((value) => !value)) return "absent";
    return "partial";
  }

  // Unknown future migrations are never guessed/backfilled; the normal
  // migrator must apply them.
  return "absent";
}

async function repairKnownEffect(pool: Pool, index: number): Promise<boolean> {
  if (index !== 4) return false;

  // 0004 is intentionally safe to replay: the old two-column uniqueness is
  // stricter than the new three-column key, so existing rows cannot collide.
  await pool.query(
    'alter table "orders" drop constraint if exists "orders_cargo_status_enum"'
  );
  await pool.query('drop index if exists "orders_order_number_store_uq"');
  await pool.query(
    'create unique index if not exists "orders_order_number_store_asin_uq" on "orders" ("order_number", "buyer_store", "asin")'
  );
  return true;
}

async function ensureLedger(pool: Pool): Promise<void> {
  await pool.query("create schema if not exists drizzle");
  await pool.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await ensureLedger(pool);
    const migrations: MigrationMeta[] = readMigrationFiles({
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    const ledger = await pool.query<LedgerRow>(
      "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at, id"
    );

    if (ledger.rows.length > migrations.length) {
      throw new Error(
        `DB migration ledger (${ledger.rows.length}) koddan (${migrations.length}) ileride.`
      );
    }

    for (let index = 0; index < ledger.rows.length; index += 1) {
      if (ledger.rows[index].hash !== migrations[index].hash) {
        throw new Error(
          `Migration hash uyuşmazlığı: ledger satırı ${index}. Otomatik işlem durduruldu.`
        );
      }
    }

    console.log(
      `Migration audit: DB=${ledger.rows.length}, code=${migrations.length}, mode=${apply ? "apply" : "dry-run"}`
    );

    let reconciled = ledger.rows.length;
    while (reconciled < migrations.length) {
      let state = await migrationEffectState(pool, reconciled);
      console.log(`Migration ${reconciled}: schema effect=${state}`);

      if (state === "absent" && apply) {
        await pool.query("begin");
        try {
          await pool.query("select pg_advisory_xact_lock($1)", [741_304_2026]);
          const repaired = await repairKnownEffect(pool, reconciled);
          if (!repaired) {
            await pool.query("rollback");
            break;
          }
          state = await migrationEffectState(pool, reconciled);
          if (state !== "applied") {
            throw new Error(`Migration ${reconciled} onarımı doğrulanamadı.`);
          }
          await pool.query("commit");
          console.log(`Migration ${reconciled}: bilinen şema etkisi onarıldı.`);
        } catch (error) {
          await pool.query("rollback");
          throw error;
        }
      }

      if (state === "partial") {
        throw new Error(
          `Migration ${reconciled} kısmen uygulanmış. Manuel inceleme olmadan ledger değiştirilmeyecek.`
        );
      }
      if (state === "absent") break;
      if (!apply) {
        reconciled += 1;
        continue;
      }

      const migration = migrations[reconciled];
      await pool.query("begin");
      try {
        await pool.query("select pg_advisory_xact_lock($1)", [741_304_2026]);
        const duplicate = await pool.query(
          "select 1 from drizzle.__drizzle_migrations where created_at = $1 or hash = $2 limit 1",
          [migration.folderMillis, migration.hash]
        );
        if (!duplicate.rowCount) {
          await pool.query(
            "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
            [migration.hash, migration.folderMillis]
          );
        }
        await pool.query("commit");
        console.log(`Migration ${reconciled}: doğrulanmış şema etkisi ledger'a işlendi.`);
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
      reconciled += 1;
    }

    if (!apply) {
      console.log("Dry-run tamamlandı; veritabanında değişiklik yapılmadı.");
      return;
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const finalLedger = await pool.query<{ count: string }>(
      "select count(*)::text as count from drizzle.__drizzle_migrations"
    );
    console.log(`Migration apply tamamlandı: ${finalLedger.rows[0]?.count} kayıt.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
