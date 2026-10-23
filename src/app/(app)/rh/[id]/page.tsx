import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileText, IdCard, Lock, Users } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions } from "@/lib/data";
import { APROVACAO_STATUS, AUSENCIA_TIPOS, FUNCIONARIO_STATUS, TIPOS_CONTRATO, toMap } from "@/lib/constants";
import { brl, date, maskDocumento } from "@/lib/format";
import { registrarAcesso } from "@/lib/actions/utils";
import { enviarDocumentoFuncionario, salvarDependente, salvarFuncionario, salvarSensiveis, solicitarAusencia } from "@/lib/actions/rh";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkButton } from "@/components/ui/button";
import { camposFuncionario } from "@/components/rh/campos";
import { RevelarBanco } from "@/components/rh/revelar-banco";

export const metadata: Metadata = { title: "Ficha do funcionário" };

const contratos = toMap(TIPOS_CONTRATO);
const ausTipos = toMap(AUSENCIA_TIPOS);

/** Ficha: contrato, dados sensíveis (com permissão; leitura auditada), dependentes, documentos com validade e ausências. */
export default async function FuncionarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: f } = await supabase.from("funcionarios").select("*").eq("id", id).maybeSingle();
  if (!f) {
    if (!can(profile, "rh.funcionarios.ver")) redirect("/inicio?erro=permissao");
    notFound();
  }
  const sensivel = can(profile, "rh.dados_sensiveis");
  const edita = can(profile, "rh.funcionarios.editar");
  const [deps, { data: jornadas }, { data: s }, { data: dependentes }, { data: docs }, { data: ausencias }] = await Promise.all([
    departamentoOptions(), supabase.from("jornadas").select("id, nome").eq("ativo", true),
    supabase.from("funcionario_sensiveis").select("*").eq("funcionario_id", id).maybeSingle(),
    supabase.from("funcionario_dependentes").select("*").eq("funcionario_id", id).order("nome"),
    supabase.from("funcionario_documentos").select("id, tipo, descricao, validade, created_at").eq("funcionario_id", id).order("created_at", { ascending: false }),
    supabase.from("ausencias").select("id, tipo, inicio, fim, status, anexo_path").eq("funcionario_id", id).order("inicio", { ascending: false }).limit(20),
  ]);
  if (s && sensivel) await registrarAcesso("VISUALIZACAO_SIGILOSA", "funcionario_sensiveis", id, { tela: "ficha_rh" });
  const opJor = (jornadas ?? []).map((j) => ({ value: j.id as string, label: j.nome as string }));
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="Recursos Humanos" title={f.nome} description={[f.cargo, f.matricula && `matrícula ${f.matricula}`, contratos[f.tipo_contrato]?.label].filter(Boolean).join(" · ")}
        actions={
          <>
            {edita && <FormDrawerButton action={salvarFuncionario} title="Editar cadastro" label="Editar" icon="edit" variant="secondary" width="max-w-2xl" hidden={{ id }} values={f} fields={camposFuncionario(deps, opJor)} />}
            {can(profile, "ponto.gerir") && <LinkButton href={`/ponto?tab=espelhos&f=${id}`} variant="secondary">Espelho de ponto</LinkButton>}
          </>
        } />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="self-start">
          <CardHeader title="Contrato" icon={<IdCard className="h-4 w-4" />} action={<StatusBadge options={FUNCIONARIO_STATUS} value={f.status} />} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Admissão</dt><dd>{date(f.admissao)}</dd></div>
              <div><dt className="text-muted">Desligamento</dt><dd>{date(f.desligamento)}</dd></div>
              <div><dt className="text-muted">Departamento</dt><dd>{deps.find((d) => d.value === f.departamento_id)?.label ?? "—"}</dd></div>
              <div><dt className="text-muted">Jornada</dt><dd>{opJor.find((j) => j.value === f.jornada_id)?.label ?? "—"}</dd></div>
              <div><dt className="text-muted">Ponto</dt><dd>{f.controla_ponto ? (f.ponto_externo ? "Externo (qualquer lugar)" : "Na cerca da empresa") : "Não controla"}</dd></div>
              <div><dt className="text-muted">Acesso ao sistema</dt><dd>{f.user_id ? "Sim" : "Não"}</dd></div>
              <div><dt className="text-muted">E-mail</dt><dd className="truncate">{f.email ?? "—"}</dd></div>
              <div><dt className="text-muted">Telefone</dt><dd>{f.telefone ?? "—"}</dd></div>
            </dl>
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="Dados sensíveis" description="CPF, salário e dados bancários — acesso restrito e auditado." icon={<Lock className="h-4 w-4" />}
            action={sensivel && <FormDrawerButton action={salvarSensiveis} title="Dados contratuais e pessoais" label={s ? "Editar" : "Cadastrar"} icon={s ? "edit" : "plus"} size="sm" hidden={{ funcionario_id: id }}
              values={s ? { cpf: s.cpf, rg: s.rg, nascimento: s.nascimento, pis: s.pis, salario_base: s.salario_base, adicionais_fixos: s.adicionais_fixos, endereco: s.endereco, contato_emergencia: s.contato_emergencia } : {}}
              fields={[
                { name: "cpf", label: "CPF", type: "documento", span: 3 }, { name: "rg", label: "RG", span: 3 },
                { name: "nascimento", label: "Nascimento", type: "date", span: 3 }, { name: "pis", label: "PIS/NIS", span: 3 },
                { name: "salario_base", label: "Salário base", type: "money", span: 3 }, { name: "adicionais_fixos", label: "Adicionais fixos", type: "money", span: 3 },
                { name: "banco", label: "Dados bancários (banco, agência, conta, PIX)", type: "textarea", rows: 2, span: 6, help: s?.dados_bancarios_enc ? "Já cadastrados (criptografados). Preencha só para substituir." : "Guardados criptografados" },
                { name: "endereco", label: "Endereço", type: "textarea", rows: 2, span: 6 }, { name: "contato_emergencia", label: "Contato de emergência", span: 6 },
              ]} />} />
          <CardBody>
            {!s ? <p className="text-sm text-muted">{sensivel ? "Nada cadastrado." : "Sem permissão para ver."}</p> : (
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-muted">CPF</dt><dd>{s.cpf ? maskDocumento(s.cpf) : "—"}</dd></div>
                  <div><dt className="text-muted">Nascimento</dt><dd>{date(s.nascimento)}</dd></div>
                  <div><dt className="text-muted">Salário base</dt><dd>{s.salario_base != null ? brl(s.salario_base) : "—"}</dd></div>
                  <div><dt className="text-muted">Adicionais fixos</dt><dd>{brl(s.adicionais_fixos)}</dd></div>
                </dl>
                {s.dados_bancarios_enc && sensivel && <RevelarBanco funcionarioId={id} />}
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="Documentos" description="Contrato, ASO, CNH… com validade" icon={<FileText className="h-4 w-4" />}
            action={edita && <FormDrawerButton action={enviarDocumentoFuncionario} title="Enviar documento" label="Enviar" size="sm" hidden={{ funcionario_id: id }}
              fields={[
                { name: "tipo", label: "Tipo", required: true, span: 3, placeholder: "ASO, contrato, CNH…" }, { name: "validade", label: "Validade", type: "date", span: 3 },
                { name: "descricao", label: "Descrição", span: 6 },
                { name: "arquivo", label: "Arquivo", type: "file", required: true, placeholder: "application/pdf,image/jpeg,image/png,image/webp", span: 6, help: "PDF ou imagem até 10 MB" },
              ]} />} />
          {!docs?.length ? <EmptyState title="Nenhum documento" /> : (
            <ul className="divide-y divide-line text-sm">{docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                <a href={`/api/rh/arquivo?doc=${d.id}`} target="_blank" rel="noopener" className="font-medium hover:text-brand-600">{d.tipo}{d.descricao ? ` — ${d.descricao}` : ""}</a>
                <span className={`text-xs ${d.validade && d.validade < hoje ? "font-semibold text-red-600" : "text-muted"}`}>{d.validade ? `vence ${date(d.validade)}` : date(d.created_at)}</span>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Dependentes" icon={<Users className="h-4 w-4" />}
            action={sensivel && <FormDrawerButton action={salvarDependente} title="Novo dependente" label="Incluir" size="sm" hidden={{ funcionario_id: id }}
              fields={[{ name: "nome", label: "Nome", required: true, span: 6 }, { name: "parentesco", label: "Parentesco", required: true, span: 3 }, { name: "nascimento", label: "Nascimento", type: "date", span: 3 },
                { name: "cpf", label: "CPF", type: "documento", span: 3 }, { name: "ir", label: "Dependente no IR", type: "checkbox", span: 3 }]} />} />
          {!dependentes?.length ? <EmptyState title={sensivel ? "Nenhum dependente" : "Sem permissão para ver"} /> : (
            <ul className="divide-y divide-line text-sm">{dependentes.map((d) => <li key={d.id} className="flex justify-between px-5 py-2.5"><span>{d.nome} · {d.parentesco}</span><span className="text-xs text-muted">{date(d.nascimento)}{d.ir ? " · IR" : ""}</span></li>)}</ul>
          )}
        </Card>
        <Card className="self-start xl:col-span-2">
          <CardHeader title="Férias, atestados e ausências"
            action={can(profile, "ponto.gerir") && <FormDrawerButton action={solicitarAusencia} title="Lançar ausência" label="Lançar" size="sm" hidden={{ funcionario_id: id }}
              fields={[{ name: "tipo", label: "Tipo", type: "select", options: AUSENCIA_TIPOS, required: true, span: 6 }, { name: "inicio", label: "De", type: "date", required: true, span: 3 }, { name: "fim", label: "Até", type: "date", required: true, span: 3 },
                { name: "observacao", label: "Observação", type: "textarea", rows: 2, span: 6 }, { name: "arquivo", label: "Anexo", type: "file", placeholder: "application/pdf,image/jpeg,image/png,image/webp", span: 6 }]} />} />
          {!ausencias?.length ? <EmptyState title="Nenhuma ausência" /> : (
            <ul className="divide-y divide-line text-sm">{ausencias.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                <span>{ausTipos[a.tipo]?.label} · {date(a.inicio)} a {date(a.fim)}{a.anexo_path && <a href={`/api/rh/arquivo?ausencia=${a.id}`} target="_blank" rel="noopener" className="ml-2 text-xs font-semibold text-brand-600">anexo</a>}</span>
                <StatusBadge options={APROVACAO_STATUS} value={a.status} />
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
