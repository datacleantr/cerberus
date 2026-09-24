import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { pshBatches, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { buildPrepShipLoadDataRows } from "@/features/orders/prepshipExport";

/**
 * PrepShip köprüsü — Adım 3'ün ilk yarısı (denetim raporu §14).
 *
 * Kullanıcının bugün PrepShip'e siparişleri TEK TEK ELLE girdiği adımın
 * yerine geçer: bir PSH batch'i açtıktan sonra bu uç, batch'e bağlı tüm
 * siparişleri PrepShip'in gerçek "LoadData" toplu yükleme şablonuna
 * (kullanıcının paylaştığı `15_Subat_Vs.xlsx` örneğinden) dökülmüş bir
 * .xlsx olarak indirir. Kullanıcı bu dosyayı doğrudan PrepShip'e yükler —
 * elle tekrar giriş ortadan kalkar.
 *
 * Bu uç salt okunur bir dışa aktarımdır; CERBERUS tarafında herhangi bir
 * durum değişikliği yapmaz (PrepShip'e fiilen yüklenip yüklenmediğini
 * CERBERUS bilemez — bu, PrepShip'in kendi tarafında olur).
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ batchNumber: string }> }
) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { batchNumber } = await context.params;

    const existingBatch = await db
      .select()
      .from(pshBatches)
      .where(eq(pshBatches.batchNumber, batchNumber))
      .limit(1);

    if (!existingBatch.length) {
      return NextResponse.json({ error: "PSH batch bulunamadı." }, { status: 404 });
    }
    const batch = existingBatch[0];

    if (!canAccessStore(currentUser, batch.storeCode)) {
      return NextResponse.json(
        { error: "Bu batch sizin mağaza kapsamınızda değil." },
        { status: 403 }
      );
    }

    const batchOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.pshBatchNo, batchNumber));

    if (!batchOrders.length) {
      return NextResponse.json(
        { error: "Bu batch'e atanmış sipariş yok." },
        { status: 422 }
      );
    }

    const rows = buildPrepShipLoadDataRows(batchOrders);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "LoadData");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${batchNumber}-prepship-loaddata.xlsx"`,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/batches/[batchNumber]/prepship-export", error);
  }
}
