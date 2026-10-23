"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, guard, zodErrors } from "./utils";
import type { ActionState } from "./types";

const pushSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
  dispositivo_id: z.string().uuid().nullable().optional(),
});

/** Assinatura de notificações push do aparelho (Web Push). Uma por endpoint; reativa se já existir. */
export async function salvarPushAssinatura(input: z.input<typeof pushSchema>): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = pushSchema.safeParse(input);
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient({ origem: "app" });
  const { error } = await supabase.from("push_assinaturas").upsert(
    { ...parsed.data, dispositivo_id: parsed.data.dispositivo_id ?? null, user_id: g.session.userId, ativo: true, falhas: 0 },
    { onConflict: "endpoint" },
  );
  if (error) return dbError(error);
  return { ok: true, message: "Notificações ativadas." };
}
