import { CreditCard, Globe, LifeBuoy, Palette, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { asaasConfigurado } from "@/lib/integracoes/asaas";
import { vercelConfigurado } from "@/lib/integracoes/vercel";
import { brl, date, dateTime } from "@/lib/format";
import { agendarExclusao, assinarPlano, cancelarExclusao, decidirSuporte, encerrarSuporte, linkPagamento, salvarDominio, salvarMarca, verificarDominioEmpresa } from "@/lib/actions/conta";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SettingsForm } from "./settings-form";
import { AssinarButton } from "./assinar-button";

const STATUS: Record<string, [string, "green" | "amber" | "red" | "slate" | "sky"]> = {
  trial: ["Teste grátis", "sky"], ativa: ["Ativa", "green"], inadimplente: ["Pagamento em atraso", "amber"], suspensa: ["Suspensa", "red"], cancelada: ["Cancelada", "slate"],
};
type Limites = { max_usuarios?: number; whatsapp_numeros?: number; dominio_proprio?: boolean };

/** Plano e assinatura: troca de plano e pagamento pela Asaas. */
export async function AssinaturaTab({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const [{ data: ass }, { data: planos }, { data: emp }] = await Promise.all([
    supabase.from("assinaturas").select("*").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("planos").select("*").eq("ativo", true).eq("publico", true).order("ordem"),
    supabase.from("empresas").select("plano, limites, modulos").eq("id", empresaId).single(),
  ]);
  const [rotulo, tom] = STATUS[ass?.status ?? "trial"] ?? STATUS.trial;
  const cobra = asaasConfigurado();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Assinatura" icon={<CreditCard className="h-4 w-4" />} action={<Badge tone={tom}>{rotulo}</Badge>} />
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Plano</dt><dd className="font-semibold">{planos?.find((p) => p.codigo === emp?.plano)?.nome ?? emp?.plano}</dd></div>
            <div><dt className="text-muted">Valor</dt><dd>{ass?.valor ? `${brl(ass.valor)}/mês` : "—"}</dd></div>
            <div><dt className="text-muted">{ass?.status === "trial" ? "Teste até" : "Próximo vencimento"}</dt><dd>{date(ass?.status === "trial" ? ass?.trial_ate : ass?.proximo_vencimento)}</dd></div>
            <div><dt className="text-muted">Limite de usuários</dt><dd>{(emp?.limites as Limites | null)?.max_usuarios ?? "—"}</dd></div>
          </dl>
          {ass?.asaas_subscription_id && cobra && <div className="mt-4"><AssinarButton action={linkPagamento} label="Ver / pagar cobrança em aberto" variant="outline" /></div>}
          {!cobra && <p className="mt-4 text-xs text-muted">A contratação online será liberada em breve. Para mudar de plano agora, fale com o suporte.</p>}
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {(planos ?? []).map((p) => {
          const l = p.limites as Limites;
          const atual = p.codigo === emp?.plano && ass?.asaas_subscription_id;
          return (
            <Card key={p.codigo} className={p.codigo === emp?.plano ? "ring-2 ring-brand-500/30" : ""}>
              <CardBody>
                <p className="text-lg font-bold">{p.nome}</p>
                <p className="text-2xl font-bold text-brand-700">{brl(p.preco_mensal)}<span className="text-sm font-normal text-muted">/mês</span></p>
                <p className="mt-2 text-sm text-muted">{p.descricao}</p>
                <ul className="mt-3 space-y-1 text-xs text-muted">
                  <li>Até {l.max_usuarios} usuários</li>
                  <li>{l.whatsapp_numeros ?? 1} número(s) de WhatsApp</li>
                  <li>{l.dominio_proprio ? "Domínio próprio" : "Endereço GE EASY"}</li>
                </ul>
                <div className="mt-4">{atual ? <Badge tone="green">Plano atual</Badge> : cobra && <AssinarButton action={assinarPlano.bind(null, p.codigo)} label={ass?.asaas_subscription_id ? "Mudar para este plano" : "Assinar"} />}</div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** White-label (logo e cor) e domínio próprio. */
export async function MarcaTab({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: emp } = await supabase.from("empresas").select("marca, dominio, dominio_status, dominio_info, limites, slug").eq("id", empresaId).single();
  const marca = (emp?.marca ?? {}) as { cor?: string; logo_url?: string };
  const info = (emp?.dominio_info ?? {}) as { verification?: { type: string; domain: string; value: string }[]; erro?: string };
  const podeDominio = !!(emp?.limites as Limites | null)?.dominio_proprio;
  const st = emp?.dominio_status as string | null;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader title="Marca" description="Logo no menu e cor principal do sistema para toda a equipe." icon={<Palette className="h-4 w-4" />} />
        <CardBody>
          {marca.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={marca.logo_url} alt="Logo atual" className="mx-6 mt-4 h-12 w-auto" />
          )}
          <SettingsForm action={salvarMarca} values={{ cor: marca.cor ?? "#4F4FC4" }}
            fields={[
              { name: "cor", label: "Cor principal (#RRGGBB)", placeholder: "#4F4FC4", span: 3 },
              { name: "logo", label: "Logo (PNG, JPG ou WEBP, até 512 KB)", type: "file", placeholder: "image/png,image/jpeg,image/webp", span: 6 },
              ...(marca.logo_url ? [{ name: "remover_logo", label: "Remover o logo atual", type: "checkbox" as const, span: 6 as const }] : []),
            ]} />
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Domínio próprio" description={podeDominio ? "Use o endereço da sua empresa (ex.: sistema.suaempresa.com.br)." : "Disponível nos planos Profissional e Empresarial."} icon={<Globe className="h-4 w-4" />}
          action={st && <Badge tone={st === "verificado" ? "green" : st === "erro" ? "red" : "amber"}>{st === "verificado" ? "Ativo" : st === "erro" ? "Erro" : "Aguardando DNS"}</Badge>} />
        <CardBody>
          {podeDominio ? (
            <div className="space-y-4">
              <SettingsForm action={salvarDominio} values={{ dominio: emp?.dominio ?? "" }} submitLabel="Salvar domínio"
                fields={[{ name: "dominio", label: "Domínio", placeholder: "sistema.suaempresa.com.br", span: 6, help: "Deixe vazio para remover" }]} />
              {emp?.dominio && st !== "verificado" && (
                <div className="mx-6 space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
                  <p className="font-semibold">Configure no seu provedor de DNS:</p>
                  <p><code>CNAME</code> {emp.dominio} → <code>cname.vercel-dns.com</code></p>
                  {info.verification?.map((v, i) => <p key={i}><code>{v.type}</code> {v.domain} → <code className="break-all">{v.value}</code></p>)}
                  {info.erro && <p className="text-red-600">{info.erro}</p>}
                  {vercelConfigurado() ? <ActionButton action={verificarDominioEmpresa} label="Verificar agora" variant="primary" /> : <p className="text-xs text-muted">A ativação é feita pela equipe da plataforma após o DNS apontar.</p>}
                </div>
              )}
            </div>
          ) : <p className="text-sm text-muted">Seu endereço atual: <b>{emp?.slug}</b>. Mude de plano na aba Assinatura para usar um domínio próprio.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

/** Portabilidade e exclusão (LGPD) e pedidos de acesso do suporte. */
export async function DadosTab({ empresaId, slug }: { empresaId: string; slug: string }) {
  const supabase = await createClient();
  const [{ data: emp }, { data: pedidos }] = await Promise.all([
    supabase.from("empresas").select("exclusao_agendada_para").eq("id", empresaId).single(),
    supabase.from("acessos_suporte").select("*").order("solicitado_em", { ascending: false }).limit(20),
  ]);
  const nomes = new Map<string, string>();
  if (pedidos?.length && hasServiceRole()) {
    const { data } = await createAdminClient().from("profiles").select("id, full_name, email").in("id", pedidos.map((p) => p.suporte_user_id as string));
    for (const p of data ?? []) nomes.set(p.id as string, (p.full_name as string) || (p.email as string));
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader title="Seus dados (LGPD)" description="A empresa é a controladora dos dados; a plataforma, a operadora." icon={<ShieldAlert className="h-4 w-4" />} />
        <CardBody>
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold">Exportar tudo</p>
              <p className="text-muted">Arquivo NDJSON com todos os registros da empresa (sem senhas, tokens e dados bancários criptografados). Fica registrado na auditoria.</p>
              <a href="/api/empresa/exportar" className="mt-2 inline-flex rounded-xl border border-line px-4 py-2 font-semibold">Baixar exportação</a>
            </div>
            <div className="border-t border-line pt-4">
              <p className="font-semibold">Encerrar e excluir os dados</p>
              {emp?.exclusao_agendada_para ? (
                <>
                  <p className="text-red-600">Exclusão agendada para {dateTime(emp.exclusao_agendada_para as string)}. Depois disso, os dados pessoais são anonimizados e os acessos encerrados.</p>
                  <div className="mt-2"><ActionButton action={cancelarExclusao} label="Cancelar a exclusão" variant="primary" /></div>
                </>
              ) : (
                <>
                  <p className="text-muted">Os dados pessoais são anonimizados 30 dias após o pedido (dá para cancelar até lá). A trilha de auditoria é mantida pelo prazo legal.</p>
                  <div className="mt-2">
                    <FormDrawerButton action={agendarExclusao} title="Agendar exclusão dos dados" label="Agendar exclusão" icon="none" variant="outline" size="sm" submitLabel="Agendar exclusão"
                      description={`Exporte os dados antes. Para confirmar, digite o endereço da empresa: ${slug}`}
                      fields={[{ name: "confirmacao", label: "Endereço da empresa", required: true, placeholder: slug, span: 6 }]} />
                  </div>
                </>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Acesso do suporte" description="A equipe da plataforma só entra com a sua autorização, por tempo limitado e com tudo registrado." icon={<LifeBuoy className="h-4 w-4" />} />
        {!pedidos?.length ? <EmptyState title="Nenhum pedido" /> : (
          <ul className="divide-y divide-line text-sm">{pedidos.map((p) => (
            <li key={p.id} className="space-y-1 px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{nomes.get(p.suporte_user_id as string) ?? "Suporte"} <span className="text-xs text-muted">{dateTime(p.solicitado_em as string)}</span></p>
                <Badge tone={p.status === "ativo" ? "green" : p.status === "pendente" ? "amber" : "slate"}>{p.status}</Badge>
              </div>
              <p className="text-xs text-muted">{p.motivo}{p.expira_em && p.status === "ativo" ? ` · até ${dateTime(p.expira_em as string)}` : ""}</p>
              <div className="flex gap-2">
                {p.status === "pendente" && (
                  <FormDrawerButton action={decidirSuporte} title="Pedido de acesso do suporte" label="Decidir" icon="none" variant="outline" size="sm" hidden={{ id: p.id }} values={{ decisao: "autorizar", horas: 24 }}
                    fields={[{ name: "decisao", label: "Decisão", type: "select", options: [{ value: "autorizar", label: "Autorizar" }, { value: "recusar", label: "Recusar" }], required: true, span: 3 },
                      { name: "horas", label: "Por quantas horas", type: "number", min: 1, max: 72, span: 3 }]} />
                )}
                {p.status === "ativo" && <ConfirmAction action={encerrarSuporte} id={p.id} title="Encerrar acesso do suporte" message="O acesso termina agora." confirmLabel="Encerrar" label="Encerrar agora" size="sm" variant="ghost" />}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
