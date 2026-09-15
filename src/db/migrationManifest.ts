/**
 * Readiness'in beklediği migration head'i.
 * Yeni migration üretildiğinde bu değerler aynı PR'da güncellenmelidir;
 * migrationManifest.test.ts journal ve SQL hash'iyle drift'i yakalar.
 */
export const MIGRATION_MANIFEST = {
  count: 8,
  latestTag: "0007_icy_payback",
  latestHash: "7bc6bb4de2f75779d6081aa1f1a4a1855ac13ab9db7e1fff620dae5b8471b5cd",
} as const;
