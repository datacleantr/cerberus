/**
 * POST /api/orders/import-drive-url — route seviyesi testler.
 *
 * Bu uç eskiden Google Drive'dan çektiği tabloyu KENDİSİ pozisyonel olarak
 * eşleyip hazır `rows` döndürürdü. Artık kolon eşleme kararını istemciye
 * (GoogleDriveXlsImportModal.tsx) bırakıyor — ham matrisi (`rawMatrix`) ve
 * başlıkları (`headers`) olduğu gibi döner, böylece dosya yükleme ve
 * yapıştırma yollarıyla AYNI tek eşleme motoru kullanılır. Bu testler yeni
 * sözleşmeyi (rawMatrix + headers, rows YOK) doğrular.
 *
 * @/lib/guards mocklanır; gerçek Google Drive'a ağ isteği global `fetch`
 * mock'lanarak engellenir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/guards", () => ({
  requireUser: async () => ({
    user: { id: 1, name: "Ahmet", role: "ADMIN", storeCode: "ALL" },
  }),
  isDenied: (r: unknown) => r !== null && typeof r === "object" && "response" in (r as object),
  resolveStoreScope: (_user: unknown, requested?: string | null) => requested || "ALL",
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/orders/import-drive-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_FETCH = global.fetch;

describe("POST /api/orders/import-drive-url", () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("ham matrisi ve başlıkları döner — artık kendi rows üretmiyor", async () => {
    const fakeXlsxBytes = await buildFakeXlsxBuffer([
      ["Store", "ASIN", "Qty"],
      ["HRN", "B0TEST0001", 5],
    ]);
    global.fetch = vi.fn(async () =>
      new Response(new Blob([fakeXlsxBytes as unknown as BlobPart]), {
        status: 200,
        headers: { "content-length": String(fakeXlsxBytes.byteLength) },
      })
    ) as unknown as typeof fetch;

    const res = await POST(
      makeRequest({
        driveUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit",
        defaultStore: "HRN",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows).toBeUndefined();
    expect(data.headers).toEqual(["Store", "ASIN", "Qty"]);
    expect(data.rawMatrix).toHaveLength(2);
    expect(data.rawMatrix[1]).toEqual(["HRN", "B0TEST0001", 5]);
  });

  it("geçersiz Drive linkinde 400 döner", async () => {
    // 20 karakterden kısa ve "/d/" içermeyen bir metin: extractSpreadsheetId
    // hiçbir sheetId çıkaramaz (20+ karakterlik ham-id fallback'i de devreye girmez).
    const res = await POST(makeRequest({ driveUrl: "kisa gecersiz link", defaultStore: "HRN" }));
    expect(res.status).toBe(400);
  });

  it("Drive'a erişilemezse 403 döner", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const res = await POST(
      makeRequest({ driveUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit" })
    );
    expect(res.status).toBe(403);
  });
});

/** xlsx kütüphanesiyle basit bir çalışma kitabını Uint8Array'e yazar (test yardımcı fonksiyonu). */
async function buildFakeXlsxBuffer(matrix: unknown[][]): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out);
}
