import { AlarmClock, FileCheck2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { salvarParametrosDocumentacao, salvarTipoDocumento } from "@/lib/actions/ciclo";
import type { FieldDef } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { SettingsForm } from "./settings-form";

const tipoFields: FieldDef[] = [
  { name: "categoria", label: "Categoria do documento", type: "select", options: DOC_CATEGORIAS, required: true, span: 3 },
  { name: "nome", label: "Nome exibido", required: true, span: 3 },
  { name: "obrigatorio", label: "Obrigatório para concluir o cadastro", type: "checkbox", span: 6 },
  { name: "aplica_pf", label: "Vale para pessoa física", type: "checkbox", span: 3 },
  { name: "aplica_pj", label: "Vale para pessoa jurídica", type: "checkbox", span: 3 },
  { name: "validade_dias", label: "Validade após aprovação (dias)", type: "number", min: 1, max: 3650, span: 3, help: "Ex.: 90 para comprovante de residência" },
  { name: "ativo", label: "Ativo", type: "checkbox", span: 3 },
];

/** Regra do prazo de documentação (45 dias por padrão) e documentos exigidos da empresa. */
export async function DocumentacaoTab() {
  const supabase = await createClient();
  const [{ data: cfg }, { data: tipos }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", "documentacao").maybeSingle(),
    supabase.from("documento_tipos").select("*").order("ordem").order("nome"),
  ]);
  const v = { prazo_dias: 45, contagem: "corridos", avisos: [15, 7, 3, 1], max_prorrogacoes: 2, prorrogacao_dias: 15, comissao_apos_transferencia: false, ...((cfg?.valor ?? {}) as Record<string, unknown>) };
  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card className="self-start">
        <CardHeader title="Prazo da documentação" description="Cliente em 'documentação pendente' na carteira de um consultor vai para a base administrativa ao fim do prazo." icon={<AlarmClock className="h-4 w-4" />} />
        <SettingsForm
          action={salvarParametrosDocumentacao}
          values={{ ...v, avisos: (v.avisos as number[]).join(", ") } as Record<string, string | number | boolean>}
          fields={[
            { name: "prazo_dias", label: "Prazo (dias)", type: "number", min: 5, max: 365, required: true, span: 3 },
            { name: "contagem", label: "Contagem", type: "select", options: [{ value: "corridos", label: "Dias corridos" }, { value: "uteis", label: "Dias úteis (seg–sex)" }], emptyOption: false, span: 3 },
            { name: "avisos", label: "Avisar faltando (dias)", required: true, span: 6, help: "Consultor e supervisão são avisados nesses dias. Ex.: 15, 7, 3, 1" },
            { name: "max_prorrogacoes", label: "Máximo de prorrogações", type: "number", min: 0, max: 10, span: 3 },
            { name: "prorrogacao_dias", label: "Dias por prorrogação", type: "number", min: 1, max: 90, span: 3 },
            { name: "comissao_apos_transferencia", label: "Consultor mantém comissão se o administrativo concluir", type: "checkbox", span: 6 },
          ]}
        />
      </Card>
      <Card className="self-start">
        <CardHeader
          title="Documentos exigidos"
          description="Com todos os obrigatórios aprovados, o cadastro fica completo automaticamente."
          icon={<FileCheck2 className="h-4 w-4" />}
          action={<FormDrawerButton action={salvarTipoDocumento} fields={tipoFields} values={{ obrigatorio: true, aplica_pf: true, aplica_pj: false, ativo: true }} title="Novo documento exigido" label="Adicionar" size="sm" variant="accent" width="max-w-lg" />}
        />
        {(tipos ?? []).length === 0 ? <EmptyState title="Nenhum documento exigido" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Documento</th><th>Categoria</th><th>Vale para</th><th>Validade</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {(tipos ?? []).map((t) => (
                <tr key={t.id} className={!t.ativo ? "opacity-60" : undefined}>
                  <td className="font-medium">{t.nome}{t.obrigatorio ? "" : <span className="ml-1 text-xs text-muted">(opcional)</span>}</td>
                  <td><Badge tone="brand">{optionLabel(DOC_CATEGORIAS, t.categoria)}</Badge></td>
                  <td className="text-sm">{[t.aplica_pf && "PF", t.aplica_pj && "PJ"].filter(Boolean).join(" e ")}</td>
                  <td className="text-sm">{t.validade_dias ? `${t.validade_dias} dias` : "—"}</td>
                  <td>{t.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}</td>
                  <td className="text-right"><FormDrawerButton action={salvarTipoDocumento} fields={tipoFields} values={t} hidden={{ id: t.id }} title="Editar documento exigido" icon="edit" size="icon" variant="ghost" width="max-w-lg" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
