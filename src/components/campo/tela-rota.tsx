"use client";
import { useState } from "react";
import { CheckCircle2, Flag, Loader2, LogIn, LogOut, MapPin, Navigation, Play } from "lucide-react";
import { distanciaM } from "@/lib/geo";
import { CHECKIN_RESULTADOS } from "@/lib/constants";
import { useCampo } from "./contexto";
import { hojeISO, posicaoAtual, type ParadaCampo, type RotaCampo } from "./tipos";
import { FotoInput } from "./foto-input";

/** Execução da rota no campo: iniciar, chegada/saída em cada parada (com raio), finalizar. Funciona offline. */
export function TelaRota() {
  const { snap, params, irPara } = useCampo();
  const hoje = hojeISO();
  const rota = snap.rotas.find((r) => r.id === params.rota) ?? snap.rotas.find((r) => r.status === "em_andamento") ?? snap.rotas.find((r) => r.data === hoje);
  if (!rota) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Nenhuma rota para hoje.</p>
        {snap.rotas.map((r) => <button key={r.id} type="button" onClick={() => irPara("rota", { rota: r.id })} className="card block w-full p-4 text-left"><b>{r.nome}</b><span className="block text-xs text-muted">{r.data.split("-").reverse().join("/")} · {r.paradas.length} parada(s)</span></button>)}
      </div>
    );
  }
  return <ExecucaoRota rota={rota} />;
}

