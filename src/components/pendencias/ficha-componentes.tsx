"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Send } from "lucide-react";
import { adicionarItemFicha, encerrarFicha, marcarPendenciaResolvida, salvarCabecalhoFicha } from "@/lib/actions/fichas-pendencia";
import { CASO_STATUS, FICHA_BENEFICIOS, FICHA_DESTINOS, FICHA_DESTINOS_POR_TIPO, FICHA_SEGURADOS, type Option } from "@/lib/constants";
import { AssinaturaPad } from "@/components/ui/assinatura-pad";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Chips({ options, value, onChange, nome }: { options: Option[]; value: string | null; onChange: (v: string | null) => void; nome: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={nome}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={cn("rounded-full border px-3 py-1 text-sm font-semibold transition", value === o.value ? "border-brand-600 bg-brand-700 text-white" : "border-line text-muted hover:bg-surface-2")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Cabeçalho editável: benefício, segurado e data em que a análise foi recebida. Salva a cada escolha. */
export function CabecalhoFicha({ fichaId, beneficio, segurado, recebidaEm, editavel }: { fichaId: string; beneficio: string | null; segurado: string | null; recebidaEm: string; editavel: boolean }) {
  const [v, setV] = useState({ beneficio, segurado, recebida_em: recebidaEm });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const salvar = (novo: typeof v) => {
    setV(novo);
    start(async () => {
      const fd = new FormData();
      fd.set("id", fichaId);
      fd.set("beneficio", novo.beneficio ?? "");
      fd.set("segurado", novo.segurado ?? "");
      fd.set("recebida_em", novo.recebida_em);
      const r = await salvarCabecalhoFicha({}, fd);
      if (!r.ok) toast(r.error ?? "Não foi possível salvar.", "error");
      else router.refresh();
    });
  };
  if (!editavel) return null;
  return (
    <div className="grid gap-4 border-t border-line p-4 sm:p-5 lg:grid-cols-[1fr_auto_auto]">
      <div>
        <p className="label">Benefício</p>
        <Chips nome="Benefício" options={FICHA_BENEFICIOS} value={v.beneficio} onChange={(b) => salvar({ ...v, beneficio: b })} />
      </div>
      <div>
        <p className="label">Segurado</p>
        <Chips nome="Segurado" options={FICHA_SEGURADOS} value={v.segurado} onChange={(s) => salvar({ ...v, segurado: s })} />
      </div>
      <label className="block text-sm">
        <span className="label flex items-center gap-2">Análise recebida em {pending && <Loader2 className="h-3 w-3 animate-spin" />}</span>
        <input type="date" className="input" max={hojeISO()} value={v.recebida_em} onChange={(e) => e.target.value && salvar({ ...v, recebida_em: e.target.value })} />
      </label>
    </div>
  );
}

/** Linha nova de anotação (seção 1: pendência/providência com prazo opcional; seção 2: retorno do cliente). */
export function NovaAnotacao({ fichaId, secao, tipo = "pendencia" }: { fichaId: string; secao: "pendencia" | "retorno"; tipo?: "pendencia" | "exigencia" }) {
  const [data, setData] = useState(hojeISO());
  const [texto, setTexto] = useState("");
  const [prazo, setPrazo] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const enviar = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("ficha_id", fichaId);
      fd.set("secao", secao);
      fd.set("data", data);
      fd.set("texto", texto);
      fd.set("prazo", prazo);
      const r = await adicionarItemFicha({}, fd);
      if (r.ok) {
        setTexto("");
        setPrazo("");
        router.refresh();
      } else toast(r.fieldErrors?.texto ?? r.error ?? "Não foi possível registrar.", "error");
    });
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface-2/40 p-3 sm:flex-row sm:items-end">
      <label className="block text-sm sm:w-40">
        <span className="label">Data</span>
        <input type="date" className="input" max={hojeISO()} value={data} onChange={(e) => setData(e.target.value)} />
      </label>
      <label className="block flex-1 text-sm">
        <span className="label">{secao === "pendencia" ? (tipo === "exigencia" ? "Exigência / providência" : "Pendência / providência") : "Retorno / resultado do contato"}</span>
        <input
          className="input"
          maxLength={2000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && texto.trim().length >= 2) { e.preventDefault(); enviar(); } }}
          placeholder={secao === "pendencia" ? (tipo === "exigencia" ? "O que o INSS exigiu, o que foi pedido ao cliente e a quem" : "O que falta, o que foi pedido e a quem") : "Contato, resposta, documento entregue"}
        />
      </label>
      {secao === "pendencia" && (
        <label className="block text-sm sm:w-40">
          <span className="label">Prazo (opcional)</span>
          <input type="date" className="input" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </label>
      )}
      <button type="button" disabled={pending || texto.trim().length < 2} onClick={enviar} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Anotar
      </button>
    </div>
  );
}

