import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { CadastroClienteForm } from "@/components/comercial/cadastro-cliente-form";

export const metadata: Metadata = { title: "Cadastrar cliente" };

export default async function NovoClienteComercialPage() {
  await requirePermission("clientes.write");
  const supabase = await createClient();
  const { data } = await supabase.from("assessores").select("id, nome").eq("ativo", true).order("nome");
  const assessores = (data ?? []).map((a) => ({ value: a.id as string, label: a.nome as string }));
  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Cadastrar cliente"
        description="Dados do cliente, tipo de ação, documentos e contrato assinado. O processo do cliente é aberto em análise."
      />
      <Card className="max-w-3xl">
        <CardBody>
          <CadastroClienteForm assessores={assessores} />
        </CardBody>
      </Card>
    </>
  );
}
