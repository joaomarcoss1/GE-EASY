import { AlarmClock, CheckCircle2, CircleDashed, FileWarning, History, Send, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CADASTRO_STATUS, CARTEIRAS, PROCESSO_AREAS, type Option } from "@/lib/constants";
import { date, dateTime, daysUntil } from "@/lib/format";
import type { Cliente, Profile } from "@/lib/types";
import { ativarCliente, encaminharJuridico, enviarParaDocumentacao, marcarPerdido, prorrogarDocumentacao, redistribuirClientes } from "@/lib/actions/ciclo";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { cn } from "@/lib/cn";

interface Exigido {
  categoria: string;
  nome: string;
  obrigatorio: boolean;
  situacao: "aprovado" | "em_analise" | "recusado" | "vencido" | "faltando";
}

const SITUACAO_DOC: Record<Exigido["situacao"], { label: string; tone: "green" | "amber" | "red" | "slate"; icon: typeof CheckCircle2 }> = {
  aprovado: { label: "Aprovado", tone: "green", icon: CheckCircle2 },
  em_analise: { label: "Em análise", tone: "amber", icon: CircleDashed },
  recusado: { label: "Recusado", tone: "red", icon: FileWarning },
  vencido: { label: "Vencido", tone: "red", icon: FileWarning },
  faltando: { label: "Faltando", tone: "slate", icon: CircleDashed },
};

const MOTIVO_HIST: Record<string, string> = {
  criacao: "Cadastro",
  manual: "Alteração manual",
  regra_prazo_documentacao: "Prazo de documentação esgotado",
  desligamento: "Desligamento",
  redistribuicao: "Redistribuição",
  devolucao: "Devolução",
  prorrogacao: "Prorrogação de prazo",
};

