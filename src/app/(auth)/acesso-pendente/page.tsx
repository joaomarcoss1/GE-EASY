import { Clock } from "lucide-react";
import { signOut } from "@/lib/actions/auth";

export default function PendingPage() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/30"><Clock className="h-7 w-7" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Acesso aguardando liberação</h2>
      <p className="mt-2 text-sm text-muted">Sua conta foi criada, mas ainda não foi ativada por um administrador. Assim que for liberada, você poderá entrar normalmente.</p>
      <form action={signOut} className="mt-8"><button className="text-sm font-semibold text-brand-600 hover:underline">Sair e voltar ao login</button></form>
    </div>
  );
}
