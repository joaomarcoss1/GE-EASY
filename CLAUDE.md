# GE EASY — Gestão Especializada EASY

Sistema de **gestão jurídica** da EASY: o foco principal são **processos, prazos, audiências e a gestão por
departamentos** (equipes, demandas e indicadores). Módulos de apoio: clientes, agenda (Google Agenda),
documentos (Storage + Google Drive), tarefas/demandas e administração. O **comercial** (consórcios, seguros,
funil, comissões, metas, visitas de consultores externos) é um módulo secundário agrupado em "Comercial".

## Stack
- Next.js 15 (App Router, Server Components, Server Actions) + React 19 + TypeScript estrito
- Supabase (Postgres + Auth + Storage) — projeto `oiwmydggyloqezfsajxp`
- Tailwind CSS 3 (tokens em `tailwind.config.ts` e `src/app/globals.css`), lucide-react, recharts, zod, date-fns

## Regras de segurança (obrigatórias)
1. **Toda tabela tem RLS.** A autorização real está no banco (`supabase/migrations`). Nunca contorne o RLS no
   front-end. O cliente `createAdminClient()` (service role) só é usado no servidor para: convites de usuários,
   tokens do Google e operações que o RLS não cobre — e SEMPRE depois de `guard()`/`requirePermission()`.
2. **Server Actions** (`src/lib/actions/*.ts`, com `"use server"`): sempre começam com `guard("permissao")`,
   validam a entrada com **zod** (`zs.*` de `actions/utils.ts`), usam `createClient()` (sessão do usuário) e
   retornam `ActionState` (`{ ok, message, error, fieldErrors, id }`). Erros do banco passam por `dbError()`.
   Arquivos `"use server"` só podem exportar funções async.
3. **Páginas** em `src/app/(app)/**` chamam `requireSession()` ou `requirePermission()` de `@/lib/auth`.
4. Nunca exponha `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY` ou `GOOGLE_CLIENT_SECRET` ao cliente.
5. Saída CSV deve neutralizar fórmulas (prefixar `'` em valores iniciados por `= + - @`).
6. Redirecionamentos com `next` só aceitam caminhos relativos (`/x`, nunca `//x`).

## Papéis (enum `app_role`)
`admin`, `gestor`, `financeiro`, `advogado`, `assistente_juridico`, `consultor` (interno), `consultor_externo`.
- admin/gestor: veem e editam tudo; financeiro: lê processos, lança custas/honorários e gere comissões;
- advogado/assistente jurídico: processos do(s) seu(s) departamento(s), dos quais são responsáveis ou equipe;
- consultores (comercial): só a própria carteira e sem acesso a processos.
- `profiles.is_master`: administrador master, imutável por outros usuários.

## Núcleo jurídico
- Tabelas: `departamentos`, `departamento_membros`, `processos`, `processo_partes`, `processo_andamentos`,
  `prazos`, `audiencias`, `processo_lancamentos` (+ `processo_id`/`departamento_id` em tarefas, documentos e agenda).
- RLS por departamento: `is_membro_departamento()`, `is_responsavel_departamento()`, `can_access_processo()`,
  `can_edit_processo()`. Triggers gravam andamentos automáticos (prazos, audiências, mudança de fase/situação).
- `src/lib/juridico/cnj.ts`: validação/formatação do número CNJ (DV módulo 97) e identificação do tribunal.
- `src/lib/juridico/prazos.ts`: contagem de prazos em dias úteis (CPC arts. 219, 220 e 224) com feriados
  nacionais e recesso forense. Feriados locais via parâmetro `extras`.
Permissões da interface em `src/lib/rbac.ts` (`can(role, "perm")`).

## Convenções de UI
- Componentes base em `src/components/ui/*`: `Button`/`LinkButton`, `Card`/`CardHeader`/`CardBody`,
  `PageHeader`, `StatCard`, `Badge`/`StatusBadge`, `EmptyState`, `Avatar`, `Progress`, `LinkTabs`,
  `SearchInput`/`FilterSelect`/`SegmentTabs`/`Pagination` (filtros por URL), `Drawer`/`Modal`,
  `ResourceForm` + `FieldDef` (formulário por configuração), `FormDrawerButton` (botão + painel + form),
  `ConfirmAction` (excluir/confirmar), `useToast`.
- Rótulos/opções de enums em `src/lib/constants.ts`; formatação BR em `src/lib/format.ts`
  (`brl`, `date`, `dateTime`, `pct`, `maskDocumento`, `maskPhone`, `whatsappLink`, `todayISO`, `daysUntil`).
- Listas de apoio em `src/lib/data.ts` (`consultorOptions`, `clienteOptions`, `parceiroOptions`, `produtoOptions`,
  `getProfileMap`, `pageRange`, `searchTerm`).
- Cores: `brand-*` (índigo da logo, #2D2D83) e `accent-*` (laranja da logo, #E14F26). Tokens semânticos
  `bg`, `surface`, `surface-2`, `line`, `fg`, `muted` (suportam modo escuro).
- Telas de lista aceitam `?novo=1&cliente_id=<uuid>` para abrir o formulário de criação já preenchido
  (`FormDrawerButton defaultOpen`).
- Textos da interface em português do Brasil.

## Comandos
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test`
- Migrações em `supabase/migrations/` (aplicadas no projeto Supabase GE EASY).
