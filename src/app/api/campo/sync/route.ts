import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession, getSituacao2fa } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/lib/rbac";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { CHECKIN_RESULTADOS, DESPESA_TIPOS } from "@/lib/constants";

/**
 * Sincronização do app de campo (fila offline). Uma requisição por item, idempotente pelo UUID gerado no
 * aparelho. Antes de tudo confere o aparelho: revogado => 410 e o app apaga os dados locais.
 * Respostas: { status: "ok" | "duplicado" | "rejeitado", mensagem, dados } — "rejeitado" é definitivo
 * (sai da fila com o motivo); erro 5xx = tentar de novo depois.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_ARQUIVO = 10 * 1024 * 1024;
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const txt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const metaSchema = z.object({
  dispositivo: z.object({ id: UUID, nome: z.string().max(200), plataforma: z.string().max(120), versao: z.string().max(30), fila: z.number().int().min(0).max(100000) }),
  item: z.object({ id: UUID, tipo: z.string().max(30), payload: z.record(z.unknown()) }).nullable(),
});

type Resposta = { status: "ok" | "duplicado" | "rejeitado"; mensagem: string; dados?: Record<string, unknown> };
const resp = (r: Resposta, http = 200) => NextResponse.json(r, { status: http });
const rejeitado = (mensagem: string) => resp({ status: "rejeitado", mensagem });

type Db = Awaited<ReturnType<typeof createClient>>;

async function arquivoValido(f: FormDataEntryValue | null, tipos: string[]): Promise<{ bytes: Uint8Array; mime: string } | string | null> {
  if (!f || typeof f === "string") return null;
  if (f.size > MAX_ARQUIVO) return "Arquivo maior que 10 MB.";
  const mime = f.type;
  if (!tipos.includes(mime)) return "Tipo de arquivo não permitido.";
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!detectarTipoArquivo(bytes, mime)) return "O conteúdo do arquivo não confere com o tipo informado.";
  return { bytes, mime };
}

/** Envia ao Storage (com a sessão do usuário: as políticas do bucket conferem o caminho). Já existente = ok. */
async function subir(db: Db, caminho: string, arq: { bytes: Uint8Array; mime: string }) {
  const { error } = await db.storage.from("documentos").upload(caminho, arq.bytes, { contentType: arq.mime, upsert: false });
  if (error && !/exist|duplicate/i.test(error.message)) throw new Error(error.message);
}

