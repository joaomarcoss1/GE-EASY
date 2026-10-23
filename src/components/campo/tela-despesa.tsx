"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DESPESA_TIPOS } from "@/lib/constants";
import { useCampo } from "./contexto";
import { hojeISO } from "./tipos";
import { FotoInput } from "./foto-input";

/** Despesa de rota com foto do comprovante (offline). */
export function TelaDespesa() {
  const { snap, registrar, aviso, irPara } = useCampo();
  const rotaAtiva = snap.rotas.find((r) => r.status === "em_andamento");
  const [f, setF] = useState({ tipo: "combustivel", valor: "", data: hojeISO(), descricao: "", hodometro: "", rota_id: rotaAtiva?.id ?? "" });
  const [foto, setFoto] = useState<Blob | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const salvar = async () => {
    const valor = Number(f.valor.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) return aviso("Informe o valor.", "erro");
    if (!foto) return aviso("Fotografe o comprovante.", "erro");
    setOcupado(true);
    try {
      await registrar("despesa", {
        id: crypto.randomUUID(), rota_id: f.rota_id || null, tipo: f.tipo, valor: Math.round(valor * 100) / 100, data: f.data,
        descricao: f.descricao.trim() || null, hodometro: f.hodometro ? Number(f.hodometro) : null,
      }, `Despesa: ${DESPESA_TIPOS.find((t) => t.value === f.tipo)?.label} R$ ${valor.toFixed(2).replace(".", ",")}`, [{ campo: "comprovante", nome: "comprovante.jpg", blob: foto }]);
      aviso("Despesa salva. Será enviada para aprovação.");
      irPara("inicio");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Lançar despesa</h1>
      <select className="input" value={f.tipo} onChange={set("tipo")} aria-label="Tipo">{DESPESA_TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      <input className="input" inputMode="decimal" placeholder="Valor (R$) *" value={f.valor} onChange={set("valor")} />
      <input className="input" type="date" value={f.data} onChange={set("data")} />
      <select className="input" value={f.rota_id} onChange={set("rota_id")} aria-label="Rota">
        <option value="">Sem rota</option>
        {snap.rotas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select>
      <input className="input" inputMode="numeric" placeholder="Hodômetro (opcional)" value={f.hodometro} onChange={(e) => setF({ ...f, hodometro: e.target.value.replace(/\D/g, "") })} />
      <textarea className="input" rows={2} placeholder="Descrição" value={f.descricao} onChange={set("descricao")} />
      <FotoInput label="Foto do comprovante *" onFoto={setFoto} />
      <button type="button" disabled={ocupado} onClick={salvar} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3.5 font-bold text-white">{ocupado && <Loader2 className="h-5 w-5 animate-spin" />}Salvar despesa</button>
    </div>
  );
}
