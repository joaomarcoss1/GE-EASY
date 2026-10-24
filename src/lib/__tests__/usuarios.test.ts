import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Criação de acesso direto no sistema (sem e-mail) e definição de senha pelo administrador:
 * perfil permitido e perfil negado. Supabase e sessão são simulados.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Res = { maybeSingle?: unknown; insert?: unknown; list?: unknown };
let respostas: Record<string, Res> = {};
const chamadas: { tabela: string; metodo: string; args: unknown[] }[] = [];

function tabela(nome: string) {
  const res = respostas[nome] ?? {};
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "limit", "order", "update", "upsert"]) {
    b[m] = (...args: unknown[]) => {
      chamadas.push({ tabela: nome, metodo: m, args });
      return b;
    };
  }
  b.insert = (...args: unknown[]) => {
    chamadas.push({ tabela: nome, metodo: "insert", args });
    return Promise.resolve(res.insert ?? { error: null });
  };
  b.maybeSingle = () => Promise.resolve(res.maybeSingle ?? { data: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(res.list ?? { data: [], error: null }).then(ok);
  return b;
}

const authAdmin = {
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUserById: vi.fn(),
};
vi.mock("@/lib/supabase/admin", () => ({
  hasServiceRole: () => true,
  createAdminClient: () => ({ from: tabela, auth: { admin: authAdmin } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: tabela, rpc: vi.fn(async () => ({ error: null })) }),
}));

let sessao: unknown = null;
vi.mock("@/lib/auth", () => ({
  getSession: async () => sessao,
  getSituacao2fa: async () => ({ verificar: false, cadastrar: false, bloqueado: false }),
}));

const EMPRESA = "00000000-0000-4000-8000-0000000000e1";
const ALVO = "00000000-0000-4000-8000-0000000000a1";
const SENHA = "SenhaForte123";

function comoUsuario(permissoes: string[], adminMaster = false) {
  sessao = {
    userId: "00000000-0000-4000-8000-0000000000b1",
    email: "gestor@exemplo.test",
    profile: { id: "00000000-0000-4000-8000-0000000000b1", role: "gestor", active: true, admin_master: adminMaster, permissoes },
    empresa: { id: EMPRESA, nome: "Empresa Teste", slug: "teste" },
    empresas: [],
    areas: [],
    areaAtiva: null,
    plataformaAdmin: false,
    trocarSenha: false,
  };
}

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(v).forEach(([k, x]) => fd.set(k, x));
  return fd;
};
const novo = (extra: Record<string, string> = {}) =>
  form({ email: "nova.pessoa@exemplo.test", full_name: "Pessoa Sintética", senha: SENHA, confirmar: SENHA, trocar_senha: "on", role: "administrativo", ...extra });

beforeEach(() => {
  respostas = {};
  chamadas.length = 0;
  vi.clearAllMocks();
  authAdmin.createUser.mockResolvedValue({ data: { user: { id: ALVO } }, error: null });
  authAdmin.deleteUser.mockResolvedValue({ error: null });
  authAdmin.updateUserById.mockResolvedValue({ error: null });
});

