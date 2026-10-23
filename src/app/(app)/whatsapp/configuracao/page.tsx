import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, MessageCircle, Webhook } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions } from "@/lib/data";
import { WA_MODELO_CATEGORIAS, toMap } from "@/lib/constants";
import { env } from "@/lib/env";
import { whatsappConfigurado } from "@/lib/integracoes/whatsapp";
import { salvarModelo, salvarNumero } from "@/lib/actions/whatsapp";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";

export const metadata: Metadata = { title: "Configurar WhatsApp" };

/** Números da empresa na Cloud API (token só no servidor, criptografado), horários, menu inicial e modelos aprovados. */
export default async function WhatsAppConfigPage() {
  const { profile } = await requireSession();
  const configura = can(profile, "whatsapp.configurar");
  if (!configura && !can(profile, "whatsapp.campanhas")) redirect("/inicio?erro=permissao");
  const supabase = await createClient();
  const [{ data: numeros }, { data: modelos }, deps] = await Promise.all([
    supabase.from("wa_numeros").select("*").order("created_at"),
    supabase.from("wa_modelos").select("*").order("nome"),
    departamentoOptions(),
  ]);
  const categorias = toMap(WA_MODELO_CATEGORIAS);
  const camposNumero: FieldDef[] = [
    { name: "nome", label: "Nome interno", required: true, span: 3, placeholder: "Comercial" },
    { name: "numero", label: "Número (55 + DDD + número)", required: true, span: 3, type: "tel" },
    { name: "phone_number_id", label: "Phone number ID", required: true, span: 3 },
    { name: "waba_id", label: "WhatsApp Business Account ID", span: 3 },
    { name: "token", label: "Token de acesso (System User)", type: "password", span: 6, help: "Verificado na Meta e guardado criptografado. Deixe vazio para manter o atual." },
    { name: "departamento_id", label: "Fila padrão (sem dono nem regra)", type: "select", options: deps, span: 3 },
    { name: "sla_resposta_min", label: "Prazo da 1ª resposta (min)", type: "number", min: 1, max: 1440, span: 3 },
    { name: "inicio", label: "Atendimento das", type: "time", span: 2 },
    { name: "fim", label: "até", type: "time", span: 2 },
    { name: "sabado", label: "Sábado", type: "checkbox", span: 1 },
    { name: "domingo", label: "Domingo", type: "checkbox", span: 1 },
    { name: "msg_boas_vindas", label: "Mensagem de boas-vindas", type: "textarea", rows: 2, span: 6 },
    { name: "msg_fora_horario", label: "Mensagem fora do horário", type: "textarea", rows: 2, span: 6 },
    { name: "menu", label: "Menu inicial (opções numeradas na ordem)", type: "multiselect", options: deps, span: 6, help: "Para quem não tem dono na carteira: o cliente responde 1, 2… e vai para o departamento" },
    { name: "ativo", label: "Ativo", type: "checkbox", span: 6 },
  ];
  const camposModelo: FieldDef[] = [
    { name: "nome", label: "Nome do modelo (igual ao da Meta)", required: true, span: 4 },
    { name: "idioma", label: "Idioma", required: true, span: 2 },
    { name: "categoria", label: "Categoria", type: "select", options: WA_MODELO_CATEGORIAS, required: true, span: 3 },
    { name: "status", label: "Situação na Meta", type: "select", options: [{ value: "aprovado", label: "Aprovado" }, { value: "pendente", label: "Em análise" }, { value: "rejeitado", label: "Rejeitado" }, { value: "pausado", label: "Pausado" }], required: true, span: 3 },
    { name: "corpo", label: "Texto (use {{1}}, {{2}}… como na Meta)", type: "textarea", rows: 4, required: true, span: 6 },
  ];
  return (
    <>
      <PageHeader eyebrow="Sistema" title="WhatsApp" description="Conexão com a API oficial do WhatsApp Business (Meta), horários, menu e modelos de mensagem." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Números conectados" icon={<MessageCircle className="h-4 w-4" />}
              action={configura && <FormDrawerButton action={salvarNumero} title="Conectar número" label="Conectar" size="sm" width="max-w-2xl" values={{ inicio: "08:00", fim: "18:00", sla_resposta_min: 30, ativo: true }} fields={camposNumero} />} />
            {!numeros?.length ? <EmptyState title="Nenhum número" description="Conecte o número oficial da empresa para receber e responder pelo sistema." /> : (
              <ul className="divide-y divide-line">
                {numeros.map((n) => {
                  const h = n.horario as { dias: number[]; inicio: string; fim: string };
                  return (
                    <li key={n.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium">{n.nome} · +{n.numero} {!n.ativo && <span className="text-xs text-muted">(inativo)</span>}</p>
                        <p className="text-xs text-muted">{h.inicio}–{h.fim} · {(n.menu as unknown[]).length} opção(ões) no menu · 1ª resposta em {n.sla_resposta_min} min</p>
                      </div>
                      {configura && (
                        <FormDrawerButton action={salvarNumero} title="Editar número" icon="edit" variant="ghost" size="sm" width="max-w-2xl" hidden={{ id: n.id }} fields={camposNumero}
                          values={{
                            nome: n.nome, numero: n.numero, phone_number_id: n.phone_number_id, waba_id: n.waba_id, departamento_id: n.departamento_id, sla_resposta_min: n.sla_resposta_min,
                            msg_boas_vindas: n.msg_boas_vindas, msg_fora_horario: n.msg_fora_horario, ativo: n.ativo, inicio: h.inicio, fim: h.fim,
                            sabado: h.dias.includes(6), domingo: h.dias.includes(7), menu: (n.menu as { departamento_id: string }[]).map((m) => m.departamento_id),
                          }} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Modelos de mensagem" description="Cadastre os modelos já aprovados no gerenciador da Meta (necessários fora da janela de 24 h e em campanhas)." icon={<FileText className="h-4 w-4" />}
              action={<FormDrawerButton action={salvarModelo} title="Novo modelo" label="Novo" size="sm" values={{ idioma: "pt_BR", categoria: "utility", status: "aprovado" }} fields={camposModelo} />} />
            {!modelos?.length ? <EmptyState title="Nenhum modelo" /> : (
              <ul className="divide-y divide-line">
                {modelos.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{m.nome} <span className="text-xs text-muted">{m.idioma} · {categorias[m.categoria]?.label} · {m.status}</span></p>
                      <p className="text-xs text-muted">{m.corpo}</p>
                    </div>
                    <FormDrawerButton action={salvarModelo} title="Editar modelo" icon="edit" variant="ghost" size="sm" hidden={{ id: m.id }} fields={camposModelo}
                      values={{ nome: m.nome, idioma: m.idioma, categoria: m.categoria, status: m.status, corpo: m.corpo }} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Webhook da Meta" icon={<Webhook className="h-4 w-4" />} />
          <CardBody>
            <div className="space-y-3 text-sm">
              <p>No aplicativo da Meta, configure:</p>
              <p><span className="text-muted">URL de callback</span><br /><code className="break-all">{env.siteUrl}/api/webhooks/meta</code></p>
              <p><span className="text-muted">Token de verificação</span><br />o valor de <code>WHATSAPP_VERIFY_TOKEN</code> (variável do servidor)</p>
              <p><span className="text-muted">Campos</span><br /><code>messages</code> (WhatsApp) e <code>leadgen</code> (página, para Lead Ads)</p>
              <p className={whatsappConfigurado() ? "text-emerald-700" : "text-amber-700"}>
                {whatsappConfigurado() ? "Servidor pronto: App Secret, token de verificação e chave de criptografia configurados." : "Faltam variáveis no servidor: WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN e APP_ENCRYPTION_KEY."}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
