/**
 * Readiness'in beklediği migration head'i.
 * Yeni migration üretildiğinde bu değerler aynı PR'da güncellenmelidir;
 * migrationManifest.test.ts journal ve SQL hash'iyle drift'i yakalar.
 */
export const MIGRATION_MANIFEST = {
  count: 12,
  latestTag: "0011_massive_wonder_man",
  latestHash: "791d364463103fa2264fd25cec9e4d623ec998a0925dec0bf8144c22b1edeb14",
} as const;
