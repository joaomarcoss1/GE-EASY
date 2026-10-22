import type { Metadata } from "next";
import { Suspense } from "react";
import { Hourglass, MessagesSquare, Target, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, departamentoOptions, getProfileMap, juridicoOptions, searchTerm } from "@/lib/data";
import { ATENDIMENTO_CANAIS, ATENDIMENTO_STATUS, CONTRATO_TIPOS, PRIORIDADES, PROCESSO_AREAS } from "@/lib/constants";
import { brlShort, pct, todayISO } from "@/lib/format";
import type { Atendimento } from "@/lib/types";
import { converterAtendimento, moverAtendimento, saveAtendimento } from "@/lib/actions/atendimentos";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { AtendimentosBoard, type AtendCard } from "@/components/atendimentos/board";

export const metadata: Metadata = { title: "Atendimentos" };

export default async function AtendimentosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("atendimentos.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const corte = new Date(Date.now() - 120 * 86400000).toISOString();

  let query = supabase.from("atendimentos").select("*").or(`status.in.(novo,em_analise,proposta_enviada),updated_at.gte.${corte}`).order("data", { ascending: false }).limit(800);
  if (sp.area) query = query.eq("area", sp.area);
  if (sp.canal) query = query.eq("canal", sp.canal);
  if (sp.resp && /^[0-9a-f-]{36}$/i.test(sp.resp)) query = query.eq("responsavel_id", sp.resp);
  const q = searchTerm(sp.q);
  if (q) query = query.or(`nome_contato.ilike.%${q}%,assunto.ilike.%${q}%`);

  const [{ data }, profiles, juridico, departamentos, clientes] = await Promise.all([query, getProfileMap(), juridicoOptions(), departamentoOptions(), clienteOptions()]);
  const rows = (data ?? []) as Atendimento[];
  const hoje = todayISO();
  const semana = new Date(Date.now() - 7 * 86400000).toISOString();
  const mes = hoje.slice(0, 7);
  const doMes = rows.filter((r) => r.data.slice(0, 7) === mes);
  const fechadosMes = doMes.filter((r) => ["contratado", "recusado"].includes(r.status));
  const conversao = fechadosMes.length ? (fechadosMes.filter((r) => r.status === "contratado").length / fechadosMes.length) * 100 : 0;
  const negociacao = rows.filter((r) => ["em_analise", "proposta_enviada"].includes(r.status)).reduce((a, r) => a + Number(r.valor_estimado ?? 0), 0);

  const fields: FieldDef[] = [
    { name: "nome_contato", label: "Nome", required: true, span: 4, section: "Contato" },
    { name: "canal", label: "Canal", type: "select", options: ATENDIMENTO_CANAIS, emptyOption: false, span: 2 },
    { name: "telefone", label: "Telefone / WhatsApp", type: "tel", span: 3 },
    { name: "email", label: "E-mail", type: "email", span: 3 },
    { name: "cliente_id", label: "Já é cliente?", type: "select", options: clientes, emptyOption: "Não / novo contato", span: 4 },
    { name: "data", label: "Data e hora", type: "datetime-local", span: 2 },
    { name: "assunto", label: "Assunto", required: true, span: 4, section: "Caso" },
    { name: "area", label: "Área", type: "select", options: PROCESSO_AREAS, emptyOption: false, span: 2 },
    { name: "relato", label: "Relato do caso", type: "textarea", rows: 5, span: 6 },
    { name: "urgencia", label: "Urgência", type: "select", options: PRIORIDADES, emptyOption: false, span: 2 },
    { name: "status", label: "Etapa", type: "select", options: ATENDIMENTO_STATUS, emptyOption: false, span: 2 },
    { name: "valor_estimado", label: "Valor estimado", type: "money", span: 2 },
    { name: "responsavel_id", label: "Responsável", type: "select", options: juridico, emptyOption: "Eu mesmo", span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: departamentos, emptyOption: "—", span: 3 },
  ];
  const converterFields: FieldDef[] = [
    { name: "documento", label: "CPF / CNPJ do cliente", type: "documento", span: 6, help: "Se já existir cliente com este documento, ele é reaproveitado." },
    ...(can(profile, "processos.write")
      ? ([
          { name: "criar_processo", label: "Abrir processo / caso", type: "checkbox", span: 6 },
          { name: "titulo_processo", label: "Título do processo", span: 6 },
          { name: "departamento_id", label: "Departamento", type: "select", options: departamentos, emptyOption: "Do atendimento", span: 3 },
          { name: "responsavel_id", label: "Advogado responsável", type: "select", options: juridico, emptyOption: "Do atendimento", span: 3 },
        ] as FieldDef[])
      : []),
    ...(can(profile, "contratos.write")
      ? ([
          { name: "criar_contrato", label: "Criar contrato de honorários", type: "checkbox", span: 6, section: "Honorários" },
          { name: "tipo_contrato", label: "Modalidade", type: "select", options: CONTRATO_TIPOS, emptyOption: false, span: 2 },
          { name: "valor_contrato", label: "Valor (fixo / mensal / hora)", type: "money", span: 2 },
          { name: "percentual_exito", label: "% de êxito", type: "percent", span: 2 },
        ] as FieldDef[])
      : []),
  ];

  const items: AtendCard[] = rows.map((r) => ({
    id: r.id,
    nome_contato: r.nome_contato,
    telefone: r.telefone,
    email: r.email,
    canal: r.canal,
    data: r.data,
    area: r.area,
    assunto: r.assunto,
    relato: r.relato,
    urgencia: r.urgencia,
    status: r.status,
    valor_estimado: r.valor_estimado,
    responsavel: r.responsavel_id ? (profiles.get(r.responsavel_id)?.full_name ?? null) : null,
    motivo_recusa: r.motivo_recusa,
    processo_id: r.processo_id,
    cliente_id: r.cliente_id,
    values: {
      nome_contato: r.nome_contato, canal: r.canal, telefone: r.telefone, email: r.email, cliente_id: r.cliente_id,
      data: new Date(new Date(r.data).getTime() - 3 * 3600000).toISOString().slice(0, 16),
      assunto: r.assunto, area: r.area, relato: r.relato, urgencia: r.urgencia, status: r.status, valor_estimado: r.valor_estimado,
      responsavel_id: r.responsavel_id, departamento_id: r.departamento_id,
    },
  }));

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Atendimentos e triagem"
        description="Do primeiro contato à contratação: registre consultas, avalie a viabilidade e converta em cliente, processo e contrato."
        actions={<FormDrawerButton action={saveAtendimento} fields={fields} values={{ canal: "presencial", area: "civel", urgencia: "media", status: "novo" }} title="Novo atendimento" label="Novo atendimento" variant="accent" width="max-w-2xl" defaultOpen={sp.novo === "1"} />}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Novos na semana" value={rows.filter((r) => r.created_at >= semana).length} icon={<MessagesSquare className="h-5 w-5" />} />
        <StatCard label="Em análise / proposta" value={rows.filter((r) => ["em_analise", "proposta_enviada"].includes(r.status)).length} icon={<Hourglass className="h-5 w-5" />} tone="amber" />
        <StatCard label="Conversão no mês" value={pct(conversao, 0)} hint={`${fechadosMes.length} decidido(s)`} icon={<Target className="h-5 w-5" />} tone="green" />
        <StatCard label="Em negociação" value={brlShort(negociacao)} icon={<Wallet className="h-5 w-5" />} tone="accent" />
      </div>
      <Card className="mb-5">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nome ou assunto…" />
          <FilterSelect param="area" options={PROCESSO_AREAS} allLabel="Todas as áreas" />
          <FilterSelect param="canal" options={ATENDIMENTO_CANAIS} allLabel="Todos os canais" />
          <FilterSelect param="resp" options={juridico} allLabel="Todos os responsáveis" />
        </div>
      </Card>
      <Suspense>
        <AtendimentosBoard items={items} editFields={fields} converterFields={converterFields} actions={{ save: saveAtendimento, mover: moverAtendimento, converter: converterAtendimento }} />
      </Suspense>
    </>
  );
}
