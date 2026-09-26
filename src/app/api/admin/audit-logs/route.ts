import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireRole, isDenied } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { and, count, desc, eq, type SQL } from "drizzle-orm";

/**
 * Denetim izi — kendi sayfalanan, filtrelenen ucu.
 *
 * Öncesinde audit log'lar GET /api/orders yanıtına gizlice ekleniyordu:
 * yalnız son 40 kayıt, ve siparişler sekmesinde seçili olan mağaza filtresine
 * bağımlıydı (effectiveStore). Bu, admin panelindeki "Denetim İzi" sekmesinin
 * başlığında "Gerçek Zamanlı Sistem Değişiklik Günlüğü" yazsa da aslında
 * bazen tek bir mağazayla sınırlı, kısmi bir görünüm göstermesine yol
 * açıyordu — üstelik bunu kullanıcıya hiç belirtmeden. CERBERUS'un dürüstlük
 * ilkesiyle çelişen bu davranış düzeltildi: bu uç gerçekten global (ADMIN/
 * MANAGER için hep tüm mağazalar), sayfalanmış ve isteğe bağlı filtrelenmiş
 * (storeCode / actionType) sonuç döner — sekmenin gösterdiği veri artık
 * başlığıyla tutarlı.
 */
export async function GET(req: Request) {
  try {
    const gate = await requireRole("ADMIN", "MANAGER");
    if (isDenied(gate)) return gate.response;

    const { searchParams } = new URL(req.url);
    const storeCode = (searchParams.get("storeCode") || "ALL").trim();
    const actionType = (searchParams.get("actionType") || "ALL").trim();

    const requestedPage = Number(searchParams.get("page"));
    const requestedPageSize = Number(searchParams.get("pageSize"));
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize =
      Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(200, requestedPageSize)
        : 50;

    const conditions: SQL[] = [];
    if (storeCode && storeCode !== "ALL") {
      conditions.push(eq(auditLogs.storeCode, storeCode));
    }
    if (actionType && actionType !== "ALL") {
      conditions.push(eq(auditLogs.actionType, actionType));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logsBase = db.select().from(auditLogs);
    const countBase = db.select({ n: count() }).from(auditLogs);

    const [rows, [totalRow]] = await Promise.all([
      (whereClause ? logsBase.where(whereClause) : logsBase)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      whereClause ? countBase.where(whereClause) : countBase,
    ]);

    const total = Number(totalRow?.n || 0);

    return NextResponse.json({
      auditLogs: rows,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error: unknown) {
    return handleRouteError("admin/audit-logs", error);
  }
}
