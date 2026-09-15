import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, stores, auditLogs } from "@/db/schema";
import { requireRole, isDenied } from "@/lib/guards";
import { hashPassword } from "@/lib/passwords";
import { parseBody, userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;

    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    // Sanitize password_hash before returning
    const safeUsers = allUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      storeCode: u.storeCode,
      avatar: u.avatar,
      createdAt: u.createdAt,
    }));
    return NextResponse.json({ users: safeUsers });
  } catch (error: unknown) {
    return handleRouteError("admin/users", error);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1): isim/e-posta/rol + parola politikası (min 12) şemada
    const parsed = await parseBody(req, userCreateSchema);
    if ("response" in parsed) return parsed.response;
    const { name, email, role = "STORE_USER", storeCode = "HRN", password } = parsed.data;

    const cleanEmail = email; // zod: trim + lowercase + email formatı zaten doğrulandı

    if (role !== "ADMIN") {
      const [assignedStore] = await db
        .select({ code: stores.storeCode })
        .from(stores)
        .where(eq(stores.storeCode, storeCode))
        .limit(1);
      if (!assignedStore) {
        return NextResponse.json(
          { error: "Kullanıcı yalnızca tanımlı bir mağazaya atanabilir." },
          { status: 422 }
        );
      }
    }

    // Check duplicate email
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: "Bu e-posta adresiyle kayıtlı kullanıcı zaten var." }, { status: 400 });
    }

    const avatar = name
      .split(" ")
      .map((w: string) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    const [created] = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: cleanEmail,
        // Parola her zaman bcrypt ile saklanır (F-03)
        passwordHash: await hashPassword(String(password)),
        role,
        storeCode: role === "ADMIN" ? "ALL" : storeCode,
        avatar,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: storeCode || "ALL",
      actionType: "USER_CREATED",
      targetEntity: `${created.name} (${cleanEmail})`,
      beforeState: "YOK",
      afterState: role,
      details: `Yeni kullanıcı oluşturuldu. Yetki: ${role}, Atanan Mağaza: ${created.storeCode}`,
    });

    return NextResponse.json({
      message: `${created.name} başarıyla eklendi.`,
      user: {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
        storeCode: created.storeCode,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("admin/users", error);
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireRole("ADMIN");
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    // Zod doğrulama (T3.1)
    const parsed = await parseBody(req, userUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const { id, name, role, storeCode, password } = parsed.data;

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, Number(id)))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    const current = existing[0];
    if (current.id === currentUser.id && role !== undefined && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Aktif oturumdaki yönetici kendi ADMIN yetkisini kaldıramaz." },
        { status: 409 }
      );
    }

    const effectiveRole = role ?? current.role;
    const effectiveStore = effectiveRole === "ADMIN" ? "ALL" : storeCode ?? current.storeCode;
    if (effectiveRole !== "ADMIN") {
      const [assignedStore] = await db
        .select({ code: stores.storeCode })
        .from(stores)
        .where(eq(stores.storeCode, effectiveStore))
        .limit(1);
      if (!assignedStore) {
        return NextResponse.json(
          { error: "Kullanıcı yalnızca tanımlı bir mağazaya atanabilir." },
          { status: 422 }
        );
      }
    }

    const updateData: Record<string, string> = {};
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) {
      updateData.role = role;
      if (role === "ADMIN") updateData.storeCode = "ALL";
    }
    if (storeCode !== undefined && effectiveRole !== "ADMIN") {
      updateData.storeCode = storeCode;
    }
    if (password) {
      // Yeni parola bcrypt ile saklanır (F-03); min uzunluk şemada doğrulandı
      updateData.passwordHash = await hashPassword(password);
    }

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, Number(id)))
      .returning();

    await db.insert(auditLogs).values({
      actorName: currentUser.name,
      storeCode: updated.storeCode || "ALL",
      actionType: "USER_UPDATED",
      targetEntity: `${updated.name} (${updated.email})`,
      beforeState: `${current.role} - ${current.storeCode}`,
      afterState: `${updated.role} - ${updated.storeCode}`,
      details: `Kullanıcı yetki ve mağaza ataması güncellendi.`,
    });

    return NextResponse.json({
      message: "Kullanıcı güncellendi",
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        storeCode: updated.storeCode,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("admin/users", error);
  }
}