function ExecucaoRota({ rota }: { rota: RotaCampo }) {
  const { snap, registrar, aviso } = useCampo();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [hodometro, setHodometro] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const exigeHod = snap.parametros.exigir_hodometro;

  const iniciar = async () => {
    if (exigeHod && !hodometro) return aviso("Informe o hodômetro para iniciar.", "erro");
    setOcupado("iniciar");
    try {
      const pos = await posicaoAtual();
      const id = crypto.randomUUID();
      await registrar("iniciar_rota", { id, rota_id: rota.id, lat: pos.lat, lng: pos.lng, hodometro: hodometro ? Number(hodometro) : null }, `Início da rota ${rota.nome}`, foto ? [{ campo: "foto", nome: "hodometro.jpg", blob: foto }] : []);
      aviso("Rota iniciada.");
      setHodometro(""); setFoto(null);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha ao iniciar.", "erro");
    } finally {
      setOcupado(null);
    }
  };

  const finalizar = async () => {
    const pend = rota.paradas.filter((p) => p.status === "pendente");
    const semMotivo = pend.filter((p) => !motivos[p.id]?.trim());
    if (semMotivo.length) return aviso("Informe o motivo das paradas não visitadas.", "erro");
    if (exigeHod && !hodometro) return aviso("Informe o hodômetro final.", "erro");
    setOcupado("finalizar");
    try {
      const pos = await posicaoAtual().catch(() => null);
      await registrar("finalizar_rota", {
        id: crypto.randomUUID(), rota_id: rota.id, lat: pos?.lat ?? null, lng: pos?.lng ?? null, hodometro: hodometro ? Number(hodometro) : null,
        nao_realizadas: pend.map((p) => ({ parada_id: p.id, motivo: motivos[p.id].trim() })),
      }, `Fim da rota ${rota.nome}`, foto ? [{ campo: "foto", nome: "hodometro.jpg", blob: foto }] : []);
      aviso("Rota finalizada e enviada para aprovação.");
      setFinalizando(false);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha ao finalizar.", "erro");
    } finally {
      setOcupado(null);
    }
  };

  const ativa = rota.status === "em_andamento";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted">{rota.data.split("-").reverse().join("/")}</p>
        <h1 className="text-xl font-bold">{rota.nome}</h1>
        {rota.objetivo && <p className="text-sm text-muted">{rota.objetivo}</p>}
      </div>

      {rota.status === "planejada" && (
        <div className="card space-y-3 p-4">
          <p className="text-sm">Ao iniciar, a posição e o horário ficam registrados.</p>
          <input className="input" inputMode="numeric" placeholder={`Hodômetro (km)${exigeHod ? " — obrigatório" : ""}`} value={hodometro} onChange={(e) => setHodometro(e.target.value.replace(/\D/g, ""))} />
          <FotoInput label="Foto do hodômetro" onFoto={setFoto} />
          <button type="button" disabled={!!ocupado} onClick={iniciar} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3.5 text-base font-bold text-white">
            {ocupado === "iniciar" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} Iniciar rota
          </button>
        </div>
      )}

      <ol className="space-y-3">
        {rota.paradas.map((p) => <Parada key={p.id} rota={rota} p={p} ativa={ativa} />)}
      </ol>

      {ativa && !finalizando && (
        <button type="button" onClick={() => setFinalizando(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface py-3 font-semibold"><Flag className="h-5 w-5" /> Finalizar rota</button>
      )}
      {ativa && finalizando && (
        <div className="card space-y-3 p-4">
          <p className="font-semibold">Encerrar a rota</p>
          {rota.paradas.filter((p) => p.status === "pendente").map((p) => (
            <label key={p.id} className="block text-sm">
              <span className="label">Por que não visitou {p.titulo}?</span>
              <input className="input" value={motivos[p.id] ?? ""} onChange={(e) => setMotivos({ ...motivos, [p.id]: e.target.value })} placeholder="Ex.: cliente pediu para remarcar" />
            </label>
          ))}
          <input className="input" inputMode="numeric" placeholder={`Hodômetro final (km)${exigeHod ? " — obrigatório" : ""}`} value={hodometro} onChange={(e) => setHodometro(e.target.value.replace(/\D/g, ""))} />
          <FotoInput label="Foto do hodômetro" onFoto={setFoto} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setFinalizando(false)} className="flex-1 rounded-xl border border-line py-3 font-semibold">Voltar</button>
            <button type="button" disabled={!!ocupado} onClick={finalizar} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white">{ocupado === "finalizar" && <Loader2 className="h-4 w-4 animate-spin" />}Finalizar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Parada({ rota, p, ativa }: { rota: RotaCampo; p: ParadaCampo; ativa: boolean }) {
  const { snap, registrar, aviso, irPara } = useCampo();
  const chegada = rota.checkins.find((c) => c.parada_id === p.id && c.tipo === "chegada");
  const saida = rota.checkins.find((c) => c.parada_id === p.id && c.tipo === "saida");
  const [etapa, setEtapa] = useState<"nada" | "justificar" | "saida">("nada");
  const [justificativa, setJust] = useState("");
  const [resultado, setResultado] = useState("");
  const [obs, setObs] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number; precisao: number | null; em: string; dist: number | null } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const raio = p.raio_m ?? snap.parametros.raio_m;

  const marcarChegada = async () => {
    setOcupado(true);
    try {
      const atual = await posicaoAtual();
      const dist = p.lat != null && p.lng != null ? Math.round(distanciaM(atual, { lat: p.lat, lng: p.lng })) : null;
      const fora = dist != null && dist > raio;
      if (fora && snap.parametros.fora_do_raio === "bloquear") { aviso(`Você está a ${dist} m da parada (raio ${raio} m). Aproxime-se para o check-in.`, "erro"); return; }
      if (snap.parametros.exigir_selfie && !foto) { aviso("Tire a foto do check-in.", "erro"); return; }
      if (fora && !justificativa.trim()) { setPos({ ...atual, dist }); setEtapa("justificar"); return; }
      await enviarChegada({ ...atual, dist });
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha no check-in.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  const enviarChegada = async (atual: { lat: number; lng: number; precisao: number | null; em: string; dist: number | null }) => {
    await registrar("checkin", {
      id: crypto.randomUUID(), rota_id: rota.id, parada_id: p.id, tipo: "chegada", lat: atual.lat, lng: atual.lng, precisao: atual.precisao,
      dispositivo_em: new Date().toISOString(), justificativa: justificativa.trim() || null, mock: false,
    }, `Chegada: ${p.titulo}`, foto ? [{ campo: "foto", nome: "checkin.jpg", blob: foto }] : []);
    aviso(atual.dist != null && atual.dist > raio ? `Chegada registrada fora do raio (${atual.dist} m) — vai para revisão.` : "Chegada registrada.");
    setEtapa("nada"); setJust(""); setFoto(null);
  };

  const marcarSaida = async () => {
    if (!resultado) return aviso("Escolha o resultado da visita.", "erro");
    setOcupado(true);
    try {
      const atual = await posicaoAtual();
      await registrar("checkin", {
        id: crypto.randomUUID(), rota_id: rota.id, parada_id: p.id, tipo: "saida", lat: atual.lat, lng: atual.lng, precisao: atual.precisao,
        dispositivo_em: new Date().toISOString(), resultado, observacao: obs.trim() || null, mock: false,
      }, `Saída: ${p.titulo}`);
      aviso("Saída registrada.");
      setEtapa("nada");
      if (resultado === "pre_cadastro") irPara("cadastro");
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha no check-out.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  const mapa = p.lat != null && p.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : p.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.endereco, p.cidade, p.uf].filter(Boolean).join(", "))}` : null;
  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${saida ? "bg-emerald-100 text-emerald-700" : chegada ? "bg-amber-100 text-amber-800" : "bg-surface-2"}`}>{saida ? <CheckCircle2 className="h-5 w-5" /> : p.ordem}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{p.titulo}</p>
          <p className="text-xs text-muted">{[p.endereco, p.cidade].filter(Boolean).join(" · ")}{p.janela_inicio ? ` · ${p.janela_inicio.slice(0, 5)}–${p.janela_fim?.slice(0, 5) ?? ""}` : ""}</p>
          {p.objetivo && <p className="mt-1 text-xs">{p.objetivo}</p>}
          {chegada && <p className="mt-1 text-xs text-muted">Chegada {new Date(chegada.registrado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{chegada.pendente ? " (aguardando envio)" : ""}{saida ? ` · saída ${new Date(saida.registrado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>}
        </div>
        {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-brand-700" aria-label="Navegar"><Navigation className="h-5 w-5" /></a>}
      </div>

      {ativa && !chegada && p.status === "pendente" && etapa === "nada" && (
        <div className="mt-3 space-y-2">
          {snap.parametros.exigir_selfie && <FotoInput label="Foto do check-in" frontal onFoto={setFoto} />}
          <button type="button" disabled={ocupado} onClick={marcarChegada} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Cheguei
          </button>
        </div>
      )}
      {etapa === "justificar" && pos && (
        <div className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-1.5 font-semibold"><MapPin className="h-4 w-4" /> Você está a {pos.dist} m da parada (raio {raio} m).</p>
          <textarea className="input" rows={2} placeholder="Justificativa (vai para revisão do supervisor)" value={justificativa} onChange={(e) => setJust(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEtapa("nada")} className="flex-1 rounded-xl border border-amber-300 py-2.5 font-semibold">Cancelar</button>
            <button type="button" disabled={!justificativa.trim()} onClick={() => enviarChegada(pos)} className="flex-1 rounded-xl bg-amber-600 py-2.5 font-semibold text-white">Registrar</button>
          </div>
        </div>
      )}
      {ativa && chegada && !saida && etapa !== "saida" && (
        <button type="button" onClick={() => setEtapa("saida")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 font-semibold"><LogOut className="h-4 w-4" /> Saída e resultado</button>
      )}
      {etapa === "saida" && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {CHECKIN_RESULTADOS.map((r) => (
              <button key={r.value} type="button" onClick={() => setResultado(r.value)} className={`rounded-xl border px-2 py-2 text-xs font-semibold ${resultado === r.value ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line"}`}>{r.label}</button>
            ))}
          </div>
          <textarea className="input" rows={2} placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
          <button type="button" disabled={ocupado} onClick={marcarSaida} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white">{ocupado && <Loader2 className="h-4 w-4 animate-spin" />}Registrar saída</button>
        </div>
      )}
    </li>
  );
}
