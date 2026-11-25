"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Send } from "lucide-react";
import { adicionarItemFicha, encerrarFicha, marcarPendenciaResolvida, salvarCabecalhoFicha } from "@/lib/actions/fichas-pendencia";
import { CASO_STATUS, FICHA_BENEFICIOS, FICHA_DESTINOS, FICHA_SEGURADOS, type Option } from "@/lib/constants";
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
export function NovaAnotacao({ fichaId, secao }: { fichaId: string; secao: "pendencia" | "retorno" }) {
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
        <span className="label">{secao === "pendencia" ? "Pendência / providência" : "Retorno / resultado do contato"}</span>
        <input
          className="input"
          maxLength={2000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && texto.trim().length >= 2) { e.preventDefault(); enviar(); } }}
          placeholder={secao === "pendencia" ? "O que falta, o que foi pedido e a quem" : "Contato, resposta, documento entregue"}
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

/** Seção 3: destino do processo, assinatura de quem cuidou da pendência e encaminhamento. */
export function EncerrarFicha({ fichaId, analistas, analistaPadrao, protocolo, situacao, nomeResponsavel, pendenciasAbertas }: {
  fichaId: string;
  analistas: Option[];
  analistaPadrao: string | null;
  protocolo: string | null;
  situacao: string | null;
  nomeResponsavel: string;
  pendenciasAbertas: number;
}) {
  const [destino, setDestino] = useState<string | null>("analise");
  const [analista, setAnalista] = useState(analistaPadrao ?? "");
  const [prot, setProt] = useState(protocolo ?? "");
  const [sit, setSit] = useState(situacao ?? "");
  const [outroStatus, setOutroStatus] = useState("");
  const [outroTexto, setOutroTexto] = useState("");
  const [png, setPng] = useState<Blob | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const outros = CASO_STATUS.filter((s) => !["pendencia", "em_analise", "habilitado", "exigencia"].includes(s.value));
  const pronto = !!destino && !!png && (destino !== "analise" || !!analista) && (destino !== "habilitado" || (prot.trim() && sit.trim())) && (destino !== "outro" || !!outroStatus);

  const encerrar = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", fichaId);
      fd.set("destino", destino ?? "");
      fd.set("encaminhado_para", destino === "analise" ? analista : "");
      fd.set("protocolo_inss", prot);
      fd.set("situacao_atual", sit);
      fd.set("outro_status", destino === "outro" ? outroStatus : "");
      fd.set("destino_outro", destino === "outro" ? outroTexto : "");
      fd.set("assinatura", new File([png!], "assinatura.png", { type: "image/png" }));
      const r = await encerrarFicha({}, fd);
      if (r.ok) {
        toast(r.message ?? "Ficha encerrada.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível encerrar.", "error");
    });

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {pendenciasAbertas > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {pendenciasAbertas} pendência(s) ainda marcada(s) como em aberto. Se o processo seguir mesmo assim, explique na seção 1 ou 2.
        </p>
      )}
      <div>
        <p className="label">Para onde vai o processo</p>
        <Chips nome="Destino" options={FICHA_DESTINOS} value={destino} onChange={setDestino} />
      </div>
      {destino === "analise" && (
        <label className="block max-w-sm text-sm">
          <span className="label">Analista que recebe</span>
          <select className="input" value={analista} onChange={(e) => setAnalista(e.target.value)}>
            <option value="">Escolha…</option>
            {analistas.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
      )}
      {destino === "habilitado" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="label">Protocolo do INSS</span><input className="input" maxLength={40} value={prot} onChange={(e) => setProt(e.target.value)} /></label>
          <label className="block text-sm"><span className="label">Estado atual do processo</span><input className="input" maxLength={300} value={sit} onChange={(e) => setSit(e.target.value)} placeholder="Ex.: aguardando perícia" /></label>
        </div>
      )}
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
      <div className="max-w-md">
        <AssinaturaPad rotulo={`Assinatura da responsável pela pendência — ${nomeResponsavel}`} onChange={setPng} />
      </div>
      <button type="button" disabled={!pronto || pending} onClick={encerrar} className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-600 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : destino === "analise" ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {destino === "analise" ? "Encerrar e enviar para a análise" : "Encerrar ficha"}
      </button>
      <p className="text-xs text-muted">Ao encerrar, o processo muda de situação, a ficha fica assinada e não pode mais ser alterada, e quem recebe é avisado.</p>
    </div>
  );
}
