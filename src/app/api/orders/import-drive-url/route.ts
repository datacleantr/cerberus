import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { parseBody, driveUrlSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { readResponseBytesWithLimit } from "@/lib/httpSafety";
import { excelCellToDateStr } from "@/lib/excelDate";

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
    const dataRows = rawMatrix.slice(1);

    const parsedRows = [];

    for (const cols of dataRows) {
      if (!cols || cols.length < 3) continue;
      const productTitle = String(cols[4] || cols[2] || "").trim();
      const orderNumber = String(cols[11] || cols[5] || "").trim();
      if (!productTitle && !orderNumber) continue;

      parsedRows.push({
        buyerStore: String(cols[0] || defaultStore).trim() || defaultStore,
        orderDate: excelCellToDateStr(cols[1]) || new Date().toISOString().split("T")[0],
        imageUrl: String(cols[2] || "").trim(),
        fulfillmentType: String(cols[3] || "FBA").trim(),
        productTitle: productTitle || "Google Drive Ürünü",
        asin: String(cols[5] || "").trim().toUpperCase(),
        msku: String(cols[6] || "").trim(),
        supplierName: String(cols[7] || "THE VITAMINSHOPPE").trim(),
        supplierCode: String(cols[8] || "A198").trim(),
        supplierUrl: String(cols[9] || "").trim(),
        amazonUrl: String(cols[10] || "").trim(),
        orderNumber: orderNumber || `WO-${Math.floor(10000000 + Math.random() * 90000000)}`,
        driveLink: String(cols[12] || driveUrl).trim(),
        packCount: Number(cols[13]) || 1,
        quantity: Number(cols[14]) || 1,
        unitCost: String(cols[15] || "0").replace(",", "."),
        sellingPrice: String(cols[16] || "0").replace(",", "."),
        totalCost: String(cols[17] || "0").replace(",", "."),
        orderEmail: String(cols[18] || "").trim(),
        cargoStatus: String(cols[19] || "Tam Geldi").trim(),
        shippedToAmazon: Number(cols[20]) || 0,
        p1CancelQty: Number(cols[21]) || 0,
        p2MissingQty: Number(cols[22]) || 0,
        p3DefectiveQty: Number(cols[23]) || 0,
        p4ExpiredQty: Number(cols[24]) || 0,
        problemAction: String(cols[25] || "").trim(),
        problemResult: String(cols[26] || "").trim(),
        refundAmount: String(cols[27] || "0").replace(",", "."),
        creditCard: String(cols[28] || "").trim(),
        isFragile: String(cols[29] || "NO").trim(),
        isMultiPack: String(cols[30] || "NO").trim(),
        isBundle: String(cols[31] || "NO").trim(),
        condition: String(cols[33] || "New").trim(),
        brandName: String(cols[34] || "General").trim(),
        description1: String(cols[35] || "").trim(),
        description2: String(cols[36] || "").trim(),
        auditNote: String(cols[37] || "").trim(),
        periodCode: String(cols[38] || "Ş26").trim(),
        correctedCost: String(cols[39] || cols[17] || "0").replace(",", "."),
      });
    }

    return NextResponse.json({
      message: `Google Drive tablosundan (${firstSheetName}) ${parsedRows.length} adet sipariş ayrıştırıldı.`,
      headers,
      rows: parsedRows,
    });
  } catch (error: unknown) {
    return handleRouteError("POST /api/orders/import-drive-url", error);
  }
}
