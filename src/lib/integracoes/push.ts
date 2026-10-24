import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

/**
 * Notificações push (Web Push/VAPID) do app de campo, a partir das notificações do sistema.
 * Sem as chaves VAPID configuradas, as notificações continuam só dentro do sistema.
 */
const pushConfigurado = () => Boolean(env.vapidPublicKey && serverEnv().vapidPrivateKey);

export async function enviarPushPendentes(admin: SupabaseClient, ate: number): Promise<{ enviadas: number; falhas: number; sem_aparelho: number }> {
  const r = { enviadas: 0, falhas: 0, sem_aparelho: 0 };
  if (!pushConfigurado()) return r;
  const { vapidPrivateKey, vapidSubject } = serverEnv();
  webpush.setVapidDetails(vapidSubject, env.vapidPublicKey, vapidPrivateKey);

  const { data: notas } = await admin
    .from("notificacoes")
    .select("id, empresa_id, user_id, titulo, mensagem, link, push_tentativas")
    .is("push_enviado_em", null)
    .lt("push_tentativas", 3)
    .gt("created_at", new Date(Date.now() - 86400_000).toISOString())
    .order("created_at")
    .limit(300);
  if (!notas?.length) return r;
  const usuarios = [...new Set(notas.map((n) => n.user_id as string))];
  const { data: assinaturas } = await admin.from("push_assinaturas").select("id, empresa_id, user_id, endpoint, p256dh, auth, falhas").in("user_id", usuarios).eq("ativo", true);
  for (const n of notas) {
    if (Date.now() > ate) break;
    // só os aparelhos do usuário NA MESMA empresa da notificação (isolamento entre empresas)
    const alvos = (assinaturas ?? []).filter((a) => a.user_id === n.user_id && (!n.empresa_id || a.empresa_id === n.empresa_id));
    if (!alvos.length) {
      r.sem_aparelho++;
      await admin.from("notificacoes").update({ push_enviado_em: new Date().toISOString() }).eq("id", n.id);
      continue;
    }
    let algum = false;
    for (const a of alvos) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify({ titulo: n.titulo, mensagem: n.mensagem ?? "", link: n.link ?? "/campo", tag: n.id }),
          { TTL: 3600, urgency: "normal" },
        );
        algum = true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: assinatura expirada ou removida no aparelho
        await admin.from("push_assinaturas").update(status === 404 || status === 410 ? { ativo: false } : { falhas: (a.falhas ?? 0) + 1 }).eq("id", a.id);
      }
    }
    if (algum) r.enviadas++;
    else r.falhas++;
    await admin.from("notificacoes").update(algum ? { push_enviado_em: new Date().toISOString() } : { push_tentativas: (n.push_tentativas ?? 0) + 1 }).eq("id", n.id);
  }
  return r;
}
