import type { SessionUser } from "@/lib/session";

/**
 * T7.2 — Rol-bazlı veri minimizasyonu.
 * İlke: "iş için gerekli olan asgari veri" (KVKK m.4 — ölçülülük).
 * Yalnızca idari sorumluluk taşıyan ADMIN tüm alanları görür;
 * MANAGER/STORE_USER maskeli formlarla çalışır.
 */

export function maskCreditCard(last4: string | null | undefined): string {
  if (!last4) return "";
  // Tamamı maskeli — son 4 hane dahi kişisel/işlem verisi sayılır
  return "••••";
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/** Sipariş satırını role göre maskeleyerek döndürür (yeni nesne; orijinal korunur) */
export function maskOrderForRole<T extends { creditCard?: string | null; orderEmail?: string }>(
  order: T,
  user: SessionUser
): T {
  if (user.role === "ADMIN") return order;
  return {
    ...order,
    creditCard: maskCreditCard(order.creditCard),
    orderEmail: maskEmail(order.orderEmail),
  };
}

/**
 * Kullanıcı listesi minimizasyonu:
 * ADMIN tam liste (yönetim ekranı), diğerleri yalnız görüntüleme kimliği alır
 * (isim/avatar — atama rozetleri için); e-posta ve meta paylaşılmaz.
 */
export function minimizeUsersForRole<
  T extends { id: number; name: string; avatar?: string | null }
>(usersList: T[], user: SessionUser) {
  if (user.role === "ADMIN") return usersList;
  return usersList.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar ?? null }));
}
