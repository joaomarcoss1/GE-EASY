import type { Metadata } from "next";
import { Suspense } from "react";
import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { searchTerm } from "@/lib/data";
import { maskDocumento, maskPhone } from "@/lib/format";
import { excluirAssessor, salvarAssessor } from "@/lib/actions/comercial";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { ComprovanteButton } from "@/components/comercial/comprovante-button";

export const metadata: Metadata = { title: "Assessores" };

const ACORDO = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

function assessorFields(edit: boolean, temComprovante = false): FieldDef[] {
  return [
    { name: "nome", label: "Nome completo", required: true, span: 6 },
    { name: "cpf", label: "CPF", type: "documento", required: true, span: 3 },
    { name: "telefone", label: "Telefone", type: "tel", required: true, span: 3 },
    { name: "email", label: "E-mail", type: "email", span: 6 },
    { name: "acordo_comercial", label: "Tem acordo comercial?", type: "select", options: ACORDO, required: true, emptyOption: false, span: 3 },
    ...(edit ? [{ name: "ativo", label: "Ativo (aparece no cadastro de clientes)", type: "checkbox", span: 3 } as FieldDef] : []),
    {
      name: "comprovante",
      label: temComprovante ? "Trocar comprovante de residência" : "Comprovante de residência",
      type: "file",
      placeholder: "application/pdf,image/jpeg,.pdf,.jpg,.jpeg",
      span: 6,
      help: temComprovante ? "Já cadastrado. Envie outro só para substituir. PDF ou JPEG, até 25 MB." : "PDF ou JPEG, até 25 MB.",
    },
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6 },
  ];
}

interface Assessor {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  acordo_comercial: boolean;
  ativo: boolean;
  comprovante_path: string | null;
  observacoes: string | null;
}

/** Cadastro dos assessores (quem traz o cliente): CPF, contato, comprovante de residência e acordo comercial. */
export default async function AssessoresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("consultores.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("assessores").select("id, nome, cpf, telefone, email, acordo_comercial, ativo, comprovante_path, observacoes").order("ativo", { ascending: false }).order("nome");
  const q = searchTerm(sp.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    query = digits.length >= 3 ? query.or(`cpf.ilike.%${digits}%,telefone.ilike.%${digits}%`) : query.ilike("nome", `%${q}%`);
  }
  if (sp.acordo === "sim" || sp.acordo === "nao") query = query.eq("acordo_comercial", sp.acordo === "sim");
  const [{ data }, { data: vinculos }] = await Promise.all([
    query,
    supabase.from("clientes").select("assessor_id").not("assessor_id", "is", null).range(0, 9999),
  ]);
  const lista = (data ?? []) as Assessor[];
  const clientesPor = new Map<string, number>();
  for (const v of vinculos ?? []) clientesPor.set(v.assessor_id as string, (clientesPor.get(v.assessor_id as string) ?? 0) + 1);
  const comAcordo = lista.filter((a) => a.acordo_comercial && a.ativo).length;

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Assessores"
        description={`Quem traz os clientes. ${lista.filter((a) => a.ativo).length} ativo(s), ${comAcordo} com acordo comercial.`}
        actions={<FormDrawerButton action={salvarAssessor} fields={assessorFields(false)} values={{ acordo_comercial: "nao" }} title="Novo assessor" label="Novo assessor" variant="accent" width="max-w-lg" />}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <Suspense>
            <SearchInput placeholder="Nome, CPF ou telefone…" />
            <FilterSelect param="acordo" options={[{ value: "sim", label: "Com acordo comercial" }, { value: "nao", label: "Sem acordo comercial" }]} allLabel="Acordo comercial" />
          </Suspense>
        </div>
        {lista.length === 0 ? (
          <EmptyState icon={<UserCheck className="h-6 w-6" />} title="Nenhum assessor encontrado" description="Cadastre o assessor com CPF, telefone, e-mail e comprovante de residência." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Assessor</th><th>CPF</th><th>Contato</th><th>Acordo comercial</th><th>Comprovante</th><th className="text-right">Clientes</th><th /></tr>
              </thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id} className={a.ativo ? "" : "opacity-60"}>
                    <td className="font-semibold">{a.nome}{!a.ativo && <Badge tone="slate" className="ml-2">inativo</Badge>}</td>
                    <td className="whitespace-nowrap text-sm">{a.cpf ? maskDocumento(a.cpf) : "—"}</td>
                    <td className="text-sm">{a.telefone ? maskPhone(a.telefone) : "—"}{a.email && <div className="text-xs text-muted">{a.email}</div>}</td>
                    <td>{a.acordo_comercial ? <Badge tone="green">Sim</Badge> : <Badge tone="slate">Não</Badge>}</td>
                    <td>{a.comprovante_path ? <ComprovanteButton assessorId={a.id} /> : <span className="text-xs text-amber-700 dark:text-amber-300">pendente</span>}</td>
                    <td className="text-right tabular-nums">{clientesPor.get(a.id) ?? 0}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDrawerButton
                          action={salvarAssessor}
                          fields={assessorFields(true, !!a.comprovante_path)}
                          values={{ ...a, acordo_comercial: a.acordo_comercial ? "sim" : "nao", comprovante_path: null }}
                          hidden={{ id: a.id }}
                          title="Editar assessor"
                          icon="edit"
                          variant="ghost"
                          size="icon"
                          width="max-w-lg"
                        />
                        <ConfirmAction action={excluirAssessor} id={a.id} title="Excluir assessor?" message="Os clientes ligados a ele ficam sem assessor. Para só tirar da lista do cadastro, edite e desmarque “Ativo”." />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
