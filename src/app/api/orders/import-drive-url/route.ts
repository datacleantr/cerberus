import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { parseBody, driveUrlSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { readResponseBytesWithLimit } from "@/lib/httpSafety";
import { parseXlsMatrix } from "@/lib/xlsRowMapping";

function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  // Direct id fallback
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, driveUrlSchema);
    if ("response" in parsed) return parsed.response;
    const { driveUrl, defaultStore: requestedStore = "HRN" } = parsed.data;
    const defaultStore = resolveStoreScope(currentUser, requestedStore);

    const sheetId = extractSpreadsheetId(driveUrl);
    if (!sheetId) {
      return NextResponse.json(
        {
          error:
            "Geçerli bir Google E-Tablo ID'si bulunamadı. Lütfen https://docs.google.com/spreadsheets/d/... linkini girin.",
        },
        { status: 400 }
      );
    }

    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

    // T3.4: 15 sn timeout + 50 MB içerik üst sınırı (DoS/kaynak tüketimi koruması)
    const MAX_DRIVE_BYTES = 50 * 1024 * 1024;
    const fetchResponse = await fetch(exportUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Cerberus Commerce Intelligence Bot)",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!fetchResponse.ok) {
      return NextResponse.json(
        {
          error:
            "Google Drive tablosuna erişilemedi. Lütfen tablonun paylaşım ayarlarından 'Bağlantıya sahip olan herkes görüntüleyebilir' seçili olduğuna emin olun.",
        },
        { status: 403 }
      );
    }

    const contentLength = Number(fetchResponse.headers.get("content-length") || "0");
    if (contentLength > MAX_DRIVE_BYTES) {
      return NextResponse.json(
        { error: "Google E-Tablo dosyası çok büyük (üst sınır 50 MB)." },
        { status: 413 }
      );
    }

    // Content-Length eksik/yanlış olabilir; akışı okurken de üst sınırı uygula.
    let bytes: Uint8Array;
    try {
      bytes = await readResponseBytesWithLimit(fetchResponse, MAX_DRIVE_BYTES);
    } catch {
      return NextResponse.json(
        { error: "Google E-Tablo dosyası çok büyük (üst sınır 50 MB)." },
        { status: 413 }
      );
    }
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    // Read as 2D array
    const rawMatrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });

    if (!rawMatrix || rawMatrix.length < 2) {
      return NextResponse.json(
        { error: "Google E-Tabloda içe aktarılacak satır bulunamadı." },
        { status: 400 }
      );
    }

    // First row is headers
    const headers = rawMatrix[0].map((h: any) => String(h || "").trim());
    const parsedRows = parseXlsMatrix(rawMatrix, {
      defaultStore,
      defaultProductTitle: "Google Drive Ürünü",
      defaultDriveLink: driveUrl,
    });

    return NextResponse.json({
      message: `Google Drive tablosundan (${firstSheetName}) ${parsedRows.length} adet sipariş ayrıştırıldı.`,
      headers,
      rows: parsedRows,
    });
  } catch (error: unknown) {
    return handleRouteError("POST /api/orders/import-drive-url", error);
  }
}
