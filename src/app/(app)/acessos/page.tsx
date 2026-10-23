import type { Metadata } from "next";
import Link from "next/link";
import { Eye, KeyRound, Layers, Smartphone, UserMinus, UserPlus, Users } from "lucide-react";
import { requireMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AREAS, ROLES } from "@/lib/constants";
import { date, dateTime } from "@/lib/format";
import { menuDaArea } from "@/lib/nav";
import { isArea } from "@/lib/tenant";
import { registrarAcesso } from "@/lib/actions/utils";
import { aplicarNivelEmMassa, copiarAcessos, criarNivel, removerExcecao, revogarDispositivo, salvarEquipe, salvarExcecao, salvarNivel } from "@/lib/actions/acessos";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton } from "@/components/ui/button";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ResourceForm } from "@/components/ui/form";
import { MatrizAcessos, type DepMatriz, type PessoaMatriz } from "@/components/acessos/matriz";

export const metadata: Metadata = { title: "Acessos" };

interface Funcionalidade { chave: string; nome: string; area: string | null; sensivel: boolean; ordem: number }
interface ContextoUsuario {
  permissoes: string[];
  areas: string[];
  membro: { role: string; ativo: boolean; admin_master: boolean } | null;
  departamentos: { departamento: string; nivel: string | null; ativo: boolean; valido_ate: string | null }[];
  equipe: string[];
}

/**
 * Administrador master: quem acessa quais departamentos, com qual nível e quais funcionalidades; equipes
 * (escopo de supervisão), aparelhos do app e simulação "ver como". Toda alteração é auditada e vale na
 * próxima requisição do usuário.
 */
