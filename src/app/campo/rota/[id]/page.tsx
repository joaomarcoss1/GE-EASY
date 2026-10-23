import { redirect } from "next/navigation";

/** Atalho da tela da rota (web) para a execução no app de campo. */
export default async function CampoRotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(/^[0-9a-f-]{36}$/i.test(id) ? `/campo?tela=rota&rota=${id}` : "/campo");
}
