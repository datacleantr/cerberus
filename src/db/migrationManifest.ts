/**
 * Readiness'in beklediği migration head'i.
 * Yeni migration üretildiğinde bu değerler aynı PR'da güncellenmelidir;
 * migrationManifest.test.ts journal ve SQL hash'iyle drift'i yakalar.
 */
export const MIGRATION_MANIFEST = {
  count: 10,
  latestTag: "0009_dapper_kronos",
  latestHash: "8807a0a981e0d7df942b96adb454352b6dc7aeafc826fecd3338789853f058b4",
} as const;
