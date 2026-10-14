import type { Metadata } from "next";
import { Suspense } from "react";
import { Building2, History } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap, pageRange } from "@/lib/data";
import { updateComercial, updateEmpresa } from "@/lib/actions/configuracoes";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination } from "@/components/ui/filters";
import { PerfilTab } from "@/components/configuracoes/perfil-tab";
import { SegurancaTab } from "@/components/configuracoes/seguranca-tab";
import { IntegracoesTab } from "@/components/configuracoes/integracoes-tab";
import { UsuariosTab } from "@/components/configuracoes/usuarios-tab";
import { CadastrosTab } from "@/components/configuracoes/cadastros-tab";
import { SettingsForm } from "@/components/configuracoes/settings-form";
import { AuditLogList, type AuditItem } from "@/components/configuracoes/audit-log-list";
import { DateRangeFilter } from "@/components/configuracoes/audit-filters";

export const metadata: Metadata = { title: "Configurações" };

const TABELAS: Record<string, string> = {
  profiles: "Usuários",
  parceiros: "Parceiros",
  produtos: "Produtos",
  clientes: "Clientes",
  oportunidades: "Oportunidades",
  consorcio_cotas: "Cotas de consórcio",
  consorcio_lances: "Lances",
  seguro_apolices: "Apólices",
  seguro_sinistros: "Sinistros",
  comissoes: "Comissões",
  metas: "Metas",
  documentos: "Documentos",
  configuracoes: "Configurações",
};

export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { profile } = session;
  const sp = await searchParams;
  const isAdmin = can(profile.role, "usuarios.manage");
  const canCadastros = can(profile.role, "cadastros.manage");

  const tabs = [
    { key: "perfil", label: "Meu perfil" },
    { key: "seguranca", label: "Segurança e 2FA" },
    { key: "integracoes", label: "Integrações" },
    ...(isAdmin ? [{ key: "usuarios", label: "Usuários" }] : []),
    ...(canCadastros ? [{ key: "cadastros", label: "Cadastros" }] : []),
    ...(can(profile.role, "auditoria.view") ? [{ key: "auditoria", label: "Auditoria" }] : []),
    ...(isAdmin ? [{ key: "empresa", label: "Empresa" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "perfil";

  return (
    <>
      <PageHeader eyebrow="Sistema" title="Configurações" description="Perfil, segurança, integrações com o Google e administração do GE EASY." />
      <LinkTabs base="/configuracoes" tabs={tabs} active={tab} />
      {tab === "perfil" && <PerfilTab session={session} />}
      {tab === "seguranca" && <SegurancaTab />}
      {tab === "integracoes" && <IntegracoesTab ok={sp.ok} erro={sp.erro} />}
      {tab === "usuarios" && isAdmin && <UsuariosTab currentUserId={profile.id} />}
      {tab === "cadastros" && canCadastros && <CadastrosTab />}
      {tab === "auditoria" && <AuditoriaTab sp={sp} />}
      {tab === "empresa" && isAdmin && <EmpresaTab />}
    </>
  );
}

async function EmpresaTab() {
  const supabase = await createClient();
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", ["empresa", "comercial"]);
  const empresa = (data?.find((c) => c.chave === "empresa")?.valor ?? {}) as Record<string, string | null>;
  const comercial = (data?.find((c) => c.chave === "comercial")?.valor ?? {}) as Record<string, number | null>;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Dados da empresa" description="Usados em relatórios e propostas impressas" icon={<Building2 className="h-4 w-4" />} />
        <CardBody>
          <SettingsForm
            action={updateEmpresa}
            values={empresa}
            fields={[
              { name: "nome", label: "Nome / razão social", required: true, span: 6 },
              { name: "cnpj", label: "CNPJ", type: "documento", span: 3 },
              { name: "telefone", label: "Telefone", type: "tel", span: 3 },
              { name: "email", label: "E-mail", type: "email", span: 3 },
              { name: "site", label: "Site", type: "url", placeholder: "https://", span: 3 },
              { name: "endereco", label: "Endereço completo", type: "textarea", rows: 2, span: 6 },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Parâmetros comerciais" />
        <CardBody>
          <SettingsForm
            action={updateComercial}
            values={{ dias_alerta_renovacao: comercial.dias_alerta_renovacao ?? 30 }}
            fields={[{ name: "dias_alerta_renovacao", label: "Avisar renovações com antecedência de (dias)", type: "number", min: 1, max: 180, required: true }]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

async function AuditoriaTab({ sp }: { sp: Record<string, string | undefined> }) {
  const supabase = await createClient();
  const { page, size, from, to } = pageRange(sp.page, 30);
  let query = supabase.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (sp.tabela && TABELAS[sp.tabela]) query = query.eq("tabela", sp.tabela);
  if (sp.acao && ["INSERT", "UPDATE", "DELETE"].includes(sp.acao)) query = query.eq("acao", sp.acao);
  if (sp.usuario && /^[0-9a-f-]{36}$/i.test(sp.usuario)) query = query.eq("actor_id", sp.usuario);
  if (sp.de && /^\d{4}-\d{2}-\d{2}$/.test(sp.de)) query = query.gte("created_at", `${sp.de}T00:00:00-03:00`);
  if (sp.ate && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate)) query = query.lte("created_at", `${sp.ate}T23:59:59-03:00`);
  const [{ data, count }, profiles] = await Promise.all([query, getProfileMap()]);

  const items: AuditItem[] = (data ?? []).map((l) => ({
    id: l.id,
    created_at: l.created_at,
    actor: l.actor_id ? (profiles.get(l.actor_id)?.full_name ?? l.actor_email ?? "Usuário removido") : "Sistema",
    acao: l.acao,
    tabela: l.tabela,
    tabelaLabel: TABELAS[l.tabela] ?? l.tabela,
    registro_id: l.registro_id,
    dados_antigos: l.dados_antigos,
    dados_novos: l.dados_novos,
  }));
  const usuarios = [...profiles.values()].map((p) => ({ value: p.id, label: p.full_name || p.email }));

  return (
    <Card>
      <CardHeader title="Trilha de auditoria" description="Toda inclusão, alteração e exclusão nas tabelas de negócio" icon={<History className="h-4 w-4" />} />
      <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <FilterSelect param="tabela" options={Object.entries(TABELAS).map(([value, label]) => ({ value, label }))} allLabel="Todas as tabelas" />
        <FilterSelect param="acao" options={[{ value: "INSERT", label: "Inclusão" }, { value: "UPDATE", label: "Alteração" }, { value: "DELETE", label: "Exclusão" }]} allLabel="Todas as ações" />
        <FilterSelect param="usuario" options={usuarios} allLabel="Todos os usuários" />
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>
      {items.length === 0 ? <EmptyState title="Nenhum registro no período" /> : <AuditLogList items={items} />}
      <Pagination page={page} pageSize={size} total={count ?? 0} />
    </Card>
  );
}
