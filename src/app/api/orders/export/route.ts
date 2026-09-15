import { NextResponse } from "next/server";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { maskOrderForRole } from "@/lib/privacy";
import { buildOrdersCsv } from "@/features/orders/ordersCsv";
import type { OrderView } from "@/features/types";

const EXPORT_LIMIT = 10_000;
const CHUNK_SIZE = 250;

function filters(req: Request, effectiveStore: string): SQL[] {
  const { searchParams } = new URL(req.url);
  const conditions: SQL[] = [];
  const cargoStatus = searchParams.get("cargoStatus");
  const pshBatchNo = searchParams.get("pshBatchNo");
  const search = (searchParams.get("search") || "").trim().slice(0, 120);

  if (effectiveStore !== "ALL") conditions.push(eq(orders.buyerStore, effectiveStore));
  if (cargoStatus && cargoStatus !== "ALL") conditions.push(eq(orders.cargoStatus, cargoStatus));
  if (pshBatchNo && pshBatchNo !== "ALL") conditions.push(eq(orders.pshBatchNo, pshBatchNo));
  if (search) {
    const pattern = `%${search}%`;
    const condition = or(
      ilike(orders.orderNumber, pattern),
      ilike(orders.asin, pattern),
      ilike(orders.msku, pattern),
      ilike(orders.productTitle, pattern),
      ilike(orders.brandName, pattern),
      ilike(orders.supplierName, pattern),
      ilike(orders.orderEmail, pattern)
    );
    if (condition) conditions.push(condition);
  }
  return conditions;
}

/**
 * Streams the complete filtered 40-column CSV. Export is intentionally capped;
 * silently exporting only the visible UI page would produce an incomplete
 * accounting file, while unbounded exports can exceed serverless limits.
 */
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;

    const { searchParams } = new URL(req.url);
    const effectiveStore = resolveStoreScope(
      gate.user,
      searchParams.get("storeCode") || "ALL"
    );
    const conditions = filters(req, effectiveStore);
    const where = conditions.length ? and(...conditions) : undefined;

    const countBase = db.select({ total: count() }).from(orders);
    const [countRow] = await (where ? countBase.where(where) : countBase);
    const total = Number(countRow?.total || 0);
    if (total > EXPORT_LIMIT) {
      return NextResponse.json(
        {
          error: `Dışa aktarım ${EXPORT_LIMIT.toLocaleString("tr-TR")} kayıtla sınırlıdır. Mağaza, kargo, batch veya arama filtresiyle sonucu daraltın.`,
          total,
          limit: EXPORT_LIMIT,
        },
        { status: 422 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`\uFEFF${buildOrdersCsv([])}`));
          for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
            const base = db.select().from(orders);
            const rows = await (where
              ? base
                  .where(where)
                  .orderBy(desc(orders.orderDate), desc(orders.id))
                  .limit(CHUNK_SIZE)
                  .offset(offset)
              : base
                  .orderBy(desc(orders.orderDate), desc(orders.id))
                  .limit(CHUNK_SIZE)
                  .offset(offset));

            const safeRows = rows.map((row) =>
              maskOrderForRole(row, gate.user)
            ) as OrderView[];
            const chunk = buildOrdersCsv(safeRows);
            const firstLineEnd = chunk.indexOf("\r\n");
            if (firstLineEnd >= 0) {
              controller.enqueue(encoder.encode(chunk.slice(firstLineEnd)));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const scope = effectiveStore.replace(/[^A-Z0-9_-]/gi, "_");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="CERBERUS_${scope}_40KOLON_${date}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Export-Row-Count": String(total),
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/orders/export", error);
  }
}
