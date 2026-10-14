"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VISITA_RESULTADOS, VISITA_RESULTADO_VALUES } from "@/components/visitas/options";
import { dbError, guard, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const coord = (min: number, max: number, label: string) =>
  z.coerce.number({ invalid_type_error: `${label} inválida` }).finite(`${label} inválida`).min(min, `${label} fora do intervalo`).max(max, `${label} fora do intervalo`);

const checkInSchema = z.object({
  cliente_id: zs.uuid(),
  evento_id: zs.uuid(),
  lat: coord(-90, 90, "Latitude"),
  lng: coord(-180, 180, "Longitude"),
  precisao: z.coerce.number().finite().min(0).max(100_000).nullable().optional(),
  observacoes: zs.text(2000),
});

/** Check-in com geolocalização. Só pode haver uma visita aberta por consultor. */
export async function checkIn(input: { cliente_id?: string | null; evento_id?: string | null; lat: number; lng: number; precisao?: number | null; observacoes?: string | null }): Promise<ActionState> {
  const g = await guard("visitas.checkin");
  if ("denied" in g) return g.denied;
  const parsed = checkInSchema.safeParse({ ...input, cliente_id: input.cliente_id ?? "", evento_id: input.evento_id ?? "", observacoes: input.observacoes ?? "" });
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (v.lat === 0 && v.lng === 0) return { error: "Localização inválida. Tente novamente com o GPS ativado." };
  const supabase = await createClient();
  const me = g.session.userId;

  const { data: open } = await supabase.from("visitas").select("id").eq("consultor_id", me).is("checkout_em", null).limit(1).maybeSingle();
  if (open) return { error: "Você já tem uma visita em andamento. Faça o check-out antes de iniciar outra." };

  let clienteId = v.cliente_id ?? null;
  let eventoId = v.evento_id ?? null;
  if (eventoId) {
    const { data: ev } = await supabase.from("agenda_eventos").select("id, cliente_id").eq("id", eventoId).maybeSingle();
    if (!ev) return { error: "Compromisso não encontrado ou sem acesso." };
    clienteId = clienteId ?? ev.cliente_id;
    eventoId = ev.id;
  }
  if (clienteId) {
    const { data: cli } = await supabase.from("clientes").select("id").eq("id", clienteId).maybeSingle();
    if (!cli) return { error: "Cliente não encontrado ou fora da sua carteira." };
  }

  const { data: row, error } = await supabase
    .from("visitas")
    .insert({ consultor_id: me, cliente_id: clienteId, evento_id: eventoId, checkin_lat: v.lat, checkin_lng: v.lng, checkin_precisao: v.precisao ?? null, observacoes: v.observacoes })
    .select("id")
    .single();
  if (error) return dbError(error);
  revalidatePath("/visitas");
  return { ok: true, message: "Check-in realizado. Boa visita!", id: row.id };
}

const checkOutSchema = z.object({
  id: zs.requiredUuid("a visita"),
  resultado: z.string().refine((r) => VISITA_RESULTADO_VALUES.includes(r), "Selecione o resultado da visita"),
  observacoes: zs.text(2000),
});

/** Check-out: apenas a própria visita em aberto. Registra o resultado na linha do tempo do cliente. */
export async function checkOut(input: { id: string; resultado: string; observacoes?: string | null }): Promise<ActionState> {
  const g = await guard("visitas.checkin");
  if ("denied" in g) return g.denied;
  const parsed = checkOutSchema.safeParse({ ...input, observacoes: input.observacoes ?? "" });
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, resultado } = parsed.data;
  const supabase = await createClient();
  const me = g.session.userId;

  const { data: current } = await supabase.from("visitas").select("id, observacoes").eq("id", id).eq("consultor_id", me).is("checkout_em", null).maybeSingle();
  if (!current) return { error: "Visita não encontrada ou já finalizada." };
  const observacoes = [current.observacoes, parsed.data.observacoes].filter(Boolean).join("\n\n").slice(0, 4000) || null;

  const { data: row, error } = await supabase
    .from("visitas")
    .update({ checkout_em: new Date().toISOString(), resultado, observacoes })
    .eq("id", id)
    .eq("consultor_id", me)
    .is("checkout_em", null)
    .select("id, cliente_id, evento_id, checkin_em")
    .maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Visita não encontrada ou já finalizada." };

  // Efeitos colaterais "best effort" (o RLS decide se o usuário pode alterá-los)
  if (row.evento_id) await supabase.from("agenda_eventos").update({ status: "concluido" }).eq("id", row.evento_id);
  if (row.cliente_id) {
    const label = VISITA_RESULTADOS.find((r) => r.value === resultado)?.label ?? resultado;
    const descricao = `Visita presencial (check-in/out): ${label}${parsed.data.observacoes ? ` — ${parsed.data.observacoes}` : ""}`.slice(0, 5000);
    await supabase.from("interacoes").insert({ cliente_id: row.cliente_id, tipo: "visita", descricao, autor_id: me });
    revalidatePath(`/clientes/${row.cliente_id}`);
  }
  revalidatePath("/visitas");
  return { ok: true, message: "Check-out registrado.", id: row.id };
}
