/**
 * White-label: gera a paleta da cor principal (50–950) a partir de uma cor da empresa, misturando com branco
 * (tons claros) e preto (tons escuros). Os valores vão para as variáveis CSS --brand-* (formato "r g b").
 */
const TONS: [number, number][] = [[50, 0.94], [100, 0.88], [200, 0.74], [300, 0.56], [400, 0.3], [500, 0], [600, -0.18], [700, -0.34], [800, -0.48], [900, -0.6], [950, -0.72]];

export const corValida = (hex: unknown): hex is string => typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex);

export function paleta(hex: string): Record<number, string> {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Object.fromEntries(TONS.map(([tom, f]) => [tom, rgb.map((c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f))).join(" ")]));
}

/** CSS para sobrescrever a cor da marca (vazio se a cor não for válida). */
export function cssMarca(hex: unknown) {
  if (!corValida(hex)) return "";
  return `:root{${Object.entries(paleta(hex)).map(([t, v]) => `--brand-${t}:${v};`).join("")}}`;
}
