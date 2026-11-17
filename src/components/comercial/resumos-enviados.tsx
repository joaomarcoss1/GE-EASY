import Link from "next/link";
import { ClipboardList, Download, PenLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap } from "@/lib/data";
import { DIA_AVALIACOES, LIGACAO_RESULTADOS } from "@/lib/constants";
import { dateTime, num } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";

interface Resumo {
  id: string;
  usuario_id: string;
  processos_novos: number;
  processos_trabalhados: number;
  ligacoes: number;
  visitas: number;
  documentos_coletados: number;
  pendencias_resolvidas: number;
  ligacoes_detalhe: { id: string; nome: string; resultado: string; cliente_id?: string | null }[];
  avaliacao: string | null;
  atividades: string | null;
  dificuldades: string | null;
  plano_amanha: string | null;
  atualizado_em: string;
}

/** Resumos do dia enviados pelos consultores/assessores (a gestão vê todos; cada um vê o seu) e quem ainda não enviou. */
export async function ResumosEnviados({ dia, gestao, podeExportar }: { dia: string; gestao: boolean; podeExportar: boolean }) {
  const supabase = await createClient();
  const [{ data }, profiles, { data: membros }, { data: assessores }] = await Promise.all([
    supabase.from("resumos_diarios").select("*").eq("data", dia).order("atualizado_em", { ascending: false }),
    getProfileMap(),
    gestao ? supabase.from("membros").select("id, role, active") : Promise.resolve({ data: [] }),
    gestao ? supabase.from("assessores").select("user_id").eq("ativo", true).not("user_id", "is", null) : Promise.resolve({ data: [] }),
  ]);
  const resumos = (data ?? []) as Resumo[];
  const enviaram = new Set(resumos.map((r) => r.usuario_id));
  const esperados = new Set<string>([
    ...((membros ?? []) as { id: string; role: string; active: boolean }[]).filter((m) => m.active && ["consultor", "consultor_externo"].includes(m.role)).map((m) => m.id),
    ...((assessores ?? []) as { user_id: string }[]).map((a) => a.user_id),
  ]);
  const faltam = [...esperados].filter((u) => !enviaram.has(u));
  const tot = resumos.reduce((a, r) => ({ lig: a.lig + r.ligacoes, proc: a.proc + r.processos_novos, trab: a.trab + r.processos_trabalhados }), { lig: 0, proc: 0, trab: 0 });

  return (
    <Card className="mt-6">
      <CardHeader
        icon={<ClipboardList className="h-4 w-4" />}
        title={`Resumos enviados (${resumos.length})`}
        description={resumos.length ? `${num(tot.proc)} processo(s) novo(s) · ${num(tot.trab)} trabalhado(s) · ${num(tot.lig)} ligação(ões) declaradas` : "O que cada consultor/assessor informou no fim do dia"}
        action={
          <div className="flex gap-2">
            <LinkButton href="/comercial/meu-resumo" size="sm" variant="accent"><PenLine className="h-4 w-4" /> Meu resumo</LinkButton>
            {podeExportar && <LinkButton href={`/api/resumos?de=${dia.slice(0, 8)}01&ate=${dia}`} size="sm" variant="secondary" prefetch={false}><Download className="h-4 w-4" /> Planilha do mês</LinkButton>}
          </div>
        }
      />
      {gestao && faltam.length > 0 && (
        <p className="border-b border-line px-5 py-2.5 text-sm text-amber-800 dark:text-amber-200">Ainda não enviaram: {faltam.map((u) => profiles.get(u)?.full_name ?? "—").join(", ")}</p>
      )}
      {resumos.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">Nenhum resumo enviado neste dia.</p>
      ) : (
        <ul className="divide-y divide-line">
          {resumos.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{profiles.get(r.usuario_id)?.full_name ?? "—"}{r.avaliacao && <Badge tone={DIA_AVALIACOES.find((a) => a.value === r.avaliacao)?.tone ?? "slate"} className="ml-2">dia {optionLabel(DIA_AVALIACOES, r.avaliacao).toLowerCase()}</Badge>}</p>
                <span className="text-xs text-muted">enviado {dateTime(r.atualizado_em)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {[
                  ["Processos novos", r.processos_novos], ["Trabalhados", r.processos_trabalhados], ["Ligações", r.ligacoes],
                  ["Visitas", r.visitas], ["Documentos", r.documentos_coletados], ["Pendências resolvidas", r.pendencias_resolvidas],
                ].map(([l, n]) => <span key={l as string} className="rounded-lg bg-surface-2 px-2.5 py-1"><b className="tabular-nums">{num(n as number)}</b> <span className="text-muted">{l}</span></span>)}
              </div>
              {r.ligacoes_detalhe.length > 0 && (
                <p className="mt-2 text-sm">
                  <span className="text-muted">Ligou para: </span>
                  {r.ligacoes_detalhe.map((l, i) => (
                    <span key={l.id}>
                      {i > 0 && ", "}
                      {l.cliente_id ? <Link href={`/clientes/${l.cliente_id}`} className="font-medium hover:text-brand-600">{l.nome}</Link> : <span className="font-medium">{l.nome}</span>}
                      <span className="text-xs text-muted"> ({optionLabel(LIGACAO_RESULTADOS, l.resultado).toLowerCase()})</span>
                    </span>
                  ))}
                </p>
              )}
              {(r.atividades || r.dificuldades || r.plano_amanha) && (
                <dl className="mt-2 grid gap-2 text-sm lg:grid-cols-3">
                  {r.atividades && <div><dt className="text-xs text-muted">Destaques</dt><dd>{r.atividades}</dd></div>}
                  {r.dificuldades && <div><dt className="text-xs text-amber-700 dark:text-amber-300">Dificuldades / pendências</dt><dd>{r.dificuldades}</dd></div>}
                  {r.plano_amanha && <div><dt className="text-xs text-muted">Plano para amanhã</dt><dd>{r.plano_amanha}</dd></div>}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
