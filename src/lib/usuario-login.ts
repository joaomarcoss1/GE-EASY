/**
 * Login por nome de usuário (sem e-mail). A conta recebe um e-mail técnico em domínio reservado (.invalid),
 * que nunca recebe mensagens: a troca de senha dessas contas é feita pela gestão.
 */
export const DOMINIO_USUARIO = "usuarios.geeasy.invalid";
export const USUARIO_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;

/** "José da Silva" → "jose.da.silva" (minúsculas, sem acento, só letras, números, ponto e sublinhado). */
export function normalizarUsuario(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 30);
}

/** Sugestão de usuário a partir do nome: primeiro e último nome. */
export function sugerirUsuario(nome: string): string {
  const partes = normalizarUsuario(nome).split(".").filter(Boolean);
  if (!partes.length) return "";
  return partes.length === 1 ? partes[0] : `${partes[0]}.${partes[partes.length - 1]}`;
}

export const emailTecnico = (usuario: string) => `${usuario}@${DOMINIO_USUARIO}`;
export const ehEmailTecnico = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${DOMINIO_USUARIO}`);
