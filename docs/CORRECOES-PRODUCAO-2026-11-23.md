# Correções de prontidão para produção — 23/11/2026

Este documento registra o que foi implementado após a auditoria técnica e o que ainda depende da infraestrutura da organização. Ele deve ser lido antes de publicar o sistema.

## Implementado no código

### Autenticação e autorização

- Guard central `protegerApi` aplicado a todas as APIs privadas.
- Bloqueio uniforme de senha inicial pendente, vínculo revogado e política de MFA.
- Teste automatizado que falha se uma nova rota privada for criada sem o guard.
- MFA obrigatório para o proprietário da plataforma, inclusive quando não há empresa ativa.
- Tela dedicada para matrícula do segundo fator do proprietário da plataforma.
- Server Actions da plataforma também bloqueiam matrícula/verificação pendentes.

### Aplicativo de campo

- O banco offline agora possui proprietário explícito (`usuarioId` + `empresaId`). Em aparelhos da versão anterior,
  o dono é descoberto pelo pacote local e os dados da mesma pessoa são mantidos.
- Dados de outra conta não são lidos nem sincronizados. Sem envios pendentes, são apagados; **com envios pendentes,
  nada é apagado**: o app pede para entrar com a conta dona (ou descartar com confirmação explícita).
- Logout pelo menu global e expiração por inatividade (`limparAoSair`) apagam pacote, histórico e caches; envios ainda
  não sincronizados ficam guardados (cifrados) para a próxima entrada da mesma pessoa.
- A situação documental do snapshot é carregada por uma única RPC em lote.
- Payloads de OCR e sincronização foram limitados para caber na hospedagem atual.

### Arquivos e hospedagem

- Server Actions limitadas a 4 MB, mantendo margem para o limite de 4,5 MB da Vercel.
- Cadastro comercial limita a soma de anexos a 3 MB no navegador e no servidor.
- Arquivos maiores continuam disponíveis na ficha do cliente, cujo uploader envia diretamente ao Supabase Storage e não atravessa a Function.
- Importações de RH/campo foram reduzidas para 3 MB quando ainda atravessam o servidor.
- Região da Vercel **mantida em Portland (`pdx1`)**: o banco Supabase está em `us-west-2` (Oregon). Mover só a Vercel
  para São Paulo deixaria cada consulta cruzando o continente. Trocar de região exige mover banco e funções juntos.

### Banco e testes

- Migration `situacao_documental_lote` (aplicada em produção como `20261123113848`) com verificação de acesso por cliente.
- Executor SQL agora falha quando um teste termina antes do marcador `RESULTADO`.
- Testes atualizados para as regras atuais de financeiro, checklist de veículos, revisão de check-ins e auditoria de campos derivados.
- Testes de banco passam. Três suítes antigas ainda usam relatório textual e aparecem como `legado`; qualquer `FALHOU` ou erro antes do resultado continua derrubando o CI.

### Desempenho e dependências

- Exportação de resumos e estatísticas de consultores usam paginação real, sem depender do limite de uma única resposta PostgREST.
- Next.js atualizado para `15.5.29`.
- Vitest atualizado para `4.1.12`, primeira linha corrigida compatível com a configuração atual.
- `uuid` corrigido por override para `11.1.1` devido à dependência antiga do ExcelJS.
- `npm audit` não apresenta vulnerabilidades na versão entregue.
- CI agora bloqueia vulnerabilidades moderadas, altas e críticas.

### Formulários públicos

- O segredo do Cloudflare Turnstile ainda não está configurado na Vercel. Para não derrubar o cadastro público e a
  captação de leads, eles continuam funcionando com o limite por IP e registram um aviso no log. Configure
  `TURNSTILE_SECRET_KEY` e `NEXT_PUBLIC_TURNSTILE_SITE_KEY` para ligar o anti-robô.

## Validação executada

