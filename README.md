# ChefOS Control Center

Aplicação independente para operar o painel administrativo do ChefOS. Ela reutiliza o mesmo projeto Supabase do sistema atual, mas separa o frontend e as operações administrativas em um novo deploy Vercel.

## Centro de controle

- painel executivo com receita mensal contratada, acessos vencidos, trials, onboarding e alertas operacionais;
- gestão de assinaturas com saúde do acesso, troca de plano, status, vencimento, motivo e auditoria;
- central de suporte com fila, prioridade, relógio de SLA, histórico de conversa e resolução;
- visão 360º de clientes, lojas, assinatura, onboarding, atividade, suporte e cardápios;
- exportação CSV de clientes e assinaturas;
- onboarding que cria ou reutiliza o usuário pelo e-mail, sem exigir UUID;
- gestão de planos com edição, duplicação, recorrência, Mercado Pago e permissões;
- gestão de cardápios por cliente e loja, com criação, edição, filtros e disponibilidade;
- saúde, auditoria e acessos administrativos.

## O que foi extraído

| Painel original | Nova rota | Operações |
| --- | --- | --- |
| `/admin/dashboard` | `/` | indicadores SaaS, receita contratada, acesso e suporte |
| usuários e lojas | `/api/admin/customers` | consulta paginada de clientes, lojas, assinaturas, onboarding e suporte |
| planos | `/api/admin/plans` | listar, criar, editar, duplicar, atualizar permissões e excluir quando não houver vínculos |
| suporte | `/api/admin/tickets` e `/api/admin/messages` | chamados e respostas |
| gestão de cardápio | `/api/admin/tenant-menu` | listar, criar e atualizar itens por loja (`storeId`) |
| provisionamento | `/api/admin/provision-tenant` | usuário Auth, perfil, loja, trial, salão, mesas e permissões |
| administradores | `/api/admin/administrators` | gestão da allowlist `system_admins` |
| health e logs | `/api/admin/health` e `/api/admin/logs` | observabilidade administrativa |

As rotas legadas continuam disponíveis por compatibilidade: `/api/v2/admin/*` aponta para as novas rotas e `/api/v2/health` aponta para `/api/admin/health`.
`/api/admin/restaurants` continua funcionando como alias temporário de `/api/admin/customers`.

## Contratos administrativos

- A conta (`accountId`) é sempre o UUID do usuário proprietário no Supabase Auth.
- A loja usa seu próprio `storeId`; os dois IDs não são misturados nas respostas novas.
- O operador informa nome, e-mail e senha inicial no onboarding; o `accountId` é criado e usado internamente pela API.
- Se o e-mail já existir no Supabase Auth, a conta é reutilizada e sua senha atual não é alterada.
- Receita é exibida como **estimativa contratada** pelo preço atual do plano. Ela só deve ser chamada de MRR depois da conciliação com o provedor de pagamentos.
- Alterações de assinatura exigem motivo e são gravadas em `system_logs` com estado anterior e posterior.
- Alterações internas de status, plano ou vencimento ainda não sincronizam a recorrência do Mercado Pago; o painel exibe esse aviso antes de salvar.

## Segurança aplicada na separação

- O browser recebe somente a URL do Supabase e a chave pública (`anon`).
- A chave `SUPABASE_SERVICE_ROLE_KEY` fica exclusivamente nas funções Vercel.
- Todas as rotas administrativas validam o JWT e confirmam o e-mail na tabela `system_admins`.
- `provision-tenant`, que no projeto original não validava um administrador, agora exige essa validação.
- Entradas administrativas são validadas por UUID, enum e tamanho antes de acessar o banco.
- O build executa verificação de sintaxe em todas as funções e bloqueia arquivos truncados antes do deploy.
- Administradores definidos em `ROOT_ADMIN_EMAILS` não podem ser removidos pela interface.
- O CORS é fechado por padrão; preencha `ADMIN_ALLOWED_ORIGINS` apenas se o frontend e a API estiverem em domínios diferentes.

## Publicar na Vercel

1. Crie um repositório novo com esta pasta e importe-o na Vercel.
2. Em **Environment Variables**, configure todas as chaves de `.env.example`.
3. Use o mesmo projeto Supabase do KoreGastro até que uma migração de dados seja planejada.
4. Faça o primeiro deploy. A Vercel executa `npm run build`, que injeta no navegador apenas as variáveis públicas `VITE_*`.
5. Cadastre pelo menos um e-mail em `system_admins` (e, preferencialmente, em `ROOT_ADMIN_EMAILS`) antes de acessar o portal.

Para desenvolvimento local, copie `.env.example` para `.env.local`, preencha as variáveis e execute `npm run dev`.

## Pré-requisitos do banco

Esta extração preserva os nomes de tabela já usados no KoreGastro: `system_admins`, `profiles`, `stores`, `subscriptions`, `plans`, `plan_permissions`, `support_tickets`, `support_ticket_messages`, `recipes`, `categories`, `company_profile`, `halls`, `tables`, `unit_permissions` e `system_logs`.

Se uma tabela opcional de suporte não existir, o painel a apresenta vazia. O provisionamento atual é idempotente e pode ser reenviado depois de uma falha, mas ainda não é uma transação única; uma RPC transacional pode ser adicionada na etapa de migração do banco.
