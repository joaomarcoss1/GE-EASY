export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Domínio raiz das empresas (<slug>.dominio). Vazio: escolha da empresa após o login. */
  rootDomain: (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "").toLowerCase(),
  /** Chave pública VAPID (notificações push do app de campo) */
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  /** Cloudflare Turnstile (anti-robô do formulário público de leads); vazio = só limite por IP + campo isca */
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
};

/**
 * Segredos do servidor. Integrações externas são opcionais: sem a chave, o sistema usa a alternativa
 * descrita em cada módulo (distância em linha reta, notificação só no sistema, sem OCR, etc.).
 */
export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    encryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
    googleVisionKey: process.env.GOOGLE_VISION_API_KEY ?? "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:suporte@geeasy.com.br",
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    metaGraphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
    turnstileSecret: process.env.TURNSTILE_SECRET_KEY ?? "",
    asaasApiKey: process.env.ASAAS_API_KEY ?? "",
    asaasApiUrl: (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/$/, ""),
    asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
    vercelApiToken: process.env.VERCEL_API_TOKEN ?? "",
    vercelProjectId: process.env.VERCEL_PROJECT_ID ?? "",
    vercelTeamId: process.env.VERCEL_TEAM_ID ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    emailFrom: process.env.EMAIL_FROM ?? "GE EASY <nao-responda@geeasy.com.br>",
  };
}

export const googleConfigured = () => {
  const e = serverEnv();
  return Boolean(e.googleClientId && e.googleClientSecret && e.serviceRoleKey && e.encryptionKey);
};