/** Caixa "resolvida" de uma pendência. */
export function ResolvidaToggle({ itemId, resolvida, editavel }: { itemId: string; resolvida: boolean; editavel: boolean }) {
  const [v, setV] = useState(resolvida);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <label className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold", v ? "text-emerald-700 dark:text-emerald-400" : "text-muted")}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-emerald-600"
        checked={v}
        disabled={!editavel || pending}
        onChange={(e) => {
          const novo = e.target.checked;
          setV(novo);
          start(async () => {
            const r = await marcarPendenciaResolvida(itemId, novo);
            if (!r.ok) { setV(!novo); toast(r.error ?? "Não foi possível salvar.", "error"); }
          });
        }}
      />
      {v ? "Resolvida" : "Em aberto"}
    </label>
  );
}

/** Seção 3: destino do processo, assinatura de quem cuidou da ficha e encaminhamento (análise ou habilitação). */
export function EncerrarFicha({ fichaId, tipo, analistas, habilitadores, nomeResponsavel, pendenciasAbertas }: {
  fichaId: string;
  tipo: "pendencia" | "exigencia";
  analistas: Option[];
  habilitadores: Option[];
  nomeResponsavel: string;
  pendenciasAbertas: number;
}) {
  const destinos = FICHA_DESTINOS.filter((d) => FICHA_DESTINOS_POR_TIPO[tipo].includes(d.value) || d.value === "outro");
  const [destino, setDestino] = useState<string | null>("analise");
  const padrao = (ops: Option[]) => (ops.length === 1 ? ops[0].value : "");
  const [analista, setAnalista] = useState(padrao(analistas));
  const [habilitador, setHabilitador] = useState(padrao(habilitadores));
  const [cumprida, setCumprida] = useState(true);
  const [outroStatus, setOutroStatus] = useState("");
  const [outroTexto, setOutroTexto] = useState("");
  const [png, setPng] = useState<Blob | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const outros = CASO_STATUS.filter((s) => !["pendencia", "em_analise", "habilitado", "habilitacao", "exigencia"].includes(s.value));
  const recebe = destino === "analise" ? analista : destino === "habilitacao" ? habilitador : "";
  const pronto = !!destino && !!png && (!["analise", "habilitacao"].includes(destino) || !!recebe) && (destino !== "outro" || !!outroStatus);
  const item = tipo === "exigencia" ? "exigência(s)" : "pendência(s)";

  const encerrar = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", fichaId);
      fd.set("destino", destino ?? "");
      fd.set("encaminhado_para", recebe);
      fd.set("outro_status", destino === "outro" ? outroStatus : "");
      fd.set("destino_outro", destino === "outro" ? outroTexto : "");
      fd.set("exigencia_cumprida", tipo === "exigencia" && cumprida ? "true" : "false");
      fd.set("assinatura", new File([png!], "assinatura.png", { type: "image/png" }));
      const r = await encerrarFicha({}, fd);
      if (r.ok) {
        toast(r.message ?? "Ficha encerrada.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível encerrar.", "error");
    });

  const Pessoa = ({ rotulo, ops, valor, onChange, vazio }: { rotulo: string; ops: Option[]; valor: string; onChange: (v: string) => void; vazio: string }) => (
    <label className="block max-w-sm text-sm">
      <span className="label">{rotulo}</span>
      {ops.length ? (
        <select className="input" value={valor} onChange={(e) => onChange(e.target.value)}>
          <option value="">Escolha…</option>
          {ops.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      ) : <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">{vazio}</p>}
    </label>
  );

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {pendenciasAbertas > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {pendenciasAbertas} {item} ainda marcada(s) como em aberto. Se o processo seguir mesmo assim, explique na seção 1 ou 2.
        </p>
      )}
      <div>
        <p className="label">Para onde vai o processo</p>
        <Chips nome="Destino" options={destinos} value={destino} onChange={setDestino} />
      </div>
      {destino === "analise" && <Pessoa rotulo="Analista que recebe" ops={analistas} valor={analista} onChange={setAnalista} vazio="Ninguém no setor de Análise. Cadastre a analista no setor em Departamentos." />}
      {destino === "habilitacao" && <Pessoa rotulo="Quem faz a habilitação" ops={habilitadores} valor={habilitador} onChange={setHabilitador} vazio="Nenhuma pessoa definida para a habilitação." />}
      {destino === "outro" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="label">Nova situação</span>
            <select className="input" value={outroStatus} onChange={(e) => setOutroStatus(e.target.value)}>
              <option value="">Escolha…</option>
              {outros.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="label">Qual / por quê (opcional)</span><input className="input" maxLength={120} value={outroTexto} onChange={(e) => setOutroTexto(e.target.value)} /></label>
        </div>
      )}
      {tipo === "exigencia" && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={cumprida} onChange={(e) => setCumprida(e.target.checked)} />
          Exigência cumprida no INSS
        </label>
      )}
      <div className="max-w-md">
        <AssinaturaPad rotulo={`Assinatura da responsável — ${nomeResponsavel}`} onChange={setPng} />
      </div>
      <button type="button" disabled={!pronto || pending} onClick={encerrar} className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-600 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : destino === "analise" || destino === "habilitacao" ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {destino === "analise" ? "Encerrar e enviar para a análise" : destino === "habilitacao" ? "Encerrar e enviar para a habilitação" : "Encerrar ficha"}
      </button>
      <p className="text-xs text-muted">Ao encerrar, o processo muda de situação, a ficha fica assinada e não pode mais ser alterada, e quem recebe é avisado.</p>
    </div>
  );
}
