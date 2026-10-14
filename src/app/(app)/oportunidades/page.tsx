import type { Metadata } from "next";
import { Suspense } from "react";
import { KanbanSquare, Target, Trophy, TrendingUp } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, produtoOptions, searchTerm } from "@/lib/data";
import { ETAPAS, LINHAS, type Option } from "@/lib/constants";
import { brlShort, pct, todayISO } from "@/lib/format";
import { createOportunidade, deleteOportunidade, moveOportunidade, updateOportunidade } from "@/lib/actions/oportunidades";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { KanbanBoard, type OpItem } from "@/components/oportunidades/kanban-board";

export const metadata: Metadata = { title: "Funil de vendas" };

function oportunidadeFields(clientes: Option[], produtos: Option[], consultores: Option[], canTransfer: boolean): FieldDef[] {
  return [
    { name: "titulo", label: "Título", required: true, placeholder: "Ex.: Consórcio imóvel R$ 300 mil", span: 6 },
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, required: true, span: 6 },
    { name: "linha", label: "Linha de negócio", type: "select", options: LINHAS, emptyOption: false, required: true, span: 3 },
    { name: "produto_id", label: "Produto", type: "select", options: produtos, emptyOption: "Não definido", span: 3 },
    { name: "valor", label: "Valor (crédito / prêmio)", type: "money", span: 3 },
    { name: "etapa", label: "Etapa", type: "select", options: ETAPAS, emptyOption: false, span: 3 },
    { name: "probabilidade", label: "Probabilidade", type: "number", min: 0, max: 100, help: "Em branco = padrão da etapa", span: 3 },
    { name: "previsao_fechamento", label: "Previsão de fechamento", type: "date", span: 3 },
    ...(canTransfer ? [{ name: "consultor_id", label: "Consultor", type: "select", options: consultores, emptyOption: "Eu mesmo", span: 6 } as FieldDef] : []),
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6 },
  ];
}

export default async function OportunidadesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.view");
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("oportunidades")
    .select("id, titulo, cliente_id, linha, produto_id, valor, etapa, probabilidade, previsao_fechamento, motivo_perda, consultor_id, observacoes, fechado_em, created_at, clientes(nome)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (sp.linha === "consorcio" || sp.linha === "seguro") query = query.eq("linha", sp.linha);
  if (sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor)) query = query.eq("consultor_id", sp.consultor);
  const q = searchTerm(sp.q);
  if (q) query = query.ilike("titulo", `%${q}%`);
  const { data } = await query;

  const [profiles, clientes, produtosConsorcio, produtosSeguro, consultores] = await Promise.all([
    getProfileMap(),
    clienteOptions(),
    produtoOptions("consorcio"),
    produtoOptions("seguro"),
    consultorOptions(),
  ]);

  // Oportunidades fechadas há mais de 90 dias saem do quadro para mantê-lo leve
  const corte = new Date(Date.now() - 90 * 86400000).toISOString();
  const items: OpItem[] = (data ?? [])
    .map((o) => {
      const cli = o.clientes as unknown as { nome: string } | null;
      return {
        ...o,
        valor: Number(o.valor),
        cliente_nome: cli?.nome ?? null,
        consultor_nome: o.consultor_id ? (profiles.get(o.consultor_id)?.full_name ?? null) : null,
      } as OpItem;
    })
    .filter((o) => !o.fechado_em || o.fechado_em >= corte);

  const abertas = items.filter((o) => !["ganho", "perdido"].includes(o.etapa));
  const pipeline = abertas.reduce((a, o) => a + o.valor, 0);
  const ponderado = abertas.reduce((a, o) => a + (o.valor * o.probabilidade) / 100, 0);
  const mes = todayISO().slice(0, 7);
  const ganhasMes = items.filter((o) => o.etapa === "ganho" && o.fechado_em?.slice(0, 7) === mes);
  const fechadas = items.filter((o) => o.etapa === "ganho" || o.etapa === "perdido");
  const conversao = fechadas.length ? (fechadas.filter((o) => o.etapa === "ganho").length / fechadas.length) * 100 : 0;

  const canWrite = can(profile.role, "negocios.write");
  const canTransfer = can(profile.role, "clientes.transfer");
  const produtos = [...produtosConsorcio, ...produtosSeguro];
  const fields = oportunidadeFields(clientes, produtos, consultores, canTransfer);

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Funil de vendas"
        description="Arraste os cartões entre as etapas. Oportunidades ganhas ou perdidas há mais de 90 dias saem do quadro."
        actions={
          canWrite && (
            <FormDrawerButton
              action={createOportunidade}
              fields={fields}
              values={{ linha: "consorcio", etapa: "novo", cliente_id: sp.cliente_id ?? "" }}
              title="Nova oportunidade"
              label="Nova oportunidade"
              variant="accent"
              defaultOpen={sp.novo === "1"}
            />
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pipeline aberto" value={brlShort(pipeline)} hint={`${abertas.length} oportunidade(s)`} icon={<KanbanSquare className="h-5 w-5" />} />
        <StatCard label="Previsão ponderada" value={brlShort(ponderado)} hint="valor × probabilidade" icon={<TrendingUp className="h-5 w-5" />} tone="accent" />
        <StatCard label="Ganhos no mês" value={brlShort(ganhasMes.reduce((a, o) => a + o.valor, 0))} hint={`${ganhasMes.length} negócio(s)`} icon={<Trophy className="h-5 w-5" />} tone="green" />
        <StatCard label="Taxa de conversão" value={pct(conversao)} hint="ganhas ÷ fechadas" icon={<Target className="h-5 w-5" />} tone="amber" />
      </div>
      <Card className="mb-5">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Buscar por título…" />
          <FilterSelect param="linha" options={LINHAS} allLabel="Consórcio e seguro" />
          {canTransfer && <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />}
        </div>
      </Card>
      <Suspense>
        <KanbanBoard
          items={items}
          today={todayISO()}
          canWrite={canWrite}
          canDelete={can(profile.role, "negocios.delete")}
          showConsultor={canTransfer}
          editFields={fields}
          actions={{ move: moveOportunidade, update: updateOportunidade, remove: deleteOportunidade }}
          initialOpenId={sp.abrir ?? null}
        />
      </Suspense>
    </>
  );
}
