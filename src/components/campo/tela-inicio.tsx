"use client";
import { AlarmClock, Camera, Clock, Map as MapIcon, Receipt, UserPlus, Users } from "lucide-react";
import { useCampo } from "./contexto";
import { hojeISO } from "./tipos";

const diasAte = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);

/** Painel do consultor: rota do dia, prazos dos 45 dias, leads, despesas e atalhos. */
export function TelaInicio() {
  const { snap, irPara } = useCampo();
  const hoje = hojeISO();
  const rotaAtiva = snap.rotas.find((r) => r.status === "em_andamento") ?? snap.rotas.find((r) => r.data === hoje && r.status === "planejada");
  const feitas = rotaAtiva ? rotaAtiva.paradas.filter((p) => p.status === "visitada").length : 0;
  const atalhos = [
    snap.pode.cadastrar && { t: "cadastro" as const, label: "Pré-cadastro", icon: <UserPlus className="h-6 w-6" /> },
    snap.pode.cadastrar && { t: "scanner" as const, label: "Scanner", icon: <Camera className="h-6 w-6" /> },
    snap.pode.despesas && { t: "despesa" as const, label: "Despesa", icon: <Receipt className="h-6 w-6" /> },
    snap.pode.ponto && { t: "ponto" as const, label: "Ponto", icon: <Clock className="h-6 w-6" /> },
  ].filter(Boolean) as { t: "cadastro" | "scanner" | "despesa" | "ponto"; label: string; icon: React.ReactNode }[];

  return (
    <div className="space-y-4">
      {snap.pode.rotas && (
        <button type="button" onClick={() => irPara("rota", rotaAtiva ? { rota: rotaAtiva.id } : {})} className="card w-full p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted"><MapIcon className="h-4 w-4" /> Rota do dia</div>
          {rotaAtiva ? (
            <>
              <p className="mt-1 text-lg font-bold">{rotaAtiva.nome}</p>
              <p className="text-sm text-muted">{rotaAtiva.status === "em_andamento" ? "Em andamento" : "Não iniciada"} · {feitas}/{rotaAtiva.paradas.length} parada(s)</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-emerald-500" style={{ width: `${rotaAtiva.paradas.length ? (feitas / rotaAtiva.paradas.length) * 100 : 0}%` }} /></div>
            </>
          ) : <p className="mt-1 text-sm text-muted">Nenhuma rota para hoje.</p>}
        </button>
      )}

      {atalhos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {atalhos.map((a) => (
            <button key={a.t} type="button" onClick={() => irPara(a.t)} className="card flex flex-col items-center gap-1.5 px-1 py-3 text-xs font-semibold">
              <span className="text-brand-700 dark:text-brand-200">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4"><p className="text-xs text-muted">Leads novos</p><p className="text-2xl font-bold">{snap.contadores.leads_novos}</p></div>
        <div className="card p-4"><p className="text-xs text-muted">Despesas em análise</p><p className="text-2xl font-bold">{snap.contadores.despesas_pendentes}</p></div>
      </div>

      <section className="card">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold"><AlarmClock className="h-4 w-4" /> Documentação pendente</div>
        {snap.pendencias.length === 0 ? <p className="px-4 py-4 text-sm text-muted">Nenhum cliente com documentação pendente.</p> : (
          <ul className="divide-y divide-line">
            {snap.pendencias.map((c) => {
              const d = c.prazo_documentacao ? diasAte(c.prazo_documentacao) : null;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => irPara("scanner", { cliente: c.id })} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                    <span className={`mt-0.5 rounded-lg px-2 py-1 text-xs font-bold ${d != null && d <= 3 ? "bg-red-100 text-red-700" : d != null && d <= 7 ? "bg-amber-100 text-amber-800" : "bg-surface-2"}`}>{d != null ? (d > 0 ? `${d}d` : "hoje") : "—"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.nome}</span>
                      <span className="block truncate text-xs text-muted">{c.faltando?.length ? `Falta: ${c.faltando.join(", ")}` : c.cidade ?? ""}</span>
                    </span>
                    <Camera className="h-4 w-4 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-muted"><Users className="h-3.5 w-3.5" /> Ao fim do prazo o cliente vai para a base administrativa.</p>
      </section>
      <p className="text-center text-[11px] text-muted">Dados de {new Date(snap.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
    </div>
  );
}
