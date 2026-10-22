export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Domínio raiz das empresas (<slug>.dominio). Vazio: escolha da empresa após o login. */
  rootDomain: (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "").toLowerCase(),
};

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    encryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  };
}

export const googleConfigured = () => {
  const e = serverEnv();
  return Boolean(e.googleClientId && e.googleClientSecret && e.serviceRoleKey && e.encryptionKey);
};
