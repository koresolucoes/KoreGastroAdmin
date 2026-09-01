# ChefOS Control Center

Aplicação independente para operar o painel administrativo do ChefOS. Ela reutiliza o mesmo projeto Supabase do sistema atual, mas separa o frontend e as operações administrativas em um deploy Vercel próprio.

## Centro de controle

- painel executivo com receita mensal contratada, acessos vencidos, trials, onboarding e alertas operacionais;
- gestão de assinaturas com saúde do acesso, troca de plano, status, vencimento, motivo e auditoria;
- central de suporte com fila, prioridade, relógio de SLA, histórico de conversa e resolução;
- visão 360º de clientes, lojas, assinatura, onboarding, atividade, suporte, memberships e cardápios;
- exportação CSV de clientes e assinaturas;
- onboarding que cria ou reutiliza o usuário pelo e-mail, sem exigir UUID;
- gestão de planos com edição, duplicação, recorrência, Mercado Pago e seletor visual de módulos em português;
- gestão de cardápios por cliente e loja, com criação, edição, filtros e disponibilidade;
- saúde, auditoria e acessos administrativos.

## Alinhamento canônico com o ChefOS

O Control Center acompanha o modelo atual do `ChefOS_portal` sem reconstruir a estratégia comercial de planos.

### Entitlement de assinatura

A regra canônica de acesso comercial é:

```text
status ∈ active | trialing | past_due
AND
current_period_end ausente ou futuro
```

`canceled` e `unpaid` não concedem entitlement. `past_due` continua sendo um estado de risco financeiro, mas permanece elegível enquanto o período atual não expirou.

A implementação compartilhada do painel vive em:

```text
api/_lib/subscription-entitlements.js
```

### Conta, loja e assinatura

- `accountId` é o UUID da pessoa no Supabase Auth.
- `storeId` é o UUID da operação/loja.
- o código administrativo trata assinatura como pertencente à loja;
- no schema atual, a coluna legada `subscriptions.user_id` possui FK para `stores.id`, portanto ela deve ser interpretada semanticamente como `storeId`;
- endpoints administrativos aceitam `storeId` como identificador preferencial e mantêm `accountId` como fallback apenas quando a conta possui uma única loja.

### IAM de gestão

A autoridade administrativa de uma conta dentro de uma loja é `store_memberships`.

No provisionamento do proprietário, o Control Center garante:

```text
store_memberships
  store_id = storeId
  account_id = accountId
  access_level = OWNER
  status = ACTIVE
  accepted_at != null
```

`unit_permissions` continua recebendo dual-write temporário para compatibilidade com leitores legados do ChefOS. Não deve ser tratado como a fonte canônica de autorização para novos fluxos.

### Compatibilidade de IDs

O Control Center **não separa artificialmente o ID da primeira loja do ID da conta proprietária nesta etapa**. O schema atual ainda possui relações legadas que dependem desse contrato, incluindo `subscriptions.user_id -> stores.id`. A separação definitiva exige migration coordenada no ChefOS e está fora do escopo deste painel.

## Centro de segurança e confiabilidade

- papéis administrativos: Proprietário, Administrador, Financeiro, Suporte e Auditor;
- autorização por capacidade em todas as APIs, com modo compatível durante a migração;
- convite real pelo Supabase Auth, ciclo de vida `invited`, `active`, `suspended` e `revoked`;
- aceite de convite com definição de senha, ativação automática e cadastro/desafio TOTP para MFA;
- bloqueio de autoexclusão, proteção de administradores raiz e garantia do último proprietário no banco;
- auditoria administrativa estruturada, redigida e com dupla gravação temporária em `system_logs`;
- filtros, paginação, resultado, risco, antes/depois e exportação CSV na central de auditoria;
- saúde dividida em infraestrutura, negócio e segurança, incluindo assinaturas vencidas, cobrança, iFood, SLA, MFA e integridade de OWNER memberships;
- histórico de diagnósticos e estrutura para gestão de incidentes.

### Aplicar a migração administrativa

Execute `supabase/migrations/202608090001_admin_control_center.sql` no SQL Editor do mesmo projeto Supabase usado pelo ChefOS antes de ativar os controles administrativos que dependem dela.

Após validar que todos os administradores privilegiados possuem segundo fator, configure `ADMIN_ENFORCE_MFA=true` na Vercel. Enquanto estiver `false`, a tela de Saúde apresentará a implantação de MFA como ponto de atenção sem bloquear a operação.

## O que foi extraído

