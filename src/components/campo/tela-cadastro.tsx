"use client";
import { useRef, useState } from "react";
import { Camera, Loader2, ScanText, ShieldCheck } from "lucide-react";
import { carregarImagem, paraJpeg } from "@/lib/campo/imagem";
import { isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { useCampo } from "./contexto";
import { posicaoAtual } from "./tipos";

/**
 * Pré-cadastro rápido (funciona offline): nome, telefone/WhatsApp, CPF validado, cidade, interesse e o
 * consentimento LGPD com data, hora, versão do termo e localização. A duplicidade é checada ao sincronizar.
 */
export function TelaCadastro() {
  const { snap, registrar, aviso, irPara, online } = useCampo();
  const [f, setF] = useState({ nome: "", telefone: "", documento: "", cidade: "", uf: "", interesse: "", observacoes: "" });
  const [aceito, setAceito] = useState(false);
  const [verTermo, setVerTermo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [salvo, setSalvo] = useState<{ id: string; nome: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const cpf = onlyDigits(f.documento);
  const cpfInvalido = cpf.length > 0 && (cpf.length !== 11 || !isValidCPF(cpf));

  const salvar = async () => {
    if (f.nome.trim().length < 2) return aviso("Informe o nome.", "erro");
    if (!onlyDigits(f.telefone) && !cpf) return aviso("Informe o telefone ou o CPF.", "erro");
    if (cpfInvalido) return aviso("CPF inválido.", "erro");
    if (!aceito) return aviso("O cliente precisa aceitar o termo de consentimento (LGPD).", "erro");
    setOcupado(true);
    try {
      const pos = await posicaoAtual(10000).catch(() => null);
      const id = crypto.randomUUID();
      await registrar("pre_cadastro", {
        id, nome: f.nome.trim(), telefone: onlyDigits(f.telefone) || null, documento: cpf || null, cidade: f.cidade.trim() || null, uf: f.uf.trim().toUpperCase() || null,
        interesse: f.interesse.trim() || null, observacoes: f.observacoes.trim() || null, lat: pos?.lat ?? null, lng: pos?.lng ?? null,
        consentimento: { aceito: true, em: new Date().toISOString(), versao: snap.termo_lgpd.versao },
      }, `Pré-cadastro: ${f.nome.trim().split(" ")[0]}`);
      setSalvo({ id, nome: f.nome.trim() });
      setF({ nome: "", telefone: "", documento: "", cidade: "", uf: "", interesse: "", observacoes: "" });
      setAceito(false);
    } finally {
      setOcupado(false);
    }
  };

  if (salvo) {
    return (
      <div className="card space-y-4 p-5 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-emerald-600" />
        <p className="font-semibold">Pré-cadastro de {salvo.nome} salvo</p>
        <p className="text-sm text-muted">Será enviado assim que houver internet. Se o CPF já existir na empresa, você será avisado.</p>
        <button type="button" onClick={() => irPara("scanner", { cliente: salvo.id, nome: salvo.nome })} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 font-semibold text-white"><Camera className="h-5 w-5" /> Escanear documentos</button>
        <button type="button" onClick={() => setSalvo(null)} className="w-full rounded-xl border border-line py-3 font-semibold">Novo pré-cadastro</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Pré-cadastro</h1>
        {online && <LerDocumento onDados={(d) => setF((x) => ({ ...x, nome: x.nome || (d.nome ?? ""), documento: x.documento || (d.cpf ?? "") }))} />}
      </div>
      <input className="input" placeholder="Nome completo *" value={f.nome} onChange={set("nome")} autoComplete="off" />
      <input className="input" placeholder="Telefone / WhatsApp" inputMode="tel" value={f.telefone} onChange={set("telefone")} />
      <input className="input" placeholder="CPF" inputMode="numeric" value={f.documento} onChange={set("documento")} aria-invalid={cpfInvalido} />
      {cpfInvalido && <p className="text-xs text-red-600">CPF inválido.</p>}
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <input className="input" placeholder="Cidade" value={f.cidade} onChange={set("cidade")} />
        <input className="input" placeholder="UF" maxLength={2} value={f.uf} onChange={set("uf")} />
      </div>
      <input className="input" placeholder="Interesse / produto" value={f.interesse} onChange={set("interesse")} />
      <textarea className="input" rows={2} placeholder="Observações" value={f.observacoes} onChange={set("observacoes")} />
      <div className="rounded-xl border border-line p-3">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-700" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
          <span>O cliente leu e aceitou o termo de consentimento (versão {snap.termo_lgpd.versao}). <button type="button" className="font-semibold text-brand-700" onClick={() => setVerTermo(!verTermo)}>{verTermo ? "ocultar" : "ler termo"}</button></span>
        </label>
        {verTermo && <p className="mt-2 text-xs text-muted">{snap.termo_lgpd.texto}</p>}
        <p className="mt-2 text-[11px] text-muted">Ficam registrados a data, a hora, a versão do termo e a localização do aceite.</p>
      </div>
      <button type="button" disabled={ocupado} onClick={salvar} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3.5 text-base font-bold text-white">{ocupado && <Loader2 className="h-5 w-5 animate-spin" />}Salvar pré-cadastro</button>
    </div>
  );
}

/** Leitura automática do documento (OCR, se a empresa ativou): preenche nome e CPF. Precisa de internet. */
function LerDocumento({ onDados }: { onDados: (d: { nome: string | null; cpf: string | null }) => void }) {
  const { aviso } = useCampo();
  const ref = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setOcupado(true);
          try {
            const { blob } = await paraJpeg(await carregarImagem(f), 3_500_000);
            const fd = new FormData();
            fd.append("imagem", blob, "documento.jpg");
            const r = await fetch("/api/campo/ocr", { method: "POST", body: fd });
            const j = (await r.json().catch(() => ({}))) as { dados?: { nome: string | null; cpf: string | null }; mensagem?: string };
            if (!r.ok || !j.dados) return aviso(j.mensagem ?? "Não foi possível ler o documento.", "erro");
            onDados(j.dados);
            aviso(j.dados.cpf || j.dados.nome ? "Dados lidos do documento. Confira antes de salvar." : "Não encontrei os dados. Preencha à mão.", j.dados.cpf || j.dados.nome ? "ok" : "erro");
          } finally {
            setOcupado(false);
          }
        }}
      />
      <button type="button" disabled={ocupado} onClick={() => ref.current?.click()} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold">
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />} Ler documento
      </button>
    </>
  );
}
