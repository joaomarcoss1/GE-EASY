"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Fuel, Gauge, Loader2, PenLine } from "lucide-react";
import { NIVEIS_TANQUE } from "@/lib/constants";
import { AssinaturaPad } from "@/components/ui/assinatura-pad";
import { useCampo } from "./contexto";
import { FotoInput } from "./foto-input";
import type { RotaCampo } from "./tipos";

/** Checklist do veículo pelo consultor responsável: km, nível do tanque e foto do painel; na chegada, avarias com relatório assinado. */
export function ChecklistVeiculo({ rota, momento }: { rota: RotaCampo; momento: "saida" | "chegada" }) {
  const { registrar, aviso } = useCampo();
  const saida = rota.checklists?.find((c) => c.momento === "saida");
  const [km, setKm] = useState("");
  const [tanque, setTanque] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [avaria, setAvaria] = useState<"" | "sim" | "nao">(momento === "saida" ? "nao" : "");
  const [descricao, setDescricao] = useState("");
  const [assinatura, setAssinatura] = useState<Blob | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async () => {
    const n = Number(km);
    if (!km || !Number.isFinite(n)) return aviso("Informe a quilometragem do painel.", "erro");
    if (momento === "chegada" && saida && n < saida.km) return aviso(`A quilometragem de chegada não pode ser menor que a de saída (${saida.km.toLocaleString("pt-BR")} km).`, "erro");
    if (!tanque) return aviso("Informe o nível do tanque.", "erro");
    if (!foto) return aviso("Tire a foto do painel do carro.", "erro");
    if (momento === "chegada" && !avaria) return aviso("Informe se houve avaria no veículo.", "erro");
    if (avaria === "sim" && descricao.trim().length < 10) return aviso("Explique a avaria (mínimo 10 caracteres).", "erro");
    if (avaria === "sim" && !assinatura) return aviso("Assine o relatório de avaria.", "erro");
    setOcupado(true);
    try {
      const arquivos = [{ campo: "foto", nome: "painel.jpg", blob: foto }, ...(avaria === "sim" && assinatura ? [{ campo: "assinatura", nome: "avaria.png", blob: assinatura }] : [])];
      await registrar("checklist", {
        id: crypto.randomUUID(), rota_id: rota.id, momento, km: n, nivel_tanque: tanque, avaria: avaria === "sim", avaria_descricao: avaria === "sim" ? descricao.trim() : null,
      }, `Checklist de ${momento === "saida" ? "saída" : "chegada"} — ${rota.nome}`, arquivos);
      aviso(momento === "saida" ? "Checklist de saída registrado. Pode iniciar a rota." : avaria === "sim" ? "Checklist de chegada e relatório de avaria registrados." : "Checklist de chegada registrado.");
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha ao registrar o checklist.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="card space-y-3 border-2 border-accent-300 p-4">
      <p className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-5 w-5 text-accent-600" /> Checklist do veículo — {momento === "saida" ? "antes da partida" : "na chegada"}</p>
      <label className="block text-sm"><span className="label flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Quilometragem do painel (km)</span>
        <input className="input" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder={saida && momento === "chegada" ? `Saída: ${saida.km.toLocaleString("pt-BR")} km` : "Ex.: 45210"} />
      </label>
      <div className="text-sm">
        <span className="label flex items-center gap-1.5"><Fuel className="h-4 w-4" /> Nível do tanque</span>
        <div className="grid grid-cols-5 gap-1.5">
          {NIVEIS_TANQUE.map((n) => (
            <button key={n.value} type="button" onClick={() => setTanque(n.value)} className={`rounded-xl border px-1 py-2 text-xs font-semibold ${tanque === n.value ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100" : "border-line"}`}>{n.label}</button>
          ))}
        </div>
      </div>
      <FotoInput label="Foto do painel do carro (obrigatória)" onFoto={setFoto} />
      {momento === "chegada" && (
        <div className="space-y-2 text-sm">
          <span className="label flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Houve avaria no veículo?</span>
          <div className="grid grid-cols-2 gap-2">
            {(["nao", "sim"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setAvaria(v)} className={`rounded-xl border py-2.5 font-semibold ${avaria === v ? (v === "sim" ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200" : "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200") : "border-line"}`}>{v === "sim" ? "Sim, teve avaria" : "Não"}</button>
            ))}
          </div>
          {avaria === "sim" && (
            <div className="space-y-2 rounded-xl bg-red-50 p-3 dark:bg-red-950/30">
              <textarea className="input" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value.slice(0, 2000))} placeholder="Explique o que aconteceu: onde, como, qual parte do carro foi danificada." />
              <AssinaturaPad rotulo="Assinatura do responsável (relatório de avaria)" onChange={setAssinatura} />
            </div>
          )}
        </div>
      )}
      <button type="button" disabled={ocupado} onClick={enviar} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 font-bold text-white">
        {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Registrar checklist de {momento === "saida" ? "saída" : "chegada"}
      </button>
    </div>
  );
}

