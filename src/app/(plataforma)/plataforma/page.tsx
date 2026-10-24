import type { Metadata } from "next";
import { Building2, HardDrive, Users } from "lucide-react";
import { requirePlataforma } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { date, num } from "@/lib/format";
import { atualizarEmpresa, criarEmpresa } from "@/lib/actions/plataforma";
import { solicitarSuporte } from "@/lib/actions/conta";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { formatBytes } from "@/components/documentos/mime";

export const metadata: Metadata = { title: "Plataforma" };

const STATUS = [
  { value: "trial", label: "Avaliação", tone: "amber" as const },
  { value: "ativa", label: "Ativa", tone: "green" as const },
  { value: "suspensa", label: "Suspensa", tone: "red" as const },
  { value: "cancelada", label: "Cancelada", tone: "slate" as const },
];
const MODULOS = [
  { value: "consultor", label: "Consultor" },
  { value: "administrativo", label: "Administrativo" },
  { value: "juridico", label: "Jurídico" },
  { value: "rh", label: "RH" },
  { value: "financeiro", label: "Financeiro" },
];

interface Uso {
  empresa_id: string; nome: string; slug: string; status: string; plano: string; limites: { max_usuarios?: number } | null; criada_em: string;
  usuarios_ativos: number; clientes: number; processos: number; documentos: number; armazenamento_bytes: number;
}

/** Empresas clientes: criação (com admin master), situação, plano, limites, módulos e uso. */
export default async function PlataformaPage() {
  await requirePlataforma();
  const supabase = await createClient();
  const [{ data, error }, { data: empresas }] = await Promise.all([
    supabase.rpc("plataforma_uso"),
    supabase.from("empresas").select("id, dominio, modulos"),
  ]);
  const uso = (data ?? []) as Uso[];
  const extra = new Map((empresas ?? []).map((e) => [e.id as string, e as { dominio: string | null; modulos: string[] }]));
  const tot = uso.reduce((a, u) => ({ usuarios: a.usuarios + Number(u.usuarios_ativos), bytes: a.bytes + Number(u.armazenamento_bytes) }), { usuarios: 0, bytes: 0 });

  return (
    <>
      <PageHeader
        eyebrow="Dono da plataforma"
        title="Empresas"
        description="Cada empresa tem dados totalmente isolados. Suspender bloqueia o acesso de todos os usuários dela."
        actions={
          <FormDrawerButton action={criarEmpresa} title="Nova empresa" label="Nova empresa" variant="accent" width="max-w-lg" submitLabel="Criar empresa"
            values={{ plano: "padrao", status: "trial" }}
            fields={[
              { name: "nome", label: "Nome da empresa", required: true, span: 6, section: "Empresa" },
              { name: "slug", label: "Endereço (slug)", required: true, span: 3, help: env.rootDomain ? `<slug>.${env.rootDomain}` : "Identificador curto, ex.: acme" },
              { name: "cnpj", label: "CNPJ", type: "documento", span: 3 },
              { name: "plano", label: "Plano", required: true, span: 3 },
              { name: "status", label: "Situação inicial", type: "select", options: STATUS.slice(0, 2), emptyOption: false, span: 3 },
              { name: "admin_nome", label: "Nome", required: true, span: 6, section: "Administrador master" },
              { name: "admin_email", label: "E-mail (login)", type: "email", required: true, span: 3 },
              { name: "admin_senha", label: "Senha inicial", type: "password", span: 3, help: "10+ caracteres com maiúscula, minúscula e número; trocada no 1º acesso. Ignorada se o e-mail já tiver conta." },
            ]}
          />
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Empresas" value={uso.length} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Usuários ativos" value={num(tot.usuarios)} icon={<Users className="h-5 w-5" />} tone="green" />
        <StatCard label="Armazenamento (documentos)" value={formatBytes(tot.bytes)} icon={<HardDrive className="h-5 w-5" />} tone="accent" />
      </div>
      <Card>
        <CardHeader title="Empresas e uso" />
        {error ? <EmptyState title="Não foi possível carregar" description={error.message} /> : uso.length === 0 ? <EmptyState title="Nenhuma empresa" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Empresa</th><th>Situação</th><th>Plano</th><th className="text-right">Usuários</th><th className="text-right">Clientes</th><th className="text-right">Processos</th><th className="text-right">Documentos</th><th>Desde</th><th /></tr></thead>
            <tbody>
              {uso.map((u) => {
                const e = extra.get(u.empresa_id);
                const st = STATUS.find((s) => s.value === u.status);
                const limite = u.limites?.max_usuarios;
                return (
                  <tr key={u.empresa_id}>
                    <td><span className="font-medium">{u.nome}</span><div className="text-xs text-muted">{e?.dominio ?? (env.rootDomain ? `${u.slug}.${env.rootDomain}` : u.slug)}</div></td>
                    <td><Badge tone={st?.tone ?? "slate"}>{st?.label ?? u.status}</Badge></td>
                    <td className="text-sm">{u.plano}</td>
                    <td className="text-right">{num(u.usuarios_ativos)}{limite ? <span className="text-xs text-muted"> / {limite}</span> : null}</td>
                    <td className="text-right">{num(u.clientes)}</td>
                    <td className="text-right">{num(u.processos)}</td>
                    <td className="text-right">{num(u.documentos)}<div className="text-xs text-muted">{formatBytes(Number(u.armazenamento_bytes))}</div></td>
                    <td className="text-xs text-muted">{date(u.criada_em)}</td>
                    <td className="text-right">
                      <FormDrawerButton action={atualizarEmpresa} hidden={{ id: u.empresa_id }} title={`Empresa: ${u.nome}`} icon="edit" size="icon" variant="ghost" width="max-w-lg"
                        values={{ status: u.status, plano: u.plano, max_usuarios: limite ?? "", dominio: e?.dominio ?? "", modulos: e?.modulos ?? [] }}
                        fields={[
                          { name: "status", label: "Situação", type: "select", options: STATUS, emptyOption: false, span: 3 },
                          { name: "plano", label: "Plano", required: true, span: 3 },
                          { name: "max_usuarios", label: "Limite de usuários ativos", type: "number", min: 1, span: 3 },
                          { name: "dominio", label: "Domínio próprio", placeholder: "sistema.empresa.com.br", span: 3 },
                          { name: "modulos", label: "Módulos contratados", type: "multiselect", options: MODULOS, span: 6 },
                        ]} />
                      <FormDrawerButton action={solicitarSuporte} hidden={{ empresa_id: u.empresa_id }} title={`Pedir acesso de suporte: ${u.nome}`} label="Suporte" icon="none" size="sm" variant="ghost" width="max-w-md" submitLabel="Enviar pedido"
                        description="O administrador master da empresa precisa autorizar. O acesso é temporário (até 72 h) e tudo fica na auditoria da empresa."
                        fields={[{ name: "motivo", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6 }]} />
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
