# GE EASY — Gestão Especializada EASY

Sistema de gestão da **EASY Consórcio & Seguros**: CRM, funil, consórcios, seguros,
agenda (Google Agenda), documentos (Storage + Google Drive), comissões, metas,
consultores externos (check-in de visitas) e administração.

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
`admin`, `gestor`, `financeiro`, `consultor` (interno), `consultor_externo`.
- admin/gestor: veem e editam tudo; financeiro: lê tudo e gere comissões;
- consultores: só a própria carteira (clientes/negócios com `consultor_id` ou `created_by` = ele).
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