| Painel original | Nova rota | Operações |
| --- | --- | --- |
| `/admin/dashboard` | `/` | indicadores SaaS, receita contratada, acesso e suporte |
| usuários e lojas | `/api/admin/customers` | consulta paginada de clientes, lojas, memberships, assinaturas, onboarding e suporte |
| planos | `/api/admin/plans` | listar, criar, editar, duplicar, atualizar permissões e excluir quando não houver vínculos |
| suporte | `/api/admin/tickets` e `/api/admin/messages` | chamados e respostas |
| gestão de cardápio | `/api/admin/tenant-menu` | listar, criar e atualizar itens por loja (`storeId`) |
| provisionamento | `/api/admin/provision-tenant` | usuário Auth, perfil, loja, OWNER membership, trial, salão, mesas e compatibilidade legada |
| administradores | `/api/admin/administrators` | gestão da allowlist `system_admins` |
| health e logs | `/api/admin/health` e `/api/admin/logs` | observabilidade administrativa |

As rotas legadas continuam disponíveis por compatibilidade: `/api/v2/admin/*` aponta para as novas rotas e `/api/v2/health` aponta para `/api/admin/health`.
`/api/admin/restaurants` continua funcionando como alias temporário de `/api/admin/customers`.

## Contratos administrativos

- Conta e loja são identidades conceitualmente distintas, mesmo enquanto parte do schema legado ainda reutiliza IDs na primeira loja.
- A assinatura é resolvida por `storeId`; `accountId` é aceito como fallback somente quando não existe ambiguidade multi-loja.
- O operador informa nome, e-mail e senha inicial no onboarding; o `accountId` é criado e usado internamente pela API.
- Se o e-mail já existir no Supabase Auth, a conta é reutilizada e sua senha atual não é alterada.
- O onboarding garante um `store_memberships` `OWNER/ACTIVE` aceito para o proprietário.
- O dual-write em `unit_permissions` é temporário e existe apenas para compatibilidade.
- Receita é exibida como **estimativa contratada** pelo preço atual do plano. Ela só deve ser chamada de MRR financeiro depois da conciliação com o provedor de pagamentos.
- Alterações de assinatura exigem motivo e são gravadas em `system_logs` com estado anterior e posterior.
- Alterações internas de status, plano ou vencimento ainda não sincronizam a recorrência do Mercado Pago; o painel exibe esse aviso antes de salvar.
- `plans` e `plan_permissions` são preservados para promoções, planos Founders, parceiros, legacy e futuras estratégias comerciais.
- `plan_permissions` continua usando chaves de rota enquanto o ChefOS mantiver esse contrato; o Control Center não introduz um modelo comercial novo nesta etapa.

## Segurança aplicada na separação

- O browser recebe somente a URL do Supabase e a chave pública (`anon`).
- A chave `SUPABASE_SECRET_KEY` fica exclusivamente nas funções Vercel.
- Todas as rotas administrativas validam o JWT e confirmam o e-mail na tabela `system_admins`.
- `provision-tenant` exige validação de administrador.
- Entradas administrativas são validadas por UUID, enum e tamanho antes de acessar o banco.
- O build executa verificação de sintaxe em todas as funções e roda testes de contrato antes do deploy.
- Administradores definidos em `ROOT_ADMIN_EMAILS` não podem ser removidos pela interface.
- Escritas diretas de usuários autenticados em `system_admins` são revogadas pela migração; alterações passam pela API com trilha de auditoria.
- O CORS é fechado por padrão; preencha `ADMIN_ALLOWED_ORIGINS` apenas se o frontend e a API estiverem em domínios diferentes.

## Publicar na Vercel

1. Importe este repositório na Vercel.
2. Em **Environment Variables**, configure todas as chaves de `.env.example`.
3. Use o mesmo projeto Supabase do ChefOS enquanto os produtos compartilharem a mesma base operacional.
4. Faça o deploy. A Vercel executa `npm run build`, que injeta no navegador apenas as variáveis públicas `VITE_*`.
5. Cadastre pelo menos um e-mail em `system_admins` e, preferencialmente, em `ROOT_ADMIN_EMAILS` antes de acessar o portal.

Para desenvolvimento local, copie `.env.example` para `.env.local`, preencha as variáveis e execute `npm run dev`.

## Testes

```bash
npm test
npm run check
```

Os testes de alinhamento com o ChefOS cobrem entitlement, resolução por loja, provisionamento de OWNER membership, dual-write legado e catálogo comercial.

## Pré-requisitos do banco

O painel usa diretamente os contratos atuais do ChefOS: `system_admins`, `profiles`, `stores`, `store_memberships`, `subscriptions`, `plans`, `plan_permissions`, `support_tickets`, `support_ticket_messages`, `recipes`, `categories`, `company_profile`, `halls`, `tables`, `unit_permissions` e `system_logs`.

Se uma tabela opcional de suporte não existir, o painel a apresenta vazia. O provisionamento é idempotente e pode ser reenviado depois de uma falha, mas ainda não é uma transação única; uma RPC transacional pode ser adicionada em uma etapa posterior sem alterar o contrato público do Control Center.
