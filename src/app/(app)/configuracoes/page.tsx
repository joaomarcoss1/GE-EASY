import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Smartphone } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { salvarConfigApp, updateComercial, updateEmpresa } from "@/lib/actions/configuracoes";
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
import { AssinaturaTab, DadosTab, MarcaTab } from "@/components/configuracoes/conta-tabs";

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
    ...(profile.admin_master ? [{ key: "assinatura", label: "Assinatura" }, { key: "marca", label: "Marca e domínio" }, { key: "dados", label: "Dados e suporte" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "perfil";

  return (
    <>
      <PageHeader eyebrow={session.empresa?.nome ?? "Sistema"} title="Configurações" description="Perfil, segurança, integrações e administração da empresa." />
      <LinkTabs base="/configuracoes" tabs={tabs} active={tab} />
      {tab === "perfil" && <PerfilTab session={session} />}
      {tab === "seguranca" && <SegurancaTab isAdmin={isAdmin} exigir2fa={sp.exigir2fa === "1"} />}
      {tab === "integracoes" && <IntegracoesTab ok={sp.ok} erro={sp.erro} isAdmin={can(profile, "integracoes.manage")} />}
      {tab === "usuarios" && gereUsuarios && <UsuariosTab currentUserId={profile.id} isMaster={!!profile.admin_master} />}
      {tab === "cadastros" && canCadastros && <CadastrosTab />}
      {tab === "documentacao" && canCadastros && <DocumentacaoTab />}
      {tab === "rotas" && can(profile, "rotas.definir") && <RotasTab />}
      {tab === "empresa" && isAdmin && <EmpresaTab />}
      {tab === "assinatura" && profile.admin_master && <AssinaturaTab empresaId={session.empresa!.id} />}
      {tab === "marca" && profile.admin_master && <MarcaTab empresaId={session.empresa!.id} />}
      {tab === "dados" && profile.admin_master && <DadosTab empresaId={session.empresa!.id} slug={session.empresa!.slug} />}
    </>
  );
}

async function EmpresaTab() {
  const supabase = await createClient();
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", ["empresa", "comercial", "app", "ocr", "lgpd_termo"]);
  const empresa = (data?.find((c) => c.chave === "empresa")?.valor ?? {}) as Record<string, string | null>;
  const comercial = (data?.find((c) => c.chave === "comercial")?.valor ?? {}) as Record<string, number | null>;
  const app = (data?.find((c) => c.chave === "app")?.valor ?? {}) as { versao_minima?: string };
  const ocr = (data?.find((c) => c.chave === "ocr")?.valor ?? {}) as { ativo?: boolean };
  const termo = (data?.find((c) => c.chave === "lgpd_termo")?.valor ?? {}) as { versao?: string; texto?: string };
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
      <Card className="xl:col-span-2">
        <CardHeader title="App de campo" description="Termo LGPD do pré-cadastro, leitura automática de documentos e versão mínima do app." icon={<Smartphone className="h-4 w-4" />} />
        <CardBody>
          <SettingsForm
            action={salvarConfigApp}
            values={{
              versao_minima: app.versao_minima ?? "", ocr_ativo: !!ocr.ativo, termo_versao: termo.versao ?? "1.0",
              termo_texto: termo.texto ?? `Autorizo ${empresa.nome ?? "a empresa"} a tratar meus dados pessoais (nome, contato, documentos e localização do atendimento) para cadastro, análise de proposta e contato comercial, conforme a LGPD. Posso pedir acesso, correção ou exclusão a qualquer momento.`,
            }}
            fields={[
              { name: "termo_versao", label: "Versão do termo", required: true, span: 2, help: "Mude a versão ao alterar o texto" },
              { name: "versao_minima", label: "Versão mínima do app", span: 2, placeholder: "1.0.0" },
              { name: "ocr_ativo", label: "Ler documentos automaticamente (OCR — custo por página)", type: "checkbox", span: 2 },
              { name: "termo_texto", label: "Termo de consentimento (mostrado ao cliente)", type: "textarea", rows: 4, required: true, span: 6 },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

