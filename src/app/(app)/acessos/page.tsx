import type { Metadata } from "next";
import Link from "next/link";
import { Eye, KeyRound, Layers, UserMinus, UserPlus } from "lucide-react";
import { requireMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AREAS } from "@/lib/constants";
import { date } from "@/lib/format";
import { copiarAcessos, criarNivel, removerExcecao, salvarExcecao, salvarNivel } from "@/lib/actions/acessos";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/tabs";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ResourceForm } from "@/components/ui/form";
import { MatrizAcessos, type DepMatriz, type PessoaMatriz } from "@/components/acessos/matriz";

export const metadata: Metadata = { title: "Acessos" };

interface Funcionalidade { chave: string; nome: string; area: string | null; sensivel: boolean; ordem: number }

/**
 * Administrador master: quem acessa quais departamentos, com qual nível e quais funcionalidades.
 * Toda alteração é auditada (Auditoria › tabelas de acesso) e vale na próxima requisição do usuário.
 */
export default async function AcessosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireMaster();
  const sp = await searchParams;
  const tab = ["matriz", "niveis", "excecoes"].includes(sp.tab ?? "") ? sp.tab! : "matriz";
  const supabase = await createClient();
  const [{ data: membros }, { data: deps }, { data: niveis }, { data: vinculos }, { data: funcs }, { data: nivelFuncs }, { data: extras }] = await Promise.all([
    supabase.from("membros").select("id, full_name, email, role, active, admin_master, is_master").order("full_name"),
    supabase.from("departamentos").select("id, nome, sigla, tipo").eq("ativo", true).order("tipo").order("nome"),
    supabase.from("departamento_niveis").select("id, departamento_id, nome, ordem").order("ordem"),
    supabase.from("departamento_membros").select("departamento_id, user_id, nivel_id"),
    supabase.from("funcionalidades").select("chave, nome, area, sensivel, ordem").order("ordem"),
    supabase.from("nivel_funcionalidades").select("nivel_id, funcionalidade"),
    supabase.from("usuario_permissoes_extra").select("id, user_id, funcionalidade, tipo, motivo, valido_ate, created_at").order("created_at", { ascending: false }),
  ]);
  const catalogo = (funcs ?? []) as Funcionalidade[];
  const nomeFunc = new Map(catalogo.map((f) => [f.chave, f.nome]));
  const pessoasBase = membros ?? [];
  const nomePessoa = new Map(pessoasBase.map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  const depLista: DepMatriz[] = (deps ?? []).map((d) => ({
    id: d.id,
    nome: d.sigla || d.nome,
    area: AREAS.find((a) => a.value === d.tipo)?.label ?? "Personalizado",
    niveis: (niveis ?? []).filter((n) => n.departamento_id === d.id).map((n) => ({ id: n.id, nome: n.nome })),
  }));
  const pessoas: PessoaMatriz[] = pessoasBase.map((p) => ({
    id: p.id,
    nome: p.full_name,
    email: p.email,
    role: p.role,
    ativo: p.active,
    master: p.admin_master,
    plataforma: !!p.is_master, // dono da plataforma: intocável por outros (o banco também bloqueia)
    niveis: Object.fromEntries((vinculos ?? []).filter((v) => v.user_id === p.id).map((v) => [v.departamento_id, v.nivel_id])),
  }));
  const opcoesPessoas = pessoasBase.filter((p) => p.id !== session.userId).map((p) => ({ value: p.id as string, label: (p.full_name as string) || (p.email as string) }));
  const opcoesFunc = catalogo.map((f) => ({ value: f.chave, label: `${f.nome}${f.sensivel ? " (sensível)" : ""}` }));
  const ver = sp.ver && /^[0-9a-f-]{36}$/i.test(sp.ver) ? sp.ver : null;
  const { data: efetivas } = ver ? await supabase.rpc("permissoes_do_usuario", { p_user: ver }) : { data: null };

  return (
    <>
      <PageHeader
        eyebrow="Sistema"
        title="Acessos"
        description="Departamentos, níveis e funcionalidades de cada funcionário. O perfil define o escopo dos dados (próprios, departamento ou empresa); os níveis definem o que cada um pode fazer."
        actions={
          <>
            <FormDrawerButton action={copiarAcessos} title="Copiar acessos (igual ao fulano)" label="Copiar perfil" icon="none" variant="secondary" width="max-w-md"
              fields={[{ name: "origem", label: "Copiar de", type: "select", options: opcoesPessoas, required: true, span: 6 }, { name: "destino", label: "Para", type: "select", options: opcoesPessoas, required: true, span: 6 }]} />
            <Link href="/auditoria?grupo=acessos" className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">Histórico</Link>
          </>
        }
      />
      {ver && (
        <Card className="mb-6">
          <CardHeader title={`Ver como: ${nomePessoa.get(ver) ?? "usuário"}`} description="Funcionalidades efetivas hoje (níveis + exceções). Simulação somente leitura." icon={<Eye className="h-4 w-4" />} action={<Link href="/acessos" className="text-sm font-semibold text-brand-600">Fechar</Link>} />
          <CardBody>
            {(efetivas as string[] | null)?.length ? (
              <div className="flex flex-wrap gap-1.5">{(efetivas as string[]).map((f) => <Badge key={f} tone="brand">{nomeFunc.get(f) ?? f}</Badge>)}</div>
            ) : <p className="text-sm text-muted">Nenhuma funcionalidade: o usuário só consegue entrar e ver o painel vazio.</p>}
          </CardBody>
        </Card>
      )}
      <LinkTabs base="/acessos" active={tab} tabs={[{ key: "matriz", label: "Funcionários × departamentos" }, { key: "niveis", label: "Níveis e funcionalidades" }, { key: "excecoes", label: "Exceções individuais", count: (extras ?? []).length }]} />

      {tab === "matriz" && (
        <Card>
          <CardHeader title="Matriz de acessos" description="Escolha o nível de cada pessoa em cada departamento. Clique no nome para ver as permissões efetivas." icon={<KeyRound className="h-4 w-4" />} />
          {pessoas.length === 0 ? <EmptyState title="Nenhum usuário" /> : <MatrizAcessos pessoas={pessoas} deps={depLista} eu={session.userId} />}
        </Card>
      )}

      {tab === "niveis" && (
        <div className="space-y-6">
          {depLista.map((d) => (
            <Card key={d.id}>
              <CardHeader
                title={`${d.nome} · ${d.area}`}
                icon={<Layers className="h-4 w-4" />}
                action={<FormDrawerButton action={criarNivel} hidden={{ departamento_id: d.id }} title={`Novo nível em ${d.nome}`} label="Novo nível" size="sm" variant="secondary" width="max-w-md"
                  fields={[{ name: "nome", label: "Nome", required: true, span: 4 }, { name: "ordem", label: "Ordem", type: "number", min: 1, max: 20, span: 2 }]} values={{ ordem: d.niveis.length + 1 }} />}
              />
              <CardBody className="grid gap-4 lg:grid-cols-3">
                {d.niveis.map((n) => {
                  const tem = new Set((nivelFuncs ?? []).filter((x) => x.nivel_id === n.id).map((x) => x.funcionalidade as string));
                  return (
                    <details key={n.id} className="rounded-xl border border-line p-3">
                      <summary className="cursor-pointer text-sm font-semibold">{n.nome} <span className="font-normal text-muted">· {tem.size} funcionalidade(s)</span></summary>
                      <div className="mt-3">
                        <ResourceForm
                          action={salvarNivel}
                          hidden={{ nivel_id: n.id }}
                          submitLabel="Salvar nível"
                          fields={[{ name: "f", label: "Funcionalidades", type: "multiselect", options: opcoesFunc, span: 6 }]}
                          values={{ f: [...tem] }}
                        />
                      </div>
                    </details>
                  );
                })}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === "excecoes" && (
        <Card>
          <CardHeader
            title="Exceções individuais"
            description="Concede ou revoga uma funcionalidade para uma pessoa, acima dos níveis. Use com motivo e, se possível, validade."
            action={<FormDrawerButton action={salvarExcecao} title="Nova exceção" label="Nova exceção" size="sm" variant="accent" width="max-w-lg"
              fields={[
                { name: "user_id", label: "Funcionário", type: "select", options: opcoesPessoas, required: true, span: 6 },
                { name: "funcionalidade", label: "Funcionalidade", type: "select", options: opcoesFunc, required: true, span: 6 },
                { name: "tipo", label: "Tipo", type: "select", options: [{ value: "concessao", label: "Conceder" }, { value: "revogacao", label: "Revogar" }], emptyOption: false, span: 3 },
                { name: "valido_ate", label: "Válida até", type: "date", span: 3 },
                { name: "motivo", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6 },
              ]} values={{ tipo: "concessao" }} />}
          />
          {(extras ?? []).length === 0 ? <EmptyState title="Nenhuma exceção" /> : (
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Funcionário</th><th>Funcionalidade</th><th>Tipo</th><th>Motivo</th><th>Validade</th><th /></tr></thead><tbody>
              {(extras ?? []).map((x) => (
                <tr key={x.id}>
                  <td className="font-medium">{nomePessoa.get(x.user_id) ?? "—"}</td>
                  <td className="text-sm">{nomeFunc.get(x.funcionalidade) ?? x.funcionalidade}</td>
                  <td>{x.tipo === "concessao" ? <Badge tone="green"><UserPlus className="mr-1 inline h-3 w-3" />Concedida</Badge> : <Badge tone="red"><UserMinus className="mr-1 inline h-3 w-3" />Revogada</Badge>}</td>
                  <td className="max-w-[280px] text-xs text-muted">{x.motivo}</td>
                  <td className="text-xs">{x.valido_ate ? date(x.valido_ate) : "Sem prazo"}</td>
                  <td className="text-right"><ConfirmAction action={removerExcecao} id={x.id} title="Remover exceção?" message="O usuário volta a ter só o que os níveis dos departamentos concedem." confirmLabel="Remover" /></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </Card>
      )}
    </>
  );
}