const msgDb = (e: { code?: string; message?: string }) => (e.message && (e.code === "P0001" || e.code === "23514" || e.code === "42501") ? e.message : "Não foi possível registrar.");

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ mensagem: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (!session.empresa || !session.profile.active) return NextResponse.json({ revogado: true, mensagem: "Sem acesso à empresa." }, { status: 410 });
  if ((await getSituacao2fa(session.profile)).bloqueado) return NextResponse.json({ mensagem: "Confirme o segundo fator para sincronizar." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const metaTxt = form?.get("meta");
  if (typeof metaTxt !== "string" || metaTxt.length > 200_000) return rejeitado("Pacote inválido.");
  const parsed = metaSchema.safeParse(JSON.parse(metaTxt));
  if (!parsed.success) return rejeitado("Pacote inválido.");
  const { dispositivo, item } = parsed.data;

  const db = await createClient({ origem: "app", requestId: `disp:${dispositivo.id}${item ? `:${item.id}` : ""}` });
  const { data: disp } = await db.rpc("sincronizar_dispositivo", { p_id: dispositivo.id, p_nome: dispositivo.nome, p_plataforma: dispositivo.plataforma, p_versao: dispositivo.versao, p_fila: dispositivo.fila });
  if ((disp as { revogado?: boolean } | null)?.revogado !== false) return NextResponse.json({ revogado: true, mensagem: "Aparelho revogado." }, { status: 410 });
  if (!item) return resp({ status: "ok", mensagem: "Aparelho sincronizado.", dados: { versao_minima: (disp as { versao_minima?: string }).versao_minima ?? null } });

  const exigir = (p: Permission) => can(session.profile, p);
  const empresa = session.empresa.id;
  const p = item.payload;

  try {
    switch (item.tipo) {
      // ------------------------------------------------------------ pré-cadastro (com consentimento LGPD)
      case "pre_cadastro": {
        if (!exigir("clientes.write")) return rejeitado("Sem permissão para cadastrar clientes.");
        const v = z.object({
          nome: z.string().trim().min(2).max(200), documento: txt(20), telefone: txt(20), cidade: txt(120), uf: txt(2), interesse: txt(500), observacoes: txt(2000),
          lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
          consentimento: z.object({ aceito: z.literal(true), em: z.string().datetime({ offset: true }), versao: z.string().max(30) }),
        }).safeParse(p);
        if (!v.success) return rejeitado(v.error.issues[0]?.path.join(".") === "consentimento.aceito" ? "Sem o consentimento LGPD o cadastro não é enviado." : "Dados do pré-cadastro inválidos.");
        const d = v.data;
        const { data: existe } = await db.from("clientes").select("id").eq("id", item.id).maybeSingle();
        if (existe) return resp({ status: "ok", mensagem: "Já sincronizado.", dados: { cliente_id: item.id } });
        const doc = d.documento ? onlyDigits(d.documento) : null;
        if (doc && !isValidCPF(doc)) return rejeitado("CPF inválido.");
        if (doc) {
          const { data: dup } = await db.rpc("verificar_documento_cliente", { p_documento: doc });
          const j = dup as { existe?: boolean; acessivel?: boolean; cliente_id?: string; carteira?: string } | null;
          if (j?.existe) {
            return resp({
              status: "duplicado",
              mensagem: j.acessivel ? "Cliente já cadastrado na sua carteira." : `Cliente já existe na carteira ${j.carteira === "administrativo" ? "administrativa" : j.carteira === "juridico" ? "jurídica" : "de outro consultor"}. Peça a transferência ao gestor.`,
              dados: { cliente_id: j.acessivel ? j.cliente_id : null, documento: doc },
            });
          }
        }
        const { error } = await db.from("clientes").insert({
          id: item.id, nome: d.nome, documento: doc, telefone: d.telefone, whatsapp: d.telefone, cidade: d.cidade, uf: d.uf?.toUpperCase() ?? null,
          observacoes: [d.interesse ? `Interesse: ${d.interesse}` : null, d.observacoes].filter(Boolean).join("\n") || null,
          origem: "consultor_app", status_cadastro: "pre_cadastro", latitude: d.lat ?? null, longitude: d.lng ?? null,
          lgpd_consentimento_em: d.consentimento.em, lgpd_termo_versao: d.consentimento.versao,
          lgpd_consentimento_origem: { canal: "app_campo", dispositivo: dispositivo.id, lat: d.lat ?? null, lng: d.lng ?? null },
        });
        if (error) return error.code === "23505" ? resp({ status: "duplicado", mensagem: "Cliente já cadastrado (CPF)." }) : rejeitado(msgDb(error));
        return resp({ status: "ok", mensagem: "Pré-cadastro enviado.", dados: { cliente_id: item.id } });
      }

      // ------------------------------------------------------------ documento escaneado
      case "documento": {
        if (!exigir("clientes.write")) return rejeitado("Sem permissão para enviar documentos.");
        const v = z.object({ cliente_id: UUID, categoria: z.string().trim().min(2).max(60), nome: z.string().trim().min(1).max(200) }).safeParse(p);
        if (!v.success) return rejeitado("Dados do documento inválidos.");
        const { data: existe } = await db.from("documentos").select("id").eq("id", item.id).maybeSingle();
        if (existe) return resp({ status: "ok", mensagem: "Já sincronizado." });
        const arq = await arquivoValido(form!.get("arquivo"), ["application/pdf", "image/jpeg"]);
        if (!arq) return rejeitado("Arquivo ausente.");
        if (typeof arq === "string") return rejeitado(arq);
        const { data: cli } = await db.from("clientes").select("id").eq("id", v.data.cliente_id).maybeSingle();
        if (!cli) return rejeitado("Cliente não encontrado (ou fora da sua carteira).");
        const caminho = `empresas/${empresa}/clientes/${v.data.cliente_id}/${item.id}.${arq.mime === "application/pdf" ? "pdf" : "jpg"}`;
        await subir(db, caminho, arq);
        const { error } = await db.from("documentos").insert({
          id: item.id, cliente_id: v.data.cliente_id, nome: v.data.nome, categoria: v.data.categoria, storage_path: caminho, mime_type: arq.mime, tamanho: arq.bytes.length, enviado_por: session.userId,
        });
        if (error && error.code !== "23505") return rejeitado(msgDb(error));
        return resp({ status: "ok", mensagem: "Documento enviado para análise." });
      }

      // ------------------------------------------------------------ rota
      case "iniciar_rota": {
        if (!exigir("rotas.executar")) return rejeitado("Sem permissão para executar rotas.");
        const v = z.object({ rota_id: UUID, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), hodometro: z.number().int().min(0).max(9_999_999).nullish() }).safeParse(p);
        if (!v.success) return rejeitado("Dados de início inválidos.");
        let foto: string | null = null;
        const arq = await arquivoValido(form!.get("foto"), ["image/jpeg"]);
        if (typeof arq === "string") return rejeitado(arq);
        if (arq) { foto = `empresas/${empresa}/rotas/${v.data.rota_id}/${item.id}-hodometro.jpg`; await subir(db, foto, arq); }
        const { error } = await db.rpc("iniciar_rota", { p_rota: v.data.rota_id, p_lat: v.data.lat, p_lng: v.data.lng, p_hodometro: v.data.hodometro ?? null, p_foto: foto });
        if (error) {
          const { data: r } = await db.from("rotas").select("status, consultor_id").eq("id", v.data.rota_id).maybeSingle();
          if (r && r.consultor_id === session.userId && r.status !== "planejada") return resp({ status: "ok", mensagem: "Rota já iniciada." });
          return rejeitado(msgDb(error));
        }
        return resp({ status: "ok", mensagem: "Rota iniciada." });
      }
      case "checkin": {
        if (!exigir("rotas.executar")) return rejeitado("Sem permissão para check-in.");
        const v = z.object({
          rota_id: UUID, parada_id: UUID, tipo: z.enum(["chegada", "saida"]), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
          precisao: z.number().min(0).max(100000).nullish(), dispositivo_em: z.string().datetime({ offset: true }).nullish(),
          resultado: z.string().refine((r) => CHECKIN_RESULTADOS.some((o) => o.value === r)).nullish(), observacao: txt(2000), justificativa: txt(500), mock: z.boolean().optional(),
        }).safeParse(p);
        if (!v.success) return rejeitado("Dados do check-in inválidos.");
        const d = v.data;
        let foto: string | null = null;
        const arq = await arquivoValido(form!.get("foto"), ["image/jpeg"]);
        if (typeof arq === "string") return rejeitado(arq);
        if (arq) { foto = `empresas/${empresa}/rotas/${d.rota_id}/${item.id}.jpg`; await subir(db, foto, arq); }
        const { data, error } = await db.rpc("registrar_checkin", {
          p_id: item.id, p_parada: d.parada_id, p_tipo: d.tipo, p_lat: d.lat, p_lng: d.lng, p_precisao: d.precisao ?? null, p_dispositivo_em: d.dispositivo_em ?? null,
          p_resultado: d.resultado ?? null, p_observacao: d.observacao, p_justificativa: d.justificativa, p_mock: d.mock ?? false, p_foto: foto, p_dispositivo: dispositivo.id,
        });
        if (error) return rejeitado(msgDb(error));
        const r = data as { dentro_do_raio?: boolean | null; distancia_m?: number | null; flags?: string[] };
        return resp({ status: "ok", mensagem: r.dentro_do_raio === false ? `Registrado fora do raio (${r.distancia_m} m), para revisão.` : "Check-in registrado.", dados: r });
      }
      case "finalizar_rota": {
        if (!exigir("rotas.executar")) return rejeitado("Sem permissão para executar rotas.");
        const v = z.object({
          rota_id: UUID, lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(), hodometro: z.number().int().min(0).max(9_999_999).nullish(),
          nao_realizadas: z.array(z.object({ parada_id: UUID, motivo: z.string().trim().min(2).max(500) })).max(500).default([]),
        }).safeParse(p);
        if (!v.success) return rejeitado("Dados de encerramento inválidos.");
        let foto: string | null = null;
        const arq = await arquivoValido(form!.get("foto"), ["image/jpeg"]);
        if (typeof arq === "string") return rejeitado(arq);
        if (arq) { foto = `empresas/${empresa}/rotas/${v.data.rota_id}/${item.id}-hodometro.jpg`; await subir(db, foto, arq); }
        const { data, error } = await db.rpc("finalizar_rota", { p_rota: v.data.rota_id, p_lat: v.data.lat ?? null, p_lng: v.data.lng ?? null, p_hodometro: v.data.hodometro ?? null, p_foto: foto, p_nao_realizadas: v.data.nao_realizadas });
        if (error) {
          const { data: r } = await db.from("rotas").select("status, consultor_id").eq("id", v.data.rota_id).maybeSingle();
          if (r && r.consultor_id === session.userId && (r.status === "concluida" || r.status === "aprovada")) return resp({ status: "ok", mensagem: "Rota já finalizada." });
          return rejeitado(msgDb(error));
        }
        return resp({ status: "ok", mensagem: "Rota finalizada e enviada para aprovação.", dados: data as Record<string, unknown> });
      }

      // ------------------------------------------------------------ despesa com comprovante
      case "despesa": {
        if (!exigir("despesas.lancar")) return rejeitado("Sem permissão para lançar despesas.");
        const v = z.object({
          rota_id: UUID.nullish(), tipo: z.string().refine((t) => DESPESA_TIPOS.some((o) => o.value === t)), valor: z.number().positive().max(99999),
          data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), descricao: txt(500), hodometro: z.number().int().min(0).max(9_999_999).nullish(),
        }).safeParse(p);
        if (!v.success) return rejeitado("Dados da despesa inválidos.");
        const { data: existe } = await db.from("despesas_rota").select("id").eq("id", item.id).maybeSingle();
        if (existe) return resp({ status: "ok", mensagem: "Já sincronizado." });
        let comprovante: string | null = null;
        const arq = await arquivoValido(form!.get("comprovante"), ["image/jpeg", "application/pdf"]);
        if (typeof arq === "string") return rejeitado(arq);
        if (arq) { comprovante = `empresas/${empresa}/despesas/${session.userId}/${item.id}.${arq.mime === "application/pdf" ? "pdf" : "jpg"}`; await subir(db, comprovante, arq); }
        const { error } = await db.from("despesas_rota").insert({
          id: item.id, rota_id: v.data.rota_id ?? null, consultor_id: session.userId, tipo: v.data.tipo, valor: Math.round(v.data.valor * 100) / 100,
          data: v.data.data, descricao: v.data.descricao, hodometro: v.data.hodometro ?? null, comprovante_path: comprovante,
        });
        if (error && error.code !== "23505") return rejeitado(msgDb(error));
        return resp({ status: "ok", mensagem: "Despesa enviada para aprovação." });
      }

      // ------------------------------------------------------------ ponto (fase 7)
      case "ponto": {
        if (!exigir("ponto.registrar")) return rejeitado("Sem permissão para registrar ponto.");
        const v = z.object({
          tipo: z.enum(["entrada", "intervalo_inicio", "intervalo_fim", "saida"]), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
          precisao: z.number().min(0).max(100000).nullish(), dispositivo_em: z.string().datetime({ offset: true }),
        }).safeParse(p);
        if (!v.success) return rejeitado("Marcação inválida.");
        const { data, error } = await db.rpc("registrar_ponto", {
          p_id: item.id, p_tipo: v.data.tipo, p_lat: v.data.lat ?? null, p_lng: v.data.lng ?? null, p_precisao: v.data.precisao ?? null,
          p_dispositivo_em: v.data.dispositivo_em, p_dispositivo: dispositivo.id, p_offline: true,
        });
        if (error) return rejeitado(msgDb(error));
        return resp({ status: "ok", mensagem: "Marcação de ponto registrada.", dados: data as Record<string, unknown> });
      }
      default:
        return rejeitado("Tipo de registro desconhecido.");
    }
  } catch (e) {
    console.error("[campo/sync]", item.tipo, e instanceof Error ? e.message : e);
    return NextResponse.json({ mensagem: "Falha temporária. O app tenta de novo." }, { status: 503 });
  }
}
