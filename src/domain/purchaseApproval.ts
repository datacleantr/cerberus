/**
 * CERBERUS — Satın Alma Onay Eşiği
 *
 * Denetim bulgusu (Faz 1): büyük tutarlı satın almaların ikinci bir gözden
 * geçirmeden geçmesi risk — bir STORE_USER'ın tek satırlık hata veya kötü
 * niyetle yüksek tutarlı bir sipariş girmesini yakalayan hiçbir mekanizma
 * yoktu.
 *
 * TASARIM KARARI (kullanıcı onayı, 2026-09-24): eşik aşıldığında sipariş
 * ENGELLENMEZ — oluşturulur, ama `PENDING_APPROVAL` olarak işaretlenir ve
 * ADMIN/MANAGER onaylayana/reddedene kadar bu durumda kalır. Mağaza
 * başına TEK bir sabit dolar eşiği (`stores.purchase_approval_threshold`,
 * NULL = eşik yok).
 *
 * Kimin girdiği önemli: ADMIN/MANAGER zaten onay yetkisine sahip
 * kişilerdir — kendi girdikleri sipariş kendi kendini onaylamış sayılır
 * (AUTO_APPROVED). Yalnızca STORE_USER'ın girdiği ve eşiği aşan siparişler
 * PENDING_APPROVAL'a düşer.
 *
 * DÜRÜSTLÜK İLKESİ: eşik tanımlı değilse (`threshold === null`) hiçbir
 * sipariş bekletilmez — var olmayan bir kural uydurulmaz, sessizce
 * AUTO_APPROVED kalır.
 */

export type ApprovalStatus = "AUTO_APPROVED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type ApprovalActorRole = "ADMIN" | "MANAGER" | "STORE_USER";

export interface PurchaseApprovalDecision {
  status: ApprovalStatus;
  reason: string;
}

/**
 * Yeni bir sipariş için onay durumunu belirler. Yalnız CREATE zamanında
 * çağrılır — bir siparişin onay durumu sonradan yalnız dedike onay
 * endpoint'i (`PATCH /api/orders/[id]/approval`) üzerinden değişir.
 */
export function evaluatePurchaseApproval(input: {
  totalCost: number;
  creatorRole: ApprovalActorRole;
  threshold: number | null;
}): PurchaseApprovalDecision {
  const { totalCost, creatorRole, threshold } = input;

  if (threshold === null) {
    return { status: "AUTO_APPROVED", reason: "Bu mağaza için onay eşiği tanımlı değil." };
  }

  if (creatorRole === "ADMIN" || creatorRole === "MANAGER") {
    return {
      status: "AUTO_APPROVED",
      reason: `${creatorRole} zaten onay yetkisine sahip — kendi kendini onaylar.`,
    };
  }

  if (totalCost > threshold) {
    return {
      status: "PENDING_APPROVAL",
      reason: `Sipariş tutarı ($${totalCost.toFixed(2)}) mağaza eşiğini ($${threshold.toFixed(2)}) aşıyor — ADMIN/MANAGER onayı bekliyor.`,
    };
  }

  return { status: "AUTO_APPROVED", reason: `Tutar eşik ($${threshold.toFixed(2)}) altında.` };
}

/** Onay/red kararı geçerli mi — yalnız bekleyen bir siparişe uygulanabilir. */
export function canResolveApproval(current: ApprovalStatus): boolean {
  return current === "PENDING_APPROVAL";
}