/** Relatório final da rota assinado por todos que foram (responsável e participantes). */
export function AssinaturasRota({ rota }: { rota: RotaCampo }) {
  const { snap, registrar, aviso } = useCampo();
  const pessoas = [{ id: snap.usuario.id, nome: snap.usuario.nome, papel: "responsavel" as const }, ...(rota.participantes ?? []).map((p) => ({ ...p, papel: "participante" as const }))];
  const assinados = new Set((rota.assinaturas ?? []).map((a) => a.nome));
  const faltam = pessoas.filter((p) => !assinados.has(p.nome));
  const [atual, setAtual] = useState<string | null>(null);
  const [png, setPng] = useState<Blob | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pessoa = faltam.find((p) => p.id === atual) ?? null;

  const assinar = async () => {
    if (!pessoa || !png) return aviso("Faça a assinatura no quadro.", "erro");
    setOcupado(true);
    try {
      await registrar("assinatura_rota", { id: crypto.randomUUID(), rota_id: rota.id, nome: pessoa.nome, usuario_id: pessoa.id, papel: pessoa.papel }, `Assinatura de ${pessoa.nome} — ${rota.nome}`, [{ campo: "assinatura", nome: "assinatura.png", blob: png }]);
      aviso(`Relatório assinado por ${pessoa.nome}.`);
      setAtual(null);
      setPng(null);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "Falha ao registrar a assinatura.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="card space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold"><PenLine className="h-5 w-5 text-brand-700" /> Relatório da rota — assinaturas</p>
      <ul className="space-y-1.5 text-sm">
        {pessoas.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span>{p.nome} <span className="text-xs text-muted">{p.papel === "responsavel" ? "(responsável)" : "(participante)"}</span></span>
            {assinados.has(p.nome) ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> assinado</span> : (
              <button type="button" onClick={() => { setAtual(p.id); setPng(null); }} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold">Assinar</button>
            )}
          </li>
        ))}
      </ul>
      {faltam.length === 0 && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Todos assinaram. O relatório fica disponível para a gestão.</p>}
      {pessoa && (
        <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          <p className="text-sm">Confirmo as informações desta rota (paradas, quilometragem, checklist e despesas). — <b>{pessoa.nome}</b></p>
          <AssinaturaPad key={pessoa.id} rotulo={`Assinatura de ${pessoa.nome}`} onChange={setPng} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setAtual(null)} className="flex-1 rounded-xl border border-line py-2.5 font-semibold">Cancelar</button>
            <button type="button" disabled={ocupado || !png} onClick={assinar} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 py-2.5 font-semibold text-white disabled:opacity-50">{ocupado && <Loader2 className="h-4 w-4 animate-spin" />}Assinar</button>
          </div>
        </div>
      )}
    </div>
  );
}
