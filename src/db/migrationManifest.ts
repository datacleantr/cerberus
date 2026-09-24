/**
 * Readiness'in beklediği migration head'i.
 * Yeni migration üretildiğinde bu değerler aynı PR'da güncellenmelidir;
 * migrationManifest.test.ts journal ve SQL hash'iyle drift'i yakalar.
 */
export const MIGRATION_MANIFEST = {
  count: 11,
  latestTag: "0010_hot_lord_hawal",
  latestHash: "f5447ac47657768316589429d48728ff7a5aef1cc0c912cd70c78861815204ca",
} as const;
