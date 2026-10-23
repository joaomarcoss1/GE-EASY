import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download, FileSpreadsheet } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { FOLHA_STATUS } from "@/lib/constants";
import { brl, dateTime } from "@/lib/format";
import { ajustarItemFolha, aprovarFolha, gerarPreFolha } from "@/lib/actions/rh";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pré-folha" };

const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/**
 * Pré-folha: consolida salário, extras e faltas do espelho, comissões recebidas e reembolsos de rota aprovados
 * → revisão (proventos/descontos manuais) → aprovação (vira contas a pagar) → exportação para a contabilidade.
 */
export default async function FolhaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  if (!can(profile, "folha.gerir")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: comps } = await supabase.from("folha_competencias").select("*").order("competencia", { ascending: false }).limit(24);
  const atual = comps?.find((c) => c.id === sp.c) ?? comps?.[0];
  const { data: itens } = atual
    ? await supabase.from("folha_itens").select("*, funcionarios(nome, matricula)").eq("competencia_id", atual.id).order("total", { ascending: false })
    : { data: [] };
  const anterior = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 7);
  const revisao = atual?.status === "em_revisao";
  const total = (itens ?? []).reduce((a, i) => a + Number(i.total), 0);

  return (
    <>
      <PageHeader eyebrow="Recursos Humanos" title="Pré-folha" description="Consolidação mensal para conferência e envio à contabilidade. Na aprovação, cada pagamento vira uma conta a pagar no financeiro."
        actions={<FormDrawerButton action={gerarPreFolha} title="Consolidar competência" label="Consolidar mês" variant="accent" values={{ competencia: anterior }} submitLabel="Consolidar"
          description="Refazer a consolidação de um mês em revisão atualiza os valores calculados e mantém os ajustes manuais."
          fields={[{ name: "competencia", label: "Competência (AAAA-MM)", required: true, placeholder: "2026-09", span: 6 }]} />} />
      {!atual ? <Card><EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="Nenhuma pré-folha" description="Consolide o mês para começar." /></Card> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(comps ?? []).map((c) => (
              <LinkButton key={c.id} href={`/rh/folha?c=${c.id}`} variant={c.id === atual.id ? "primary" : "secondary"} size="sm">{String(c.competencia).slice(5, 7)}/{String(c.competencia).slice(0, 4)}</LinkButton>
            ))}
          </div>
          <Card>
            <CardHeader title={`Competência ${String(atual.competencia).slice(5, 7)}/${String(atual.competencia).slice(0, 4)} — ${brl(total)}`}
              description={`Consolidada em ${dateTime(atual.gerada_em)}${atual.aprovada_em ? ` · aprovada em ${dateTime(atual.aprovada_em)}` : ""}`} icon={<FileSpreadsheet className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-2">
                  <StatusBadge options={FOLHA_STATUS} value={atual.status} />
                  {revisao && <ConfirmAction action={aprovarFolha} id={atual.id} title="Aprovar a folha" message="Os valores ficam bloqueados e cada pagamento vira uma conta a pagar no financeiro." confirmLabel="Aprovar" label="Aprovar" variant="primary" size="sm" danger={false} />}
                  <a href={`/api/rh/folha/${atual.id}`} className="flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-sm font-semibold"><Download className="h-4 w-4" />CSV</a>
                </div>
              } />
            {!itens?.length ? <EmptyState title="Sem funcionários na competência" /> : (
              <div className="overflow-x-auto"><table className="table-base">
                <thead><tr><th>Funcionário</th><th className="text-right">Salário</th><th className="text-right">Extras</th><th className="text-right">Faltas</th><th className="text-right">Comissões</th><th className="text-right">Reembolsos</th><th className="text-right">Outros</th><th className="text-right">Total</th><th /></tr></thead>
                <tbody>{itens.map((i) => {
                  const f = i.funcionarios as { nome: string; matricula: string | null };
                  return (
                    <tr key={i.id}>
                      <td><p className="font-medium">{f.nome}</p>{i.observacoes && <p className="text-xs text-muted">{i.observacoes}</p>}</td>
                      <td className="text-right text-sm">{brl(Number(i.salario_base) + Number(i.adicionais))}</td>
                      <td className="text-right text-sm">{i.horas_extras_min ? <>{brl(i.valor_extras)}<span className="block text-[11px] text-muted">{hm(i.horas_extras_min)}</span></> : "—"}</td>
                      <td className="text-right text-sm text-red-600">{i.faltas_min ? <>-{brl(i.desconto_faltas)}<span className="block text-[11px] text-muted">{hm(i.faltas_min)}</span></> : "—"}</td>
                      <td className="text-right text-sm">{Number(i.comissoes) ? brl(i.comissoes) : "—"}</td>
                      <td className="text-right text-sm">{Number(i.reembolsos) ? brl(i.reembolsos) : "—"}</td>
                      <td className="text-right text-sm">{Number(i.outros_proventos) || Number(i.outros_descontos) ? `${brl(i.outros_proventos)} / -${brl(i.outros_descontos)}` : "—"}</td>
                      <td className={`text-right font-semibold ${Number(i.total) < 0 ? "text-red-600" : ""}`}>{brl(i.total)}</td>
                      <td className="text-right">
                        {revisao && <FormDrawerButton action={ajustarItemFolha} title={`Ajustar — ${f.nome}`} icon="edit" variant="ghost" size="sm" hidden={{ id: i.id }}
                          values={{ outros_proventos: i.outros_proventos, outros_descontos: i.outros_descontos, observacoes: i.observacoes }}
                          fields={[{ name: "outros_proventos", label: "Outros proventos", type: "money", span: 3 }, { name: "outros_descontos", label: "Outros descontos (VT, adiantamento…)", type: "money", span: 3 }, { name: "observacoes", label: "Observação", type: "textarea", rows: 2, span: 6 }]} />}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
            <p className="px-5 py-3 text-xs text-muted">Valor-hora = salário ÷ 220; extras com adicional de 50%. Encargos, INSS, IRRF e FGTS ficam com a contabilidade (eSocial em fase futura).</p>
          </Card>
        </>
      )}
    </>
  );
}
