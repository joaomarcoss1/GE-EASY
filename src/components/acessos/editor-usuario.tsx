"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Loader2, Lock, RotateCcw, Save, Search } from "lucide-react";
import { salvarAcessosUsuario } from "@/lib/actions/acessos";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

export interface FuncEditor {
  chave: string;
  nome: string;
  setor: string;
  sensivel: boolean;
  /** concedida pelo nível de algum departamento do usuário */
  doNivel: boolean;
  /** de onde vem (ex.: "Comercial › Operador") */
  origem: string | null;
  /** exceção atual do usuário */
  excecao: "concessao" | "revogacao" | null;
  excecaoValidade: string | null;
  /** área financeira: só vale para o administrador master */
  soMaster: boolean;
}

type Estado = "padrao" | "concessao" | "revogacao";

/**
 * Acessos de um usuário, funcionalidade por funcionalidade, agrupados por setor. "Padrão" segue os níveis dos
 * departamentos; "Conceder" libera mesmo sendo de outro setor; "Bloquear" tira mesmo que o nível dê.
 */
export function EditorAcessosUsuario({ userId, nome, funcs, master }: { userId: string; nome: string; funcs: FuncEditor[]; master: boolean }) {
  const inicial = useMemo(() => Object.fromEntries(funcs.map((f) => [f.chave, (f.excecao ?? "padrao") as Estado])), [funcs]);
  const [estado, setEstado] = useState<Record<string, Estado>>(inicial);
  const [busca, setBusca] = useState("");
  const [soComAcesso, setSoComAcesso] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [validade, setValidade] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const efetivo = (f: FuncEditor, e: Estado) => !(f.soMaster && !master) && (e === "concessao" || (e === "padrao" && f.doNivel));
  const mudancas = funcs.filter((f) => estado[f.chave] !== inicial[f.chave]).map((f) => ({ funcionalidade: f.chave, estado: estado[f.chave] }));
  const termo = busca.trim().toLowerCase();
  const visiveis = funcs.filter((f) => (!termo || f.nome.toLowerCase().includes(termo) || f.setor.toLowerCase().includes(termo)) && (!soComAcesso || efetivo(f, estado[f.chave]) || estado[f.chave] !== "padrao"));
  const setores = [...new Set(visiveis.map((f) => f.setor))];
  const total = funcs.filter((f) => efetivo(f, estado[f.chave])).length;

  const salvar = () =>
    start(async () => {
      const r = await salvarAcessosUsuario({ user_id: userId, mudancas, motivo, valido_ate: validade || null });
      if (r.ok) {
        toast(r.message ?? "Acessos salvos.");
        setMotivo("");
        router.refresh();
      } else toast(r.error ?? "Não foi possível salvar.", "error");
    });

  const Botao = ({ f, valor, children, titulo }: { f: FuncEditor; valor: Estado; children: React.ReactNode; titulo: string }) => {
    const ativo = estado[f.chave] === valor;
    return (
      <button
        type="button"
        title={titulo}
        aria-pressed={ativo}
        disabled={f.soMaster && valor === "concessao"}
        onClick={() => setEstado((s) => ({ ...s, [f.chave]: valor }))}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
          ativo && valor === "padrao" && "bg-surface-2 text-fg",
          ativo && valor === "concessao" && "bg-emerald-600 text-white",
          ativo && valor === "revogacao" && "bg-red-600 text-white",
          !ativo && "text-muted hover:bg-surface-2",
        )}
      >
        {children}
      </button>
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input h-10 pl-9" placeholder="Buscar funcionalidade ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soComAcesso} onChange={(e) => setSoComAcesso(e.target.checked)} className="h-4 w-4 accent-brand-700" /> Só o que tem acesso ou foi alterado</label>
        <span className="text-sm text-muted"><b className="text-fg">{total}</b> de {funcs.length} liberadas</span>
      </div>

      <div className="divide-y divide-line">
        {setores.map((s) => (
          <section key={s}>
            <h3 className="bg-surface-2/60 px-5 py-2 text-xs font-bold uppercase tracking-wide text-muted">{s}</h3>
            <ul className="divide-y divide-line">
              {visiveis.filter((f) => f.setor === s).map((f) => {
                const e = estado[f.chave];
                const tem = efetivo(f, e);
                const mudou = e !== inicial[f.chave];
                return (
                  <li key={f.chave} className={cn("flex flex-wrap items-center gap-3 px-5 py-2.5", mudou && "bg-accent-50/60 dark:bg-accent-900/20")}>
                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", tem ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-surface-2 text-muted")}>
                      {tem ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {f.nome}
                        {f.sensivel && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">sensível</span>}
                        {f.soMaster && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted"><Lock className="h-3 w-3" /> só master</span>}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {f.doNivel ? `Pelo nível: ${f.origem}` : "Não vem do nível"}
                        {f.excecao && !mudou ? ` · exceção ${f.excecao === "concessao" ? "concedida" : "bloqueada"}${f.excecaoValidade ? ` até ${f.excecaoValidade.split("-").reverse().join("/")}` : ""}` : ""}
                        {mudou ? " · alteração não salva" : ""}
                      </span>
                    </span>
                    <span className="inline-flex overflow-hidden rounded-lg border border-line">
                      <Botao f={f} valor="padrao" titulo="Segue o nível do departamento"><RotateCcw className="h-3 w-3" /> Padrão</Botao>
                      <Botao f={f} valor="concessao" titulo={f.soMaster ? "A área financeira é só do administrador master" : "Libera para esta pessoa"}><Check className="h-3 w-3" /> Conceder</Botao>
                      <Botao f={f} valor="revogacao" titulo="Tira desta pessoa, mesmo que o nível dê"><Ban className="h-3 w-3" /> Bloquear</Botao>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!setores.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma funcionalidade encontrada.</p>}
      </div>

      <div className="sticky bottom-3 m-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur lg:flex-row lg:items-end">
        <label className="block flex-1 text-sm"><span className="label">Motivo (fica na auditoria)</span>
          <input className="input" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={`Ex.: ${nome} vai apoiar o administrativo na conferência de documentos`} />
        </label>
        <label className="block text-sm"><span className="label">Válido até (opcional)</span>
          <input type="date" className="input" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </label>
        <div className="flex gap-2">
          {mudancas.length > 0 && <button type="button" onClick={() => setEstado(inicial)} className="h-10 rounded-xl border border-line px-4 text-sm font-semibold">Desfazer</button>}
          <button type="button" disabled={pending || !mudancas.length || motivo.trim().length < 3} onClick={salvar} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar {mudancas.length ? `${mudancas.length} alteração(ões)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
