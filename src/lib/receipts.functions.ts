import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit.functions";
import { assertStrongAuth } from "@/lib/session.functions";

export type ReceiptRow = {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  period: string | null;
  note: string | null;
  file_path: string | null;
  file_name: string | null;
  acknowledged: boolean;
  created_at: string;
};

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function rolesOf(context: { supabase: any; userId: string }): Promise<string[]> {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  return (data ?? []).map((r: { role: string }) => r.role as string);
}

/** Committee issues a receipt to a resident, optionally with a scanned file. */
export const issueReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        title: z.string().trim().min(2).max(140),
        amount: z.coerce.number().min(0).max(10_000_000),
        period: z.string().trim().max(60).optional(),
        note: z.string().trim().max(1000).optional(),
        fileName: z.string().trim().max(200).optional(),
        fileBase64: z.string().max(6_000_000).optional(),
        fileType: z.string().max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStrongAuth(context);
    const roles = await rolesOf(context);
    if (!roles.some((r) => ["super_admin", "treasurer", "president"].includes(r))) {
      throw new Error("Forbidden: only elevated committee roles can issue receipts");
    }

    const db = await adminClient();
    let filePath: string | null = null;

    if (data.fileBase64 && data.fileName) {
      const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
      const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      filePath = `${data.userId}/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from("receipts").upload(filePath, bytes, {
        contentType: data.fileType || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    }

    const { error } = await db.from("receipts").insert({
      user_id: data.userId,
      title: data.title,
      amount: data.amount,
      period: data.period || null,
      note: data.note || null,
      file_path: filePath,
      file_name: data.fileName || null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "receipt_issued",
      category: "admin",
      targetId: data.userId,
      details: { title: data.title, amount: data.amount },
    });

    return { ok: true };
  });

/** Signed download link, only for the receipt owner or a committee member. */
export const receiptFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ receiptId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("receipts")
      .select("id, file_path")
      .eq("id", data.receiptId)
      .maybeSingle();
    if (error || !row?.file_path) throw new Error("Receipt file not found");

    const db = await adminClient();
    const { data: signed, error: signErr } = await db.storage
      .from("receipts")
      .createSignedUrl(row.file_path, 300);
    if (signErr) throw new Error(signErr.message);
    return { url: signed.signedUrl };
  });

export const deleteReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStrongAuth(context);
    const roles = await rolesOf(context);
    if (!roles.some((r) => ["super_admin", "treasurer", "president"].includes(r))) {
      throw new Error("Forbidden");
    }
    const db = await adminClient();
    const { data: row } = await db.from("receipts").select("file_path").eq("id", data.id).maybeSingle();
    if (row?.file_path) await db.storage.from("receipts").remove([row.file_path]);
    const { error } = await db.from("receipts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      action: "receipt_deleted",
      category: "admin",
      details: { receipt_id: data.id },
    });
    return { ok: true };
  });
