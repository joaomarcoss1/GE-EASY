import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { updateComercial, updateEmpresa } from "@/lib/actions/configuracoes";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { PerfilTab } from "@/components/configuracoes/perfil-tab";
import { SegurancaTab } from "@/components/configuracoes/seguranca-tab";
import { IntegracoesTab } from "@/components/configuracoes/integracoes-tab";
import { UsuariosTab } from "@/components/configuracoes/usuarios-tab";
import { CadastrosTab } from "@/components/configuracoes/cadastros-tab";
import { DocumentacaoTab } from "@/components/configuracoes/documentacao-tab";
import { RotasTab } from "@/components/configuracoes/rotas-tab";
import { SettingsForm } from "@/components/configuracoes/settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { profile } = session;
  const sp = await searchParams;
  if (sp.tab === "auditoria") redirect("/auditoria");
  const gereUsuarios = can(profile, "usuarios.manage");
  const isAdmin = !!profile.admin_master || profile.role === "admin";
  const canCadastros = can(profile, "cadastros.manage");

  const tabs = [
    { key: "perfil", label: "Meu perfil" },
    { key: "seguranca", label: "Segurança e 2FA" },
    { key: "integracoes", label: "Integrações" },
    ...(gereUsuarios ? [{ key: "usuarios", label: "Usuários" }] : []),
    ...(canCadastros ? [{ key: "cadastros", label: "Cadastros" }, { key: "documentacao", label: "Documentação" }] : []),
    ...(can(profile, "rotas.definir") ? [{ key: "rotas", label: "Rotas e check-in" }] : []),
    ...(isAdmin ? [{ key: "empresa", label: "Empresa" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "perfil";

  return (
    <>
      <PageHeader eyebrow={session.empresa?.nome ?? "Sistema"} title="Configurações" description="Perfil, segurança, integrações e administração da empresa." />
      <LinkTabs base="/configuracoes" tabs={tabs} active={tab} />
      {tab === "perfil" && <PerfilTab session={session} />}
      {tab === "seguranca" && <SegurancaTab isAdmin={isAdmin} exigir2fa={sp.exigir2fa === "1"} />}
      {tab === "integracoes" && <IntegracoesTab ok={sp.ok} erro={sp.erro} isAdmin={can(profile, "integracoes.manage")} />}
      {tab === "usuarios" && gereUsuarios && <UsuariosTab currentUserId={profile.id} />}
      {tab === "cadastros" && canCadastros && <CadastrosTab />}
      {tab === "documentacao" && canCadastros && <DocumentacaoTab />}
      {tab === "rotas" && can(profile, "rotas.definir") && <RotasTab />}
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

