import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EVENTO_TIPOS } from "@/lib/constants";
import { addDays, toLocal } from "@/components/agenda/date-utils";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: string;
  status: "agendado" | "concluido" | "cancelado";
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  local: string | null;
  link_reuniao: string | null;
  lembrete_minutos: number | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string } | { nome: string }[] | null;
}

/** Escapa TEXT conforme RFC 5545 §3.3.11 */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Dobra linhas em 75 octetos (RFC 5545 §3.1) sem quebrar caracteres UTF-8. */
function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // linhas de continuação começam com um espaço
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** 2026-10-14T12:00:00Z -> 20261014T120000Z */
const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const ymdCompact = (ymd: string) => ymd.replace(/-/g, "");

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !session.profile.active) {
    return new NextResponse("Não autenticado", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const supabase = await createClient();
  // O middleware não exige 2FA em /api: garante aqui que a sessão está no nível exigido.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return new NextResponse("Verificação em duas etapas pendente", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const now = Date.now();
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const to = new Date(now + 180 * 86_400_000).toISOString();
  let query = supabase
    .from("agenda_eventos")
    .select("id, titulo, descricao, tipo, status, inicio, fim, dia_inteiro, local, link_reuniao, lembrete_minutos, created_at, updated_at, clientes(nome)")
    .gte("fim", from)
    .lte("inicio", to)
    .order("inicio")
    .limit(2000);
  const resp = request.nextUrl.searchParams.get("resp");
  if (resp && /^[0-9a-f-]{36}$/i.test(resp)) query = query.eq("responsavel_id", resp);
  const { data, error } = await query;
  if (error) {
    console.error("[agenda.ics]", error.code, error.message);
    return new NextResponse("Não foi possível gerar o arquivo.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const host = request.nextUrl.hostname || "ge-easy";
  const dtstamp = utcStamp(new Date(now).toISOString());
  const tipoLabel = Object.fromEntries(EVENTO_TIPOS.map((t) => [t.value, t.label]));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EASY Consórcio & Seguros//GE EASY//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc("GE EASY — Agenda")}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
  ];

  for (const e of (data ?? []) as unknown as Row[]) {
    const cliente = Array.isArray(e.clientes) ? e.clientes[0]?.nome : e.clientes?.nome;
    const desc = [e.descricao, cliente ? `Cliente: ${cliente}` : null, e.link_reuniao ? `Link: ${e.link_reuniao}` : null].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:${e.id}@${host}`, `DTSTAMP:${dtstamp}`);
    if (e.dia_inteiro) {
      const s = toLocal(e.inicio).date;
      const f = toLocal(e.fim).date;
      lines.push(`DTSTART;VALUE=DATE:${ymdCompact(s)}`, `DTEND;VALUE=DATE:${ymdCompact(addDays(f < s ? s : f, 1))}`);
    } else {
      lines.push(`DTSTART:${utcStamp(e.inicio)}`, `DTEND:${utcStamp(e.fim)}`);
    }
    lines.push(`SUMMARY:${esc(e.titulo)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    if (e.local) lines.push(`LOCATION:${esc(e.local)}`);
    if (e.link_reuniao && /^https?:\/\//i.test(e.link_reuniao)) lines.push(`URL:${e.link_reuniao.replace(/[\r\n]/g, "")}`);
    lines.push(`CATEGORIES:${esc(tipoLabel[e.tipo] ?? e.tipo)}`);
    lines.push(`STATUS:${e.status === "cancelado" ? "CANCELLED" : "CONFIRMED"}`);
    lines.push(`CREATED:${utcStamp(e.created_at)}`, `LAST-MODIFIED:${utcStamp(e.updated_at)}`);
    if (e.lembrete_minutos !== null && e.status === "agendado") {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.titulo)}`, `TRIGGER:-PT${Math.max(0, e.lembrete_minutos)}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  const body = lines.map(fold).join("\r\n") + "\r\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ge-easy-agenda.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
