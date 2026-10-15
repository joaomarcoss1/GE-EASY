"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, UserMinus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { useToast } from "@/components/ui/toast";

export interface MembroItem {
  user_id: string;
  nome: string;
  email: string;
  avatar: string | null;
  papel: string;
  funcao: "responsavel" | "membro";
  /** responsável principal (departamentos.responsavel_id) */
  principal: boolean;
  processos: number;
  prazos: number;
  vencidos: number;
  tarefas: number;
}

function FuncaoSelect({ m, onChange }: { m: MembroItem; onChange: (userId: string, funcao: string) => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <select
        defaultValue={m.funcao}
        disabled={pending}
        aria-label={`Função de ${m.nome}`}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const r = await onChange(m.user_id, v);
            if (r.ok) {
              toast(r.message ?? "Função alterada.");
              router.refresh();
            } else {
              toast(r.error ?? "Não foi possível alterar a função.", "error");
              e.target.value = m.funcao;
            }
          });
        }}
        className="input h-9 w-auto min-w-[130px] py-0 text-sm"
      >
        <option value="responsavel">Responsável</option>
        <option value="membro">Membro</option>
      </select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
    </span>
  );
}

export function EquipeList({
  membros,
  canManage,
  actions,
}: {
  membros: MembroItem[];
  canManage: boolean;
  actions: {
    setFuncao: (userId: string, funcao: string) => Promise<ActionState>;
    remove: (userId: string) => Promise<ActionState>;
  };
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th>Função no departamento</th>
            <th className="text-right">Processos</th>
            <th className="text-right">Prazos pendentes</th>
            <th className="text-right">Demandas abertas</th>
            {canManage && <th className="w-12" aria-label="Ações" />}
          </tr>
        </thead>
        <tbody>
          {membros.map((m) => (
            <tr key={m.user_id}>
              <td>
                <div className="flex items-center gap-3">
                  <Avatar name={m.nome} src={m.avatar} size={34} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {m.nome}
                      {m.principal && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Responsável principal" />}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {m.papel} · {m.email}
                    </p>
                  </div>
                </div>
              </td>
              <td>
                {canManage && !m.principal ? (
                  <FuncaoSelect m={m} onChange={actions.setFuncao} />
                ) : (
                  <Badge tone={m.funcao === "responsavel" ? "accent" : "slate"} dot>
                    {m.funcao === "responsavel" ? "Responsável" : "Membro"}
                  </Badge>
                )}
              </td>
              <td className="text-right tabular-nums">{m.processos}</td>
              <td className="text-right tabular-nums">
                {m.prazos}
                {m.vencidos > 0 && <span className={cn("ml-1.5 rounded-full bg-red-50 px-1.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300")}>{m.vencidos} vencido(s)</span>}
              </td>
              <td className="text-right tabular-nums">{m.tarefas}</td>
              {canManage && (
                <td className="text-right">
                  {!m.principal && (
                    <ConfirmAction
                      action={actions.remove}
                      id={m.user_id}
                      title="Remover do departamento?"
                      message={`${m.nome} deixará de ver os processos, prazos e demandas exclusivos deste departamento.`}
                      confirmLabel="Remover"
                      label={`Remover ${m.nome}`}
                      icon={<UserMinus className="h-4 w-4" />}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
