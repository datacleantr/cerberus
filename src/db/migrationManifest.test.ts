import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATION_MANIFEST } from "./migrationManifest";

interface JournalEntry {
  idx: number;
  tag: string;
}

describe("migration readiness manifest", () => {
  it("Drizzle journal ve son SQL hash'iyle eşleşir", () => {
    const root = process.cwd();
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8")
    ) as { entries: JournalEntry[] };
    const latest = journal.entries.at(-1);

    expect(journal.entries).toHaveLength(MIGRATION_MANIFEST.count);
    expect(latest?.idx).toBe(MIGRATION_MANIFEST.count - 1);
    expect(latest?.tag).toBe(MIGRATION_MANIFEST.latestTag);

    const sql = readFileSync(
      resolve(root, `drizzle/${MIGRATION_MANIFEST.latestTag}.sql`)
    );
    const hash = createHash("sha256").update(sql).digest("hex");
    expect(hash).toBe(MIGRATION_MANIFEST.latestHash);
  });
});
