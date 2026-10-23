import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { emailConfigurado, enviarEmail, escapar } from "@/lib/integracoes/email";

const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Envia por e-mail o resumo dos relatórios mensais recém-gerados (só números agregados e o link; o relatório
 * completo abre no sistema, com login e permissão). Destinatários: configurados pela empresa ou os admins master.
 */
export async function enviarRelatoriosMensais(admin: SupabaseClient) {
  const r = { enviados: 0, sem_destinatario: 0, falhas: 0 };
  if (!emailConfigurado()) return r;
  const { data: rels } = await admin.from("relatorios_mensais").select("id, empresa_id, competencia, dados, empresas(nome)")
    .is("email_enviado_em", null).gt("gerado_em", new Date(Date.now() - 7 * 86400_000).toISOString()).limit(20);
  for (const rel of (rels ?? []) as unknown as { id: string; empresa_id: string; competencia: string; dados: { indicadores?: Record<string, number>; atencao?: { texto: string }[]; gastos?: { financeiro_total?: number } }; empresas: { nome: string } }[]) {
    const { data: cfg } = await admin.from("configuracoes").select("valor").eq("empresa_id", rel.empresa_id).eq("chave", "relatorios").maybeSingle();
    let para = (((cfg?.valor as { destinatarios?: string[] } | null)?.destinatarios) ?? []).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!para.length) {
      const { data: masters } = await admin.from("empresa_membros").select("profiles(email)").eq("empresa_id", rel.empresa_id).eq("ativo", true).eq("admin_master", true);
      para = (masters ?? []).map((m) => (m.profiles as unknown as { email: string } | null)?.email).filter(Boolean) as string[];
    }
    if (!para.length) {
      r.sem_destinatario++;
      continue;
    }
    const d = rel.dados;
    const i = d.indicadores ?? {};
    const mes = `${rel.competencia.slice(5, 7)}/${rel.competencia.slice(0, 4)}`;
    const atencao = (d.atencao ?? []).map((a) => `<li>${escapar(a.texto)}</li>`).join("");
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">${escapar(rel.empresas.nome)} — fechamento de ${mes}</h2>
      <p style="color:#555">Resumo automático do GE EASY.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td>Clientes novos</td><td align="right"><b>${Number(i.clientes_novos ?? 0)}</b></td></tr>
        <tr><td>Vendas aprovadas</td><td align="right"><b>${Number(i.vendas_aprovadas ?? 0)}</b> (${brl(i.valor_vendas)})</td></tr>
        <tr><td>Rotas / check-ins</td><td align="right"><b>${Number(i.rotas ?? 0)}</b> / ${Number(i.checkins ?? 0)}</td></tr>
        <tr><td>Km rodados</td><td align="right">${Number(i.km ?? 0).toFixed(1)}</td></tr>
        <tr><td>Custo de campo</td><td align="right">${brl(i.custo_rotas)}</td></tr>
        <tr><td>Despesas do mês</td><td align="right">${brl(d.gastos?.financeiro_total)}</td></tr>
        <tr><td>Conversas de WhatsApp</td><td align="right">${Number(i.wa_conversas ?? 0)}</td></tr>
        <tr><td>Transferências (45 dias)</td><td align="right">${Number(i.transferidos_45 ?? 0)}</td></tr>
      </table>
      ${atencao ? `<h3>Pontos de atenção</h3><ul>${atencao}</ul>` : ""}
      <p><a href="${env.siteUrl}/relatorios/mensal?c=${rel.id}" style="background:#1d3b6e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir o relatório completo</a></p>
    </div>`;
    try {
      await enviarEmail(para, `Relatório mensal ${mes} — ${rel.empresas.nome}`, html);
      await admin.from("relatorios_mensais").update({ email_enviado_em: new Date().toISOString() }).eq("id", rel.id);
      r.enviados++;
    } catch {
      r.falhas++;
    }
  }
  return r;
}