/** Situação do cadastro, carteira, prazo da documentação, checklist e ações do ciclo. */
export async function CicloCard({ cliente, profile, consultores, nomes }: { cliente: Cliente; profile: Profile; consultores: Option[]; nomes: Map<string, { full_name: string }> }) {
  const supabase = await createClient();
  const [{ data: situacao }, { data: historico }] = await Promise.all([
    supabase.rpc("situacao_documental", { p_cliente: cliente.id }),
    supabase.from("cliente_carteira_historico").select("id, de_carteira, para_carteira, de_usuario, para_usuario, motivo, observacao, created_at").eq("cliente_id", cliente.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const exigidos = ((situacao as { exigidos?: Exigido[] } | null)?.exigidos ?? []) as Exigido[];
  const dias = cliente.prazo_documentacao ? daysUntil(cliente.prazo_documentacao) : null;
  const s = cliente.status_cadastro;
  const nome = (id: string | null) => (id ? (nomes.get(id)?.full_name ?? "Usuário") : "—");

  return (
    <Card className="mb-6">
      <CardHeader
        title="Cadastro e documentação"
        description="Situação do cadastro, carteira responsável e documentos exigidos"
        icon={<UserCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {s === "pre_cadastro" && can(profile, "clientes.write") && (
              <ConfirmAction action={enviarParaDocumentacao} id={cliente.id} danger={false} variant="secondary" size="sm" icon={<Send className="h-4 w-4" />} label="Coletar documentação" title="Iniciar a coleta de documentos?" message="Na carteira de um consultor, o prazo da documentação começa a contar agora." confirmLabel="Iniciar" />
            )}
            {s === "documentacao_completa" && can(profile, "documentacao.analisar") && (
              <ConfirmAction action={ativarCliente} id={cliente.id} danger={false} variant="primary" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} label="Ativar cliente" title="Ativar o cliente?" message="A documentação obrigatória está aprovada." confirmLabel="Ativar" />
            )}
            {s === "pendente_documentacao" && cliente.prazo_documentacao && can(profile, "documentacao.prorrogar") && (
              <FormDrawerButton action={prorrogarDocumentacao} hidden={{ id: cliente.id }} title="Prorrogar prazo da documentação" label="Prorrogar" icon="none" size="sm" variant="secondary" width="max-w-md"
                fields={[{ name: "dias", label: "Dias a mais", type: "number", min: 1, max: 90, required: true, span: 2 }, { name: "motivo", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6 }]}
                values={{ dias: 15 }} />
            )}
            {can(profile, "clientes.transfer") && (
              <FormDrawerButton action={redistribuirClientes} hidden={{ id: cliente.id }} title={s === "transferido_administrativo" ? "Devolver / redistribuir cliente" : "Redistribuir cliente"} label={s === "transferido_administrativo" ? "Devolver" : "Redistribuir"} icon="none" size="sm" variant="secondary" width="max-w-md"
                fields={[
                  { name: "consultor_id", label: "Para", type: "select", options: consultores, emptyOption: "Base administrativa", span: 6, help: "Com documentação pendente, o consultor recebe um novo prazo." },
                  { name: "motivo", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6 },
                  { name: "devolucao", label: "Devolução ao consultor original", type: "checkbox", span: 6 },
                ]}
                values={{ consultor_id: cliente.consultor_original_id ?? "", devolucao: !!cliente.consultor_original_id }} />
            )}
            {can(profile, "juridico.encaminhar") && (
              <FormDrawerButton action={encaminharJuridico} hidden={{ cliente_id: cliente.id }} title="Encaminhar ao jurídico" label="Encaminhar ao jurídico" icon="none" size="sm" variant="secondary" width="max-w-lg"
                fields={[
                  { name: "titulo", label: "Assunto", required: true, span: 6, placeholder: "Ex.: Revisão de contrato de financiamento" },
                  { name: "area", label: "Área", type: "select", options: PROCESSO_AREAS, emptyOption: false, required: true, span: 3 },
                  { name: "observacoes", label: "Relato / observações", type: "textarea", rows: 5, span: 6 },
                ]}
                values={{ area: "civel" }} />
            )}
            {!["perdido", "inativo", "ativo"].includes(s) && can(profile, "clientes.write") && (
              <FormDrawerButton action={marcarPerdido} hidden={{ id: cliente.id }} title="Marcar como perdido" label="Perdido" icon="none" size="sm" variant="ghost" width="max-w-md"
                fields={[{ name: "motivo_perda", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6, placeholder: "Ex.: desistiu, sem renda comprovada, fechou com concorrente" }]} />
            )}
          </div>
        }
      />
      <CardBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Situação</dt><dd><StatusBadge options={CADASTRO_STATUS} value={s} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Carteira</dt><dd><StatusBadge options={CARTEIRAS} value={cliente.carteira} /></dd></div>
            {cliente.carteira === "consultor" && <div className="flex justify-between gap-3"><dt className="text-muted">Consultor</dt><dd className="font-medium">{nome(cliente.consultor_id)}</dd></div>}
            {cliente.consultor_original_id && <div className="flex justify-between gap-3"><dt className="text-muted">Consultor original</dt><dd className="font-medium">{nome(cliente.consultor_original_id)}</dd></div>}
            {s === "pendente_documentacao" && cliente.prazo_documentacao && dias !== null && (
              <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2", dias <= 3 ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200" : dias <= 7 ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-100" : "bg-surface-2")}>
                <AlarmClock className="h-4 w-4" />
                <span>{dias > 0 ? `Faltam ${dias} dia(s)` : dias === 0 ? "Prazo termina hoje" : "Prazo esgotado"} · até {date(cliente.prazo_documentacao)}{cliente.prorrogacoes ? ` · ${cliente.prorrogacoes} prorrogação(ões)` : ""}</span>
              </div>
            )}
            {s === "transferido_administrativo" && cliente.transferido_em && <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Transferido para a base administrativa em {dateTime(cliente.transferido_em)} por falta de documentação.</p>}
            {s === "perdido" && cliente.motivo_perda && <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs">Motivo: {cliente.motivo_perda}</p>}
            <div className="flex justify-between gap-3 text-xs"><dt className="text-muted">Consentimento LGPD</dt><dd>{cliente.lgpd_consentimento_em ? `${date(cliente.lgpd_consentimento_em)} · termo ${cliente.lgpd_termo_versao ?? "—"}` : <Badge tone="amber">Não registrado</Badge>}</dd></div>
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Documentos exigidos</p>
            {exigidos.length === 0 ? (
              <p className="text-sm text-muted">Nenhum documento exigido para este tipo de cliente (Configurações › Documentação).</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {exigidos.map((e) => {
                  const v = SITUACAO_DOC[e.situacao] ?? SITUACAO_DOC.faltando;
                  return (
                    <li key={e.categoria} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><v.icon className="h-4 w-4 shrink-0 text-muted" /><span className="truncate">{e.nome}</span>{!e.obrigatorio && <span className="text-xs text-muted">(opcional)</span>}</span>
                      <Badge tone={v.tone}>{v.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
            {(historico ?? []).length > 0 && (
              <details className="mt-4">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted"><History className="h-3.5 w-3.5" /> Histórico da carteira</summary>
                <ol className="mt-2 space-y-1.5 text-xs">
                  {(historico ?? []).map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-x-2 border-b border-line pb-1.5 last:border-0">
                      <span className="text-muted">{dateTime(h.created_at)}</span>
                      <span className="font-medium">{MOTIVO_HIST[h.motivo] ?? h.motivo}</span>
                      <span>{optionLabel(CARTEIRAS, h.de_carteira)}{h.de_usuario ? ` (${nome(h.de_usuario)})` : ""} → {optionLabel(CARTEIRAS, h.para_carteira)}{h.para_usuario ? ` (${nome(h.para_usuario)})` : ""}</span>
                      {h.observacao && <span className="text-muted">· {h.observacao}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