describe("criar usuário no sistema", () => {
  it("nega sem a permissão de gerir usuários", async () => {
    comoUsuario([]);
    const { criarUsuario } = await import("../actions/usuarios");
    const r = await criarUsuario({}, novo());
    expect(r.error).toMatch(/permissão/);
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("nega perfil de gestão para quem não é administrador master", async () => {
    comoUsuario(["usuarios.manage"]);
    const { criarUsuario } = await import("../actions/usuarios");
    const r = await criarUsuario({}, novo({ role: "gestor" }));
    expect(r.fieldErrors?.role).toBeTruthy();
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("rejeita senha fraca ou que não confere", async () => {
    comoUsuario(["usuarios.manage"]);
    const { criarUsuario } = await import("../actions/usuarios");
    expect((await criarUsuario({}, novo({ senha: "fraca", confirmar: "fraca" }))).fieldErrors?.senha).toBeTruthy();
    expect((await criarUsuario({}, novo({ confirmar: SENHA + "x" }))).fieldErrors?.confirmar).toBeTruthy();
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("cria a conta confirmada com a senha, marca a troca e vincula à empresa", async () => {
    comoUsuario(["usuarios.manage"]);
    const { criarUsuario } = await import("../actions/usuarios");
    const r = await criarUsuario({}, novo());
    expect(r.ok).toBe(true);
    expect(authAdmin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "nova.pessoa@exemplo.test", password: SENHA, email_confirm: true, app_metadata: { trocar_senha: true } }),
    );
    const vinculo = chamadas.find((c) => c.tabela === "empresa_membros" && c.metodo === "insert");
    expect(vinculo?.args[0]).toMatchObject({ empresa_id: EMPRESA, user_id: ALVO, role: "administrativo", ativo: true, admin_master: false });
  });

  it("desfaz a conta nova se o vínculo falhar", async () => {
    comoUsuario(["usuarios.manage"]);
    respostas.empresa_membros = { insert: { error: { code: "P0001", message: "Limite de usuários do plano atingido" } } };
    const { criarUsuario } = await import("../actions/usuarios");
    const r = await criarUsuario({}, novo());
    expect(r.error).toMatch(/Limite de usuários/);
    expect(authAdmin.deleteUser).toHaveBeenCalledWith(ALVO);
  });

  it("conta já existente: só vincula e não troca a senha", async () => {
    comoUsuario(["usuarios.manage"]);
    respostas.profiles = { maybeSingle: { data: { id: ALVO } } };
    const { criarUsuario } = await import("../actions/usuarios");
    const r = await criarUsuario({}, novo({ senha: "", confirmar: "" }));
    expect(r.ok).toBe(true);
    expect(authAdmin.createUser).not.toHaveBeenCalled();
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });
});

describe("definir senha de um membro", () => {
  const pedido = () => form({ id: ALVO, senha: SENHA, confirmar: SENHA, trocar_senha: "on" });

  it("nega sem a permissão de gerir usuários", async () => {
    comoUsuario([]);
    const { definirSenhaUsuario } = await import("../actions/usuarios");
    expect((await definirSenhaUsuario({}, pedido())).error).toMatch(/permissão/);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("nega para quem não é membro desta empresa", async () => {
    comoUsuario(["usuarios.manage"]);
    const { definirSenhaUsuario } = await import("../actions/usuarios");
    expect((await definirSenhaUsuario({}, pedido())).error).toMatch(/não encontrado/);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("nega quando a conta também acessa outra empresa", async () => {
    comoUsuario(["usuarios.manage"]);
    respostas.membros = { maybeSingle: { data: { id: ALVO, email: "p@exemplo.test", role: "administrativo", admin_master: false } } };
    respostas.empresa_membros = { list: { data: [{ empresa_id: "outra" }], error: null } };
    const { definirSenhaUsuario } = await import("../actions/usuarios");
    expect((await definirSenhaUsuario({}, pedido())).error).toMatch(/outra empresa/);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("nega senha de gestor para quem não é master e permite ao master", async () => {
    respostas.membros = { maybeSingle: { data: { id: ALVO, email: "g@exemplo.test", role: "gestor", admin_master: false } } };
    const { definirSenhaUsuario } = await import("../actions/usuarios");
    comoUsuario(["usuarios.manage"]);
    expect((await definirSenhaUsuario({}, pedido())).error).toMatch(/master/);
    comoUsuario(["usuarios.manage"], true);
    expect((await definirSenhaUsuario({}, pedido())).ok).toBe(true);
    expect(authAdmin.updateUserById).toHaveBeenCalledWith(ALVO, { password: SENHA, app_metadata: { trocar_senha: true } });
  });
});
