"use client";
import { useRef, useState } from "react";
import { Crosshair, Loader2, Search, X } from "lucide-react";
import { coordValida, type Ponto } from "@/lib/geo";
import { localizarEndereco } from "@/lib/actions/rotas";
import { Mapa } from "./mapa";

/** Endereço do próprio formulário (campos usuais de endereço), usado quando a busca está vazia. */
function enderecoDoFormulario(form: HTMLFormElement | null) {
  if (!form) return "";
  const v = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "").trim();
  return [[v("endereco"), v("numero")].filter(Boolean).join(", "), v("bairro"), v("cidade"), v("uf")].filter(Boolean).join(", ");
}

/**
 * Campo "local no mapa" do ResourceForm: grava as coordenadas em dois campos ocultos (nomes do FieldDef,
 * ex.: "lat,lng"). Busca pelo endereço digitado (ou o do formulário), posição atual, clique ou arraste no mapa.
 */
export function CampoLocal({ nomes, valor, label, help, error }: { nomes: [string, string]; valor: Ponto | null; label?: string; help?: string; error?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ponto, setPonto] = useState<Ponto | null>(coordValida(valor) ? valor : null);
  const [foco, setFoco] = useState<Ponto | null>(null);
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const escolher = (p: Ponto, centralizar = false) => {
    const r = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
    setPonto(r);
    if (centralizar) setFoco(r);
  };

  const buscar = async () => {
    const texto = busca.trim() || enderecoDoFormulario(ref.current?.closest("form") ?? null);
    if (!texto) return setMsg({ texto: "Digite o endereço ou preencha os campos de endereço.", erro: true });
    setOcupado(true);
    const r = await localizarEndereco(texto).catch(() => ({ error: "Falha ao buscar o endereço." }) as Awaited<ReturnType<typeof localizarEndereco>>);
    setOcupado(false);
    if (r.lat != null && r.lng != null) escolher({ lat: r.lat, lng: r.lng }, true);
    setMsg({ texto: r.message ?? r.error ?? "", erro: !!r.error });
  };

  const minhaPosicao = () => {
    if (!navigator.geolocation) return setMsg({ texto: "Este aparelho não oferece localização.", erro: true });
    setOcupado(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setOcupado(false); escolher({ lat: p.coords.latitude, lng: p.coords.longitude }, true); setMsg({ texto: "Posição atual marcada." }); },
      () => { setOcupado(false); setMsg({ texto: "Não foi possível obter a localização (permita o acesso no navegador).", erro: true }); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div ref={ref} className="space-y-2 sm:col-span-6">
      {label && <span className="label">{label}</span>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input flex-1"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          // Enter busca o endereço em vez de enviar o formulário
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
          placeholder="Buscar endereço (vazio = usa o endereço do formulário)"
          aria-label="Buscar endereço no mapa"
        />
        <div className="flex gap-2">
          <button type="button" onClick={buscar} disabled={ocupado} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-2">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Buscar
          </button>
          <button type="button" onClick={minhaPosicao} disabled={ocupado} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-2" title="Usar minha localização atual">
            <Crosshair className="h-4 w-4" /><span className="sm:hidden">Minha posição</span>
          </button>
          {ponto && (
            <button type="button" onClick={() => { setPonto(null); setMsg(null); }} className="inline-flex items-center rounded-xl border border-line px-3 py-2 text-sm hover:bg-surface-2" title="Limpar local">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <Mapa className="h-64" selecao={ponto} onSelecionar={(p) => escolher(p)} centralizar={foco} />
      <input type="hidden" name={nomes[0]} value={ponto?.lat ?? ""} />
      <input type="hidden" name={nomes[1]} value={ponto?.lng ?? ""} />
      <p className={`text-xs ${error || msg?.erro ? "font-medium text-red-600" : "text-muted"}`}>
        {error ?? msg?.texto ?? (ponto ? `Local marcado: ${ponto.lat}, ${ponto.lng} — clique ou arraste para ajustar.` : (help ?? "Clique no mapa para marcar o ponto exato."))}
      </p>
    </div>
  );
}
