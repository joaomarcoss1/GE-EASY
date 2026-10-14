import { Building2, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIAS_CONSORCIO, LINHAS, RAMOS_SEGURO, type Option } from "@/lib/constants";
import { maskDocumento, maskPhone, pct } from "@/lib/format";
import type { Parceiro, Produto } from "@/lib/types";
import { createParceiro, createProduto, deleteParceiro, deleteProduto, updateParceiro, updateProduto } from "@/lib/actions/cadastros";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";

const TIPOS: Option[] = [
  { value: "administradora", label: "Administradora de consórcio", tone: "brand" },
  { value: "seguradora", label: "Seguradora", tone: "accent" },
];

const CATEGORIAS: Option[] = [
  ...CATEGORIAS_CONSORCIO.map((c) => ({ value: c.value, label: `Consórcio · ${c.label}` })),
  ...RAMOS_SEGURO.map((r) => ({ value: r.value, label: `Seguro · ${r.label}` })),
];

const parceiroFields: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", options: TIPOS, required: true, span: 3 },
  { name: "nome", label: "Nome", required: true, span: 3 },
  { name: "cnpj", label: "CNPJ", type: "documento", span: 3 },
  { name: "comissao_padrao", label: "Comissão padrão da corretora", type: "percent", span: 3 },
  { name: "contato", label: "Contato comercial", span: 3, section: "Contato" },
  { name: "telefone", label: "Telefone", type: "tel", span: 3 },
  { name: "email", label: "E-mail", type: "email", span: 3 },
  { name: "site", label: "Site", placeholder: "www.exemplo.com.br", span: 3 },
  { name: "ativo", label: "Ativo", type: "checkbox", help: "Parceiros inativos não aparecem nos formulários.", span: 6 },
];

function produtoFields(parceiros: Option[]): FieldDef[] {
  return [
    { name: "linha", label: "Linha", type: "select", options: LINHAS, required: true, span: 2 },
    { name: "categoria", label: "Categoria / ramo", type: "select", options: CATEGORIAS, required: true, span: 4 },
    { name: "nome", label: "Nome do produto", required: true, span: 4 },
    { name: "comissao_percentual", label: "Comissão", type: "percent", span: 2 },
    { name: "parceiro_id", label: "Administradora / seguradora", type: "select", options: parceiros, emptyOption: "Nenhuma", span: 6 },
    { name: "descricao", label: "Descrição", type: "textarea", rows: 3, span: 6 },
    { name: "ativo", label: "Ativo", type: "checkbox", span: 6 },
  ];
}

export async function CadastrosTab() {
  const supabase = await createClient();
  const [{ data: pData }, { data: prData }] = await Promise.all([
    supabase.from("parceiros").select("*").order("tipo").order("nome"),
    supabase.from("produtos").select("*").order("linha").order("nome"),
  ]);
  const parceiros = (pData ?? []) as Parceiro[];
  const produtos = (prData ?? []) as Produto[];
  const parceiroOpts: Option[] = parceiros.map((p) => ({ value: p.id, label: `${p.nome} (${p.tipo === "administradora" ? "administradora" : "seguradora"})` }));
  const parceiroNome = new Map(parceiros.map((p) => [p.id, p.nome]));
  const pFields = produtoFields(parceiroOpts);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Parceiros"
          description="Administradoras de consórcio e seguradoras"
          icon={<Building2 className="h-4 w-4" />}
          action={<FormDrawerButton action={createParceiro} fields={parceiroFields} values={{ ativo: true, tipo: "seguradora" }} title="Novo parceiro" label="Novo parceiro" size="sm" width="max-w-xl" />}
        />
        {parceiros.length === 0 ? (
          <EmptyState icon={<Building2 className="h-6 w-6" />} title="Nenhum parceiro cadastrado" description="Cadastre as administradoras e seguradoras com que a EASY trabalha." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Contato</th>
                  <th>Comissão padrão</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {parceiros.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-semibold">{p.nome}</p>
                      {p.cnpj && <p className="text-xs text-muted">{maskDocumento(p.cnpj)}</p>}
                    </td>
                    <td>
                      <StatusBadge options={TIPOS} value={p.tipo} />
                    </td>
                    <td className="text-xs">
                      {p.contato && <p className="font-medium">{p.contato}</p>}
                      <p className="text-muted">{[maskPhone(p.telefone), p.email].filter(Boolean).join(" · ") || "—"}</p>
                    </td>
                    <td className="text-sm">{pct(p.comissao_padrao, 3)}</td>
                    <td>{p.ativo ? <Badge tone="green" dot>Ativo</Badge> : <Badge tone="slate" dot>Inativo</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDrawerButton action={updateParceiro} fields={parceiroFields} values={{ ...p }} hidden={{ id: p.id }} title="Editar parceiro" icon="edit" size="icon" variant="ghost" width="max-w-xl" />
                        <ConfirmAction action={deleteParceiro} id={p.id} title="Excluir parceiro?" message="Cotas, apólices e produtos vinculados ficarão sem parceiro. Prefira inativar se houver negócios." />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Produtos"
          description="Planos de consórcio e produtos de seguro, com comissão padrão"
          icon={<Package className="h-4 w-4" />}
          action={<FormDrawerButton action={createProduto} fields={pFields} values={{ ativo: true, linha: "consorcio" }} title="Novo produto" label="Novo produto" size="sm" width="max-w-xl" />}
        />
        {produtos.length === 0 ? (
          <EmptyState icon={<Package className="h-6 w-6" />} title="Nenhum produto cadastrado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Linha</th>
                  <th>Categoria</th>
                  <th>Parceiro</th>
                  <th>Comissão</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-semibold">{p.nome}</p>
                      {p.descricao && <p className="max-w-xs truncate text-xs text-muted">{p.descricao}</p>}
                    </td>
                    <td>
                      <StatusBadge options={LINHAS} value={p.linha} />
                    </td>
                    <td className="text-sm">{optionLabel(CATEGORIAS, p.categoria)}</td>
                    <td className="text-sm">{(p.parceiro_id && parceiroNome.get(p.parceiro_id)) || <span className="text-muted">—</span>}</td>
                    <td className="text-sm">{pct(p.comissao_percentual, 3)}</td>
                    <td>{p.ativo ? <Badge tone="green" dot>Ativo</Badge> : <Badge tone="slate" dot>Inativo</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDrawerButton action={updateProduto} fields={pFields} values={{ ...p }} hidden={{ id: p.id }} title="Editar produto" icon="edit" size="icon" variant="ghost" width="max-w-xl" />
                        <ConfirmAction action={deleteProduto} id={p.id} title="Excluir produto?" message="Negócios que usam este produto ficarão sem produto vinculado." />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