export default async function AcessosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireMaster();
  const sp = await searchParams;
  const tab = ["matriz", "niveis", "excecoes", "equipes", "dispositivos"].includes(sp.tab ?? "") ? sp.tab! : "matriz";
  const supabase = await createClient();
  const [{ data: membros }, { data: deps }, { data: niveis }, { data: vinculos }, { data: funcs }, { data: nivelFuncs }, { data: extras }, { data: equipes }, { data: aparelhos }] = await Promise.all([
    supabase.from("membros").select("id, full_name, email, role, active, admin_master, is_master").order("full_name"),
    supabase.from("departamentos").select("id, nome, sigla, tipo").eq("ativo", true).order("tipo").order("nome"),
    supabase.from("departamento_niveis").select("id, departamento_id, nome, ordem").order("ordem"),
    supabase.from("departamento_membros").select("departamento_id, user_id, nivel_id"),
    supabase.from("funcionalidades").select("chave, nome, area, sensivel, ordem").order("ordem"),
    supabase.from("nivel_funcionalidades").select("nivel_id, funcionalidade"),
    supabase.from("usuario_permissoes_extra").select("id, user_id, funcionalidade, tipo, motivo, valido_ate, created_at").order("created_at", { ascending: false }),
    supabase.from("equipe_membros").select("supervisor_id, membro_id"),
    tab === "dispositivos" ? supabase.from("dispositivos").select("id, user_id, nome, plataforma, app_versao, fila_pendente, ultimo_sync_em, revogado_em, created_at").order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
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
  const opcoesTodos = pessoasBase.filter((p) => p.active).map((p) => ({ value: p.id as string, label: (p.full_name as string) || (p.email as string) }));
  const opcoesFunc = catalogo.map((f) => ({ value: f.chave, label: `${f.nome}${f.sensivel ? " (sensível)" : ""}` }));
  const opcoesDeps = depLista.map((d) => ({ value: d.id, label: `${d.nome} · ${d.area}` }));
  const opcoesNiveis = depLista.flatMap((d) => d.niveis.map((n) => ({ value: n.id, label: `${d.nome} › ${n.nome}` })));

  const ver = sp.ver && /^[0-9a-f-]{36}$/i.test(sp.ver) ? sp.ver : null;
  let ctx: ContextoUsuario | null = null;
  if (ver) {
    const { data } = await supabase.rpc("contexto_de_usuario", { p_user: ver });
    ctx = (data ?? null) as ContextoUsuario | null;
    await registrarAcesso("SIMULACAO", "empresa_membros", ver);
  }
  const menuSimulado = ctx ? menuDaArea({ permissoes: ctx.permissoes, admin_master: ctx.membro?.admin_master }, ctx.areas.filter(isArea), null, false) : [];

  const equipesPorSup = new Map<string, string[]>();
  for (const e of equipes ?? []) equipesPorSup.set(e.supervisor_id, [...(equipesPorSup.get(e.supervisor_id) ?? []), e.membro_id]);

  return (
    <>
      <PageHeader
        eyebrow="Sistema"
        title="Acessos"
        description="Departamentos, níveis e funcionalidades de cada funcionário. O perfil define o escopo dos dados (próprios, equipe, departamento ou empresa); os níveis definem o que cada um pode fazer."
        actions={
          <>
            <FormDrawerButton action={aplicarNivelEmMassa} title="Edição em massa" label="Edição em massa" icon="none" variant="secondary" width="max-w-xl"
              fields={[
                { name: "usuarios", label: "Funcionários", type: "multiselect", options: opcoesPessoas, span: 6 },
                { name: "departamento_id", label: "Departamento", type: "select", options: opcoesDeps, required: true, span: 3 },
                { name: "nivel_id", label: "Nível (vazio = retirar do departamento)", type: "select", options: opcoesNiveis, span: 3 },
              ]} />
            <FormDrawerButton action={copiarAcessos} title="Copiar acessos (igual ao fulano)" label="Copiar perfil" icon="none" variant="secondary" width="max-w-md"
              fields={[{ name: "origem", label: "Copiar de", type: "select", options: opcoesPessoas, required: true, span: 6 }, { name: "destino", label: "Para", type: "select", options: opcoesPessoas, required: true, span: 6 }]} />
            <LinkButton href="/api/acessos/exportar" variant="secondary" prefetch={false}>Exportar matriz</LinkButton>
            <Link href="/auditoria?grupo=acessos" className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">Histórico</Link>
          </>
        }
      />
      {ver && (
        <Card className="mb-6">
          <CardHeader
            title={`Ver como: ${nomePessoa.get(ver) ?? "usuário"}`}
            description={ctx?.membro ? `${ROLES.find((r) => r.value === ctx.membro?.role)?.label ?? ctx.membro.role}${ctx.membro.admin_master ? " · administrador master" : ""}${ctx.membro.ativo ? "" : " · acesso desativado"} — simulação somente leitura (registrada na auditoria).` : "Simulação somente leitura."}
            icon={<Eye className="h-4 w-4" />}
            action={<Link href="/acessos" className="text-sm font-semibold text-brand-600">Fechar</Link>}
          />
          <CardBody className="grid gap-6 lg:grid-cols-3">
            <div>
              <p className="label">Áreas de trabalho</p>
              <div className="flex flex-wrap gap-1.5">{ctx?.areas.length ? ctx.areas.map((a) => <Badge key={a} tone="accent">{AREAS.find((x) => x.value === a)?.label ?? a}</Badge>) : <span className="text-sm text-muted">Nenhuma</span>}</div>
              <p className="label mt-4">Departamentos</p>
              <ul className="space-y-1 text-sm">{ctx?.departamentos.length ? ctx.departamentos.map((d, i) => <li key={i}>{d.departamento} · <b>{d.nivel ?? "sem nível"}</b>{!d.ativo && " (inativo)"}{d.valido_ate ? ` até ${date(d.valido_ate)}` : ""}</li>) : <li className="text-muted">Nenhum</li>}</ul>
              {!!ctx?.equipe.length && <><p className="label mt-4">Supervisiona</p><p className="text-sm">{ctx.equipe.map((m) => nomePessoa.get(m) ?? "—").join(", ")}</p></>}
            </div>
            <div>
              <p className="label">Menu que a pessoa vê</p>
              {menuSimulado.length ? menuSimulado.map((g) => (
                <div key={g.label} className="mb-2"><p className="text-xs font-semibold uppercase text-muted">{g.label}</p><p className="text-sm">{g.items.map((i) => i.label).join(" · ")}</p></div>
              )) : <p className="text-sm text-muted">Somente o painel vazio.</p>}
            </div>
            <div>
              <p className="label">Funcionalidades efetivas ({ctx?.permissoes.length ?? 0})</p>
              {ctx?.permissoes.length ? (
                <div className="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">{ctx.permissoes.map((f) => <Badge key={f} tone="brand">{nomeFunc.get(f) ?? f}</Badge>)}</div>
              ) : <p className="text-sm text-muted">Nenhuma funcionalidade.</p>}
            </div>
          </CardBody>
        </Card>
      )}
      <LinkTabs base="/acessos" active={tab} tabs={[
        { key: "matriz", label: "Funcionários × departamentos" },
        { key: "niveis", label: "Níveis e funcionalidades" },
        { key: "excecoes", label: "Exceções individuais", count: (extras ?? []).length },
        { key: "equipes", label: "Equipes", count: equipesPorSup.size },
        { key: "dispositivos", label: "Aparelhos do app" },
      ]} />

      {tab === "matriz" && (
        <Card>
          <CardHeader title="Matriz de acessos" description="Escolha o nível de cada pessoa em cada departamento. Clique no nome para ver como a pessoa enxerga o sistema." icon={<KeyRound className="h-4 w-4" />} />
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

      {tab === "equipes" && (
        <Card>
          <CardHeader
            title="Equipes (escopo de supervisão)"
            description="O supervisor passa a ver, somente para leitura, a carteira, os negócios, as visitas e as rotas dos membros da sua equipe."
            icon={<Users className="h-4 w-4" />}
            action={<FormDrawerButton action={salvarEquipe} title="Montar equipe" label="Nova equipe" size="sm" variant="accent" width="max-w-xl"
              fields={[{ name: "supervisor_id", label: "Supervisor", type: "select", options: opcoesTodos, required: true, span: 6 }, { name: "membros", label: "Membros", type: "multiselect", options: opcoesTodos, span: 6 }]} />}
          />
          {equipesPorSup.size === 0 ? <EmptyState title="Nenhuma equipe" description="Sem equipe, cada consultor vê só a própria carteira e a gestão vê tudo." /> : (
            <ul className="divide-y divide-line">
              {[...equipesPorSup].map(([sup, mem]) => (
                <li key={sup} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span><b>{nomePessoa.get(sup) ?? "—"}</b> <span className="text-sm text-muted">supervisiona {mem.map((m) => nomePessoa.get(m) ?? "—").join(", ")}</span></span>
                  <FormDrawerButton action={salvarEquipe} hidden={{ supervisor_id: sup }} title={`Equipe de ${nomePessoa.get(sup) ?? ""}`} icon="edit" size="icon" variant="ghost" width="max-w-xl"
                    fields={[{ name: "membros", label: "Membros", type: "multiselect", options: opcoesTodos.filter((o) => o.value !== sup), span: 6 }]} values={{ membros: mem }} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "dispositivos" && (
        <Card>
          <CardHeader title="Aparelhos do app" description="Revogar um aparelho corta o acesso na próxima sincronização e apaga os dados guardados nele." icon={<Smartphone className="h-4 w-4" />} />
          {(aparelhos ?? []).length === 0 ? <EmptyState title="Nenhum aparelho registrado" description="Os aparelhos aparecem quando o consultor abre o app de campo." /> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Funcionário</th><th>Aparelho</th><th>Versão</th><th className="text-right">Fila</th><th>Última sincronização</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {(aparelhos ?? []).map((a) => (
                  <tr key={a.id} className={a.revogado_em ? "opacity-60" : undefined}>
                    <td className="font-medium">{nomePessoa.get(a.user_id) ?? "—"}</td>
                    <td className="text-sm">{a.nome ?? "—"}<div className="text-xs text-muted">{a.plataforma}</div></td>
                    <td className="text-xs">{a.app_versao ?? "—"}</td>
                    <td className="text-right">{a.fila_pendente}</td>
                    <td className="text-xs text-muted">{a.ultimo_sync_em ? dateTime(a.ultimo_sync_em) : "—"}</td>
                    <td>{a.revogado_em ? <Badge tone="red">Revogado</Badge> : <Badge tone="green">Ativo</Badge>}</td>
                    <td className="text-right">{!a.revogado_em && <ConfirmAction action={revogarDispositivo} id={a.id} title="Revogar aparelho?" message="O app perde o acesso e apaga os dados locais na próxima sincronização." confirmLabel="Revogar" />}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}
    </>
  );
}
