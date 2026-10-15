# Segurança — GE EASY

## Camadas
1. **Rede/HTTP** — `next.config.ts` define CSP (somente o próprio domínio, Supabase e Google), HSTS (2 anos),
   `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
   (apenas geolocalização no próprio site) e remove o cabeçalho `X-Powered-By`.
2. **Autenticação** — Supabase Auth (cookies httpOnly via `@supabase/ssr`). O middleware valida o JWT com
   `getUser()` em toda requisição, renova a sessão e exige **AAL2** quando o usuário tem 2FA. Login com limite de
   tentativas **persistido no banco** e contado antes de testar a senha (5 por IP+e-mail e 20 por e-mail a cada
   15 min, chaves HMAC — vale entre instâncias e para tentativas paralelas, além do rate limit do Supabase) e mensagens que não revelam se o e-mail existe.
   Sessão encerrada por **inatividade** (padrão 30 min, aviso 60 s antes, sincronizado entre abas) e 2FA
   **obrigatória** configurável (gestão/financeiro ou todos) em *Configurações › Segurança*, aplicada em
   `requireSession()` (toda página) e em `guard()` (toda Server Action).
   Senhas novas: mínimo 10 caracteres com maiúscula, minúscula e número.
3. **Autorização na aplicação** — `requirePermission()` em páginas e `guard()` em Server Actions (`src/lib/rbac.ts`).
4. **Autorização no banco (fonte da verdade)** — RLS em 100% das tabelas do schema `public`:
   - `is_active_user()`, `is_manager()`, `is_backoffice()`, `is_admin()`, `has_role()`, `can_access_cliente()`
     (`SECURITY DEFINER`, `search_path = ''`).
   - Consultores (internos e externos) só leem/alteram registros com `consultor_id` ou `created_by` iguais ao seu id.
   - `enforce_own_consultor` força o consultor como dono do que cria e impede transferência de carteira.
   - `protect_profile_privileges` impede que não-admins alterem papel, status, e-mail ou comissão — e que o admin
     remova o próprio acesso.
   - Usuários novos entram **inativos** (exceto o primeiro, que vira admin) e não acessam nada até aprovação.
   - `anon` não tem privilégio algum no schema `public`.
5. **Storage** — bucket `documentos` privado, limite 25 MB, tipos MIME permitidos, caminhos `clientes/<id>/…` e
   `processos/<id>/…` validados por `storage_can_access()` (envio em processo exige poder editá-lo). O conteúdo real
   do arquivo é conferido pela **assinatura (magic bytes)** — um HTML disfarçado de PDF é descartado
   (`src/lib/seguranca/arquivos.ts`). Downloads somente por URL assinada de 60 s, com limite (120/10 min) e registro.
   O trigger `documentos_integridade` exige que o caminho pertença ao cliente/processo da linha e impede que usuários
   alterem caminho, vínculo ou campos do Drive (só o servidor). Documento de processo não leva `cliente_id`: só quem
   acessa o processo o enxerga.
6. **Segredos** — `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY` e `GOOGLE_CLIENT_SECRET` só no servidor
   (`server-only`). Tokens OAuth do Google cifrados com AES-256-GCM em tabela sem políticas (só service role).
   OAuth com `state` aleatório em cookie httpOnly verificado com comparação em tempo constante; desconexão
   via POST com verificação de origem (CSRF).
7. **Auditoria** — trigger `audit_trigger` grava INSERT/UPDATE/DELETE (antes/depois, autor) nas tabelas de negócio
   (ignora atualizações só de campos técnicos de sincronização); `registrar_acesso()` grava **entradas/saídas (IP e
   navegador — Marco Civil, art. 15), downloads, exportações, acesso a processo em segredo de justiça e operações
   LGPD**. Visível apenas para administradores (*Configurações › Segurança* e *Auditoria*).
9. **Limites de uso** — `rate_limit()` persistente por usuário em ações sensíveis: downloads, exportações CSV (30/h),
   relatório LGPD (20/h), DataJud (30/10 min), DJEN (8/h), Drive e sincronização de agenda.
10. **LGPD** — relatório JSON dos dados do titular (art. 18, II e V; gestão), anonimização (art. 18, IV e VI; somente
    admin, bloqueada com processo ativo/contrato vigente, remove os arquivos), política pública em `/privacidade`,
    retenção automática de dados técnicos (rate limit 2 dias, log de integrações e notificações lidas 180 dias) e
    `/.well-known/security.txt`.
11. **Integrações** — rotina `/api/cron/sincronizar` chamada pelo `pg_cron` + `pg_net` com segredo (`CRON_SECRET`,
    também no Vault do Supabase) comparado em tempo constante; usa o service role porque roda sem usuário.
    DataJud recebe só o número do processo; DJEN só o número da OAB. Drive com escopo `drive.file` (o app só enxerga
    o que criou), conta única do escritório definida pelo admin; o acesso de cada pessoa continua controlado pelo GE EASY.
8. **Entradas e saídas** — zod em todas as Server Actions; CPF/CNPJ validados; termos de busca sanitizados;
   CSV com neutralização de fórmulas; redirecionamentos `next` aceitam só caminhos relativos.

## Avisos do Supabase Advisor
- *Signed-in users can execute SECURITY DEFINER function*: esperado para as funções auxiliares de RLS
  (`is_manager`, `can_access_cliente` etc.). Elas apenas respondem sobre o **próprio** usuário e são necessárias
  para as políticas.
- *RLS enabled no policy* em `integracoes_google` e `rate_limits`: intencional — somente o service role / funções
  `SECURITY DEFINER` acessam.
- *Public can execute* `rate_limit_login`: intencional (checagem antes do login); a chave é HMAC calculado no servidor.
- *Extension in public* (`pg_net`): as permissões do schema `net` são do `supabase_admin` (padrão da plataforma) e o
  schema **não é exposto** pela API REST; só `disparar_sincronizacao` (sem EXECUTE para usuários) faz requisições.

## Checklist de produção
- [ ] Em *Authentication › Providers › Email*, **desativar "Allow new users to sign up"** após criar o primeiro admin
      (novos usuários entram por convite).
- [ ] Ativar *Leaked password protection* e definir tamanho mínimo de senha 10 no painel do Supabase.
- [ ] Configurar *Site URL* e *Redirect URLs* (`https://SEU-DOMINIO/auth/callback`, `/auth/confirm`).
- [ ] Definir `APP_ENCRYPTION_KEY` (32 bytes base64) e `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor (Vercel).
- [ ] Em *Configurações › Segurança*, definir 2FA **obrigatória** para gestão (ou todos) e o tempo de inatividade.
- [ ] Definir `CRON_SECRET` na Vercel e o mesmo valor no Vault (`geeasy_cron_secret`) — já feito na implantação.
- [ ] Revisar periodicamente *Configurações › Auditoria*.

## Testes de segurança no banco
`supabase/tests/rls_security_test.sql`, `rls_juridico_test.sql` e `integracoes_seguranca_test.sql` executam cenários
com usuários simulados e terminam com `RAISE` (tudo é desfeito). Rode no SQL Editor após mudanças de política.