Execute novamente após preencher as variáveis do ambiente:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm audit --audit-level=moderate
npm run build
bash scripts/db-test.sh
```

Na entrega desta correção:

- TypeScript: passou;
- ESLint: passou;
- Vitest: 20 arquivos e 89 testes passaram;
- migrations: 52 aplicadas em banco PostgreSQL 17 vazio;
- testes SQL: passaram, com três suítes antigas sinalizadas como formato legado;
- auditoria de dependências: zero vulnerabilidades;
- build de produção: deve ser executado com URL e chave publicável reais do Supabase antes da publicação.

## Configuração obrigatória antes do deploy

1. Criar ambientes separados de produção e homologação no Supabase.
2. Aplicar as 52 migrations pelo pipeline, nunca manualmente sem registro.
3. Preencher todas as variáveis obrigatórias, em especial Supabase, `APP_ENCRYPTION_KEY`, `CRON_SECRET` e Turnstile.
4. Confirmar a região real do banco e ajustar `vercel.json` se ela não for compatível com `gru1`.
5. Configurar rotação e cofre de segredos; nunca copiar `.env` para o ZIP, repositório ou ticket.
6. Ativar PITR conforme o plano e definir RPO/RTO formais.
7. Criar backup versionado dos objetos do bucket `documentos` em outro provedor/domínio de falha.
8. Testar restauração de banco e arquivos em um ambiente vazio.
9. Configurar monitoramento de exceções, logs estruturados, métricas e alertas.
10. Executar pentest independente e teste de carga com o volume projetado.

## Dependências externas ainda obrigatórias

Os itens abaixo não podem ser concluídos apenas editando o repositório porque dependem de fornecedores, contas, credenciais e decisões jurídicas. O sistema não deve ser descrito como plenamente pronto para produção ampla até que estejam ativos:

- antimalware/quarentena/CDR para cada arquivo antes de disponibilizá-lo aos usuários;
- backup externo e versionado de objetos do Storage, com teste de restauração;
- APM/error tracking, logs centralizados, métricas, SLOs e alertas;
- fila durável e workers para DataJud, DJEN, Drive, OCR e exportações extensas;
- cofre de segredos e decisão sobre a retirada da senha Gov.br do produto;
- calendários oficiais por tribunal e validação jurídica do motor de prazos;
- validação trabalhista de ponto e pré-folha;
- política de retenção, legal hold, versionamento e assinatura documental;
- DPIA/LGPD, plano de resposta a incidentes, RTO/RPO e pentest.

## Limitações deliberadas

- A criptografia do PWA reduz exposição casual, mas um navegador não oferece as mesmas garantias de Keychain/Keystore. Para dispositivos hostis ou alto risco, use invólucro nativo, MDM, PIN obrigatório e armazenamento seguro do sistema operacional.
- GPS do navegador é evidência operacional de confiança moderada e não impede falsificação sofisticada.
- O timer de inatividade melhora a segurança da interface, mas a validade efetiva dos tokens continua sendo governada pelo Supabase Auth.
- Prazos jurídicos, ponto e pré-folha permanecem auxiliares até validação/certificação específica.

## Procedimento de liberação

1. Publicar em homologação com banco novo.
2. Rodar todo o CI e os testes E2E operacionais com perfis reais de permissão.
3. Testar MFA em AAL1/AAL2 chamando as APIs diretamente.
4. Testar troca de usuário/empresa no mesmo aparelho de campo.
5. Testar upload direto de 25 MB pela ficha e rejeição de payload grande em Server Actions.
6. Simular falha de integração, indisponibilidade de banco e recuperação de backup.
7. Aprovar formalmente os itens externos acima.
8. Liberar primeiro para um grupo piloto, monitorar e expandir gradualmente.

## Observação sobre instruções do projeto

O pacote analisado não continha `AGENTS.md` nem `RTK.md`. O único `AGENTS.md` encontrado após a instalação estava dentro de uma dependência e não governa o projeto. Nenhuma instrução adicional inexistente foi inferida.
