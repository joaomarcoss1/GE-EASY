import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth";

/** Entrada do departamento jurídico: o painel jurídico é o painel principal do sistema. */
export default async function JuridicoPage() {
  await requireArea("juridico");
  redirect("/dashboard");
}
