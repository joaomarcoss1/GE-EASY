import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { WA_CAMPANHA_STATUS } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import { cancelarCampanha, prepararCampanha, salvarCampanha } from "@/lib/actions/whatsapp";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { RealtimeRefresh } from "@/components/ui/realtime-refresh";
import type { FieldDef } from "@/components/ui/form";

export const metadata: Metadata = { title: "Campanhas de WhatsApp" };

/** Envios em massa com modelo aprovado, só para contatos com opt-in, com limite por hora e acompanhamento de entrega/leitura/resposta. */
export default async function CampanhasPage() {
  const { profile } = await requireSession();
  if (!can(profile, "whatsapp.campanhas")) redirect("/inicio?erro=permissao");
  const supabase = await createClient();
  const [{ data: campanhas }, { data: numeros }, { data: modelos }, { count: comOptin }] = await Promise.all([
    supabase.from("wa_campanhas").select("*, wa_modelos(nome)").order("created_at", { ascending: false }).limit(100),
    supabase.from("wa_numeros").select("id, nome").eq("ativo", true),
    supabase.from("wa_modelos").select("id, nome, categoria, variaveis").eq("status", "aprovado").order("nome"),
    supabase.from("wa_contatos").select("id", { count: "exact", head: true }).not("optin_em", "is", null).is("optout_em", null),
  ]);
  const campos: FieldDef[] = [
    { name: "nome", label: "Nome da campanha", required: true, span: 6 },
    { name: "numero_id", label: "Número de envio", type: "select", options: (numeros ?? []).map((n) => ({ value: n.id, label: n.nome })), required: true, span: 3 },
    { name: "modelo_id", label: "Modelo aprovado", type: "select", options: (modelos ?? []).map((m) => ({ value: m.id, label: `${m.nome} (${m.variaveis} var.)` })), required: true, span: 3 },
    { name: "variaveis", label: "Variáveis do modelo, separadas por |", span: 6, help: "Use {{nome}} para o primeiro nome do contato. Ex.: {{nome}} | 30/11" },
    { name: "agendada_para", label: "Enviar a partir de", type: "datetime-local", span: 3 },
    { name: "limite_hora", label: "Limite de envios por hora", type: "number", min: 1, max: 10000, span: 3 },
    { name: "cidade", label: "Filtro: cidade do cliente", span: 3, section: "Público (sempre só quem autorizou)" },
    { name: "etiqueta", label: "Filtro: etiqueta do contato", span: 3 },
    { name: "carteira", label: "Filtro: carteira", type: "select", options: [{ value: "consultor", label: "Consultor" }, { value: "administrativo", label: "Administrativo" }, { value: "juridico", label: "Jurídico" }], span: 3 },
    { name: "pendencia", label: "Só clientes com documentação pendente", type: "checkbox", span: 3 },
  ];
  return (
    <>
      <RealtimeRefresh tabelas={["wa_campanhas"]} intervaloSeg={60} />
      <PageHeader eyebrow="Atendimento" title="Campanhas de WhatsApp" description={`Somente contatos que autorizaram receber mensagens (${comOptin ?? 0} hoje) e que não pediram descadastro. "SAIR" na resposta descadastra na hora.`}
        actions={<FormDrawerButton action={salvarCampanha} title="Nova campanha" label="Nova campanha" variant="accent" width="max-w-2xl" values={{ limite_hora: 200 }} fields={campos} />} />
      <Card>
        <CardHeader title="Campanhas" icon={<Megaphone className="h-4 w-4" />} />
        {!campanhas?.length ? <EmptyState icon={<Megaphone className="h-6 w-6" />} title="Nenhuma campanha" description="Crie a campanha, prepare os destinatários e ela será enviada no horário agendado." /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Campanha</th><th>Modelo</th><th>Envio</th><th>Situação</th><th className="text-right">Destinatários</th><th className="text-right">Entregues / lidas / respostas</th><th /></tr></thead>
            <tbody>
              {campanhas.map((c) => {
                const t = (c.totais ?? {}) as Record<string, number>;
                return (
                  <tr key={c.id}>
                    <td className="font-medium">{c.nome}</td>
                    <td className="text-sm">{(c.wa_modelos as { nome: string } | null)?.nome}</td>
                    <td className="whitespace-nowrap text-sm">{c.agendada_para ? dateTime(c.agendada_para) : "—"}</td>
                    <td><StatusBadge options={WA_CAMPANHA_STATUS} value={c.status} /></td>
                    <td className="text-right">{t.destinatarios ?? "—"}</td>
                    <td className="text-right text-sm">{t.entregue ?? 0} / {t.lido ?? 0} / {t.respondido ?? 0}{t.falhou ? <span className="ml-1 text-red-600">({t.falhou} falha)</span> : null}</td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        {c.status === "rascunho" && (
                          <>
                            <FormDrawerButton action={salvarCampanha} title="Editar campanha" icon="edit" variant="ghost" size="sm" width="max-w-2xl" hidden={{ id: c.id }} fields={campos}
                              values={{ ...c, ...(c.filtro as Record<string, string>), variaveis: (c.variaveis as string[]).join(" | "), agendada_para: c.agendada_para ? new Date(c.agendada_para).toLocaleString("sv-SE", { timeZone: "America/Fortaleza" }).slice(0, 16) : "" }} />
                            <ActionButton action={prepararCampanha.bind(null, c.id)} label="Preparar e agendar" variant="primary" />
                          </>
                        )}
                        {["rascunho", "agendada", "enviando"].includes(c.status) && (
                          <ConfirmAction action={cancelarCampanha} id={c.id} title="Cancelar campanha" message="Os envios ainda pendentes não serão feitos." confirmLabel="Cancelar campanha" label="Cancelar" size="sm" variant="ghost" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
