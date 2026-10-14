import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, AlertTriangle, Scale, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { clienteOptions, departamentoMap, departamentoOptions, getProfileMap, juridicoOptions, pageRange, searchTerm } from "@/lib/data";
import { PROCESSO_AREAS, PROCESSO_FASES, PROCESSO_RISCO, PROCESSO_STATUS, type Tone } from "@/lib/constants";
import { brlShort, date, todayISO } from "@/lib/format";
import type { Processo } from "@/lib/types";
import { createProcesso } from "@/lib/actions/processos";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkButton } from "@/components/ui/button";
import { FilterSelect, Pagination, SearchInput, SegmentTabs } from "@/components/ui/filters";
import { processoFields } from "@/components/processos/fields";

export const metadata: Metadata = { title: "Processos" };

type Row = Pick<Processo, "id" | "titulo" | "numero_cnj" | "numero_interno" | "area" | "fase" | "status" | "risco" | "tribunal" | "comarca" | "uf" | "valor_causa" | "departamento_id" | "responsavel_id" | "parte_contraria" | "updated_at" | "segredo_justica"> & {
  clientes: { nome: string } | null;
};

export default async function ProcessosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("processos.view");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 25);
  const supabase = await createClient();
  const hoje = todayISO();

  let query = supabase
    .from("processos")
    .select("id, titulo, numero_cnj, numero_interno, area, fase, status, risco, tribunal, comarca, uf, valor_causa, departamento_id, responsavel_id, parte_contraria, updated_at, segredo_justica, clientes(nome)", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  const visao = sp.visao ?? "ativos";
  if (visao === "ativos") query = query.in("status", ["ativo", "suspenso"]);
  else if (visao === "meus") query = query.or(`responsavel_id.eq.${userId},equipe.cs.{${userId}}`);
  else if (visao === "encerrados") query = query.in("status", ["arquivado", "encerrado"]);

  const q = searchTerm(sp.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`titulo.ilike.%${q}%`, `parte_contraria.ilike.%${q}%`, `numero_interno.ilike.%${q}%`, `numero_cnj.ilike.%${q}%`, ...(digits.length >= 4 ? [`numero_cnj.ilike.%${digits.slice(0, 7)}%`] : [])].join(","),
    );
  }
  if (sp.area) query = query.eq("area", sp.area);
  if (sp.fase) query = query.eq("fase", sp.fase);
  if (sp.risco) query = query.eq("risco", sp.risco);
  if (sp.dep && /^[0-9a-f-]{36}$/i.test(sp.dep)) query = query.eq("departamento_id", sp.dep);
  if (sp.resp && /^[0-9a-f-]{36}$/i.test(sp.resp)) query = query.eq("responsavel_id", sp.resp);

  const [{ data, count }, ativosRes, vencidosRes, semanaRes, provRes, profiles, deps, clientes, departamentos, juridico] = await Promise.all([
    query,
    supabase.from("processos").select("id", { count: "exact", head: true }).in("status", ["ativo", "suspenso"]),
    supabase.from("prazos").select("id", { count: "exact", head: true }).eq("status", "pendente").lt("data_fim", hoje),
    supabase.from("prazos").select("id", { count: "exact", head: true }).eq("status", "pendente").gte("data_fim", hoje).lte("data_fim", addDays(hoje, 7)),
    supabase.from("processos").select("valor_provisionado").in("status", ["ativo", "suspenso"]).eq("risco", "provavel").limit(5000),
    getProfileMap(),
    departamentoMap(),
    clienteOptions(),
    departamentoOptions(),
    juridicoOptions(),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const provisionado = (provRes.data ?? []).reduce((a, r) => a + Number(r.valor_provisionado ?? 0), 0);
  const canWrite = can(profile.role, "processos.write");
  const filtered = Boolean(sp.q || sp.area || sp.fase || sp.risco || sp.dep || sp.resp);

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Processos"
        description="Carteira processual completa: partes, andamentos, prazos, audiências e financeiro de cada caso."
        actions={
          <>
            {can(profile.role, "relatorios.view") && (
              <LinkButton href="/api/exportar/processos" variant="secondary" prefetch={false}>
                Exportar CSV
              </LinkButton>
            )}
            {canWrite && (
              <FormDrawerButton
                action={createProcesso}
                fields={processoFields({ clientes, departamentos, juridico })}
                values={{ area: "civel", polo_cliente: "ativo", fase: "conhecimento", status: "ativo", instancia: 1, cliente_id: sp.cliente_id ?? "", departamento_id: sp.dep ?? "" }}
                title="Novo processo"
                label="Novo processo"
                variant="accent"
                redirectTo="/processos/:id"
                defaultOpen={sp.novo === "1"}
                width="max-w-3xl"
              />
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Processos em andamento" value={ativosRes.count ?? 0} icon={<Scale className="h-5 w-5" />} />
        <StatCard label="Prazos vencidos sem baixa" value={vencidosRes.count ?? 0} icon={<AlertTriangle className="h-5 w-5" />} tone={(vencidosRes.count ?? 0) > 0 ? "accent" : "green"} hint={(vencidosRes.count ?? 0) > 0 ? <Link href="/prazos" className="font-semibold text-accent-600 hover:underline">Ver prazos →</Link> : "Tudo em dia"} />
        <StatCard label="Prazos nos próximos 7 dias" value={semanaRes.count ?? 0} icon={<AlarmClock className="h-5 w-5" />} tone="amber" />
        <StatCard label="Provisão (risco provável)" value={brlShort(provisionado)} icon={<Wallet className="h-5 w-5" />} tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <SegmentTabs
            param="visao"
            options={[
              { value: "ativos", label: "Em andamento" },
              { value: "meus", label: "Meus processos" },
              { value: "todos", label: "Todos" },
              { value: "encerrados", label: "Encerrados" },
            ]}
          />
          <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
            <SearchInput placeholder="Nº CNJ, título, parte contrária…" />
            <FilterSelect param="area" options={PROCESSO_AREAS} allLabel="Todas as áreas" />
            <FilterSelect param="fase" options={PROCESSO_FASES} allLabel="Todas as fases" />
            <FilterSelect param="risco" options={PROCESSO_RISCO} allLabel="Qualquer risco" />
            <FilterSelect param="dep" options={departamentos} allLabel="Todos os departamentos" />
            {isManagerRole(profile.role) && <FilterSelect param="resp" options={juridico} allLabel="Todos os responsáveis" />}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Scale className="h-6 w-6" />}
            title="Nenhum processo encontrado"
            description={filtered ? "Ajuste os filtros para ver mais resultados." : "Cadastre o primeiro processo para começar a controlar prazos e audiências."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Processo</th>
                  <th>Cliente / parte contrária</th>
                  <th>Juízo</th>
                  <th>Fase</th>
                  <th>Risco</th>
                  <th>Departamento</th>
                  <th>Responsável</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const dep = p.departamento_id ? deps.get(p.departamento_id) : null;
                  const resp = p.responsavel_id ? profiles.get(p.responsavel_id) : null;
                  return (
                    <tr key={p.id}>
                      <td className="max-w-[320px]">
                        <Link href={`/processos/${p.id}`} className="block">
                          <span className="flex items-center gap-1.5 truncate font-semibold hover:text-brand-600">
                            {p.titulo}
                            {p.segredo_justica && <Badge tone="red">Segredo</Badge>}
                          </span>
                          <span className="block font-mono text-xs text-muted">{p.numero_cnj ?? p.numero_interno ?? "sem número"}</span>
                        </Link>
                      </td>
                      <td className="text-sm">
                        <div className="truncate">{p.clientes?.nome ?? <span className="text-muted">—</span>}</div>
                        {p.parte_contraria && <div className="truncate text-xs text-muted">× {p.parte_contraria}</div>}
                      </td>
                      <td className="text-xs">
                        <div>{p.tribunal ?? optionLabel(PROCESSO_AREAS, p.area)}</div>
                        <div className="text-muted">{[p.comarca, p.uf].filter(Boolean).join("/")}</div>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge options={PROCESSO_FASES} value={p.fase} />
                          {p.status !== "ativo" && <StatusBadge options={PROCESSO_STATUS} value={p.status} />}
                        </div>
                      </td>
                      <td>{p.risco ? <StatusBadge options={PROCESSO_RISCO} value={p.risco} /> : <span className="text-xs text-muted">—</span>}</td>
                      <td>{dep ? <Badge tone={(dep.cor as Tone) ?? "brand"}>{dep.sigla ?? dep.nome}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                      <td>
                        {resp ? (
                          <span className="flex items-center gap-2 text-sm">
                            <Avatar name={resp.full_name} src={resp.avatar_url} size={26} />
                            <span className="truncate">{resp.full_name.split(" ")[0]}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="text-xs text-muted">{date(p.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
