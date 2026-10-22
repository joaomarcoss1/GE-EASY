"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { alterarVinculo, definirNivel } from "@/lib/actions/acessos";
import { ROLES } from "@/lib/constants";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

export interface DepMatriz {
  id: string;
  nome: string;
  area: string;
  niveis: { id: string; nome: string }[];
}
export interface PessoaMatriz {
  id: string;
  nome: string;
  email: string;
  role: string;
  ativo: boolean;
  master: boolean;
  plataforma: boolean;
  niveis: Record<string, string | null>; // departamento -> nível (null = membro sem nível)
}

/** Matriz funcionário × departamento × nível. Cada alteração vale na próxima requisição do usuário. */
export function MatrizAcessos({ pessoas, deps, eu }: { pessoas: PessoaMatriz[]; deps: DepMatriz[]; eu: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const executar = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message ?? "Salvo.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível salvar.", "error");
    });

  return (
    <div className={cn("overflow-x-auto", pending && "pointer-events-none opacity-60")}>
      <table className="table-base">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface">Funcionário</th>
            <th>Perfil (escopo)</th>
            <th>Ativo</th>
            <th>Master</th>
            {deps.map((d) => <th key={d.id} className="min-w-[140px]">{d.nome}<div className="text-[10px] font-normal uppercase text-muted">{d.area}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => {
            const bloqueado = p.id === eu || p.plataforma;
            return (
              <tr key={p.id} className={!p.ativo ? "opacity-60" : undefined}>
                <td className="sticky left-0 z-10 bg-surface">
                  <a href={`/acessos?ver=${p.id}`} className="block font-medium hover:text-brand-600">{p.nome || p.email}</a>
                  <span className="block text-xs text-muted">{p.id === eu ? "você" : p.email}</span>
                </td>
                <td>
                  <select className="input h-9 py-0 text-sm" value={p.role} disabled={bloqueado} onChange={(e) => executar(() => alterarVinculo(p.id, "role", e.target.value))} aria-label={`Perfil de ${p.nome}`}>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={p.ativo} disabled={bloqueado} onChange={(e) => executar(() => alterarVinculo(p.id, "ativo", e.target.checked))} aria-label={`Acesso ativo de ${p.nome}`} /></td>
                <td><input type="checkbox" checked={p.master} disabled={bloqueado} onChange={(e) => executar(() => alterarVinculo(p.id, "admin_master", e.target.checked))} aria-label={`Administrador master: ${p.nome}`} /></td>
                {deps.map((d) => {
                  const atual = d.id in p.niveis ? (p.niveis[d.id] ?? "membro") : "";
                  return (
                    <td key={d.id}>
                      <select
                        className={cn("input h-9 py-0 text-sm", atual && atual !== "membro" && "border-brand-300 bg-brand-50/50 dark:bg-brand-900/20")}
                        value={atual}
                        disabled={bloqueado || p.master}
                        title={p.master ? "Administrador master tem todas as funcionalidades" : undefined}
                        onChange={(e) => executar(() => definirNivel(p.id, d.id, e.target.value && e.target.value !== "membro" ? e.target.value : null))}
                        aria-label={`Nível de ${p.nome} em ${d.nome}`}
                      >
                        <option value="">—</option>
                        {atual === "membro" && <option value="membro">Membro (sem nível)</option>}
                        {d.niveis.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
