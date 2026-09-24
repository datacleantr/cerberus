/**
 * Readiness'in beklediği migration head'i.
 * Yeni migration üretildiğinde bu değerler aynı PR'da güncellenmelidir;
 * migrationManifest.test.ts journal ve SQL hash'iyle drift'i yakalar.
 */
export const MIGRATION_MANIFEST = {
  count: 9,
  latestTag: "0008_previous_tiger_shark",
  latestHash: "ba00e8afa72a4dc6631426c6b44baf426585fa7ab3c78d3fa14c69fc7d0f23e2",
} as const;
