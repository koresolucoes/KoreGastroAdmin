# ChefOS Control Center

Aplicação independente para operar o painel administrativo do ChefOS. Ela reutiliza o mesmo projeto Supabase do sistema atual, mas separa o frontend e as operações administrativas em um novo deploy Vercel.

## Centro de controle

- painel executivo com MRR, ARR, renovações, inadimplência e alertas operacionais;
- gestão de assinaturas com filtros, troca de plano, status e vencimento;
- central de suporte com fila, prioridade, histórico de conversa e resolução;
- visão detalhada de clientes, lojas, atividade e cardápios;
- exportação CSV de clientes e assinaturas;
- onboarding guiado, catálogo de planos, saúde, auditoria e acessos administrativos.

## O que foi extraído

| Painel original | Nova rota | Operações |
| --- | --- | --- |
| `/admin/dashboard` | `/` | indicadores SaaS, MRR e assinaturas |
| usuários e lojas | `/api/admin/restaurants` | consulta clientes, lojas e assinaturas |
| planos | `/api/admin/plans` | listar, criar, atualizar permissões e excluir |
| suporte | `/api/admin/tickets` e `/api/admin/messages` | chamados e respostas |
| inspector de cardápio | `/api/admin/tenant-menu` | listar, criar e atualizar itens por tenant |
| provisionamento | `/api/admin/provision-tenant` | loja, perfil, trial, salão, mesas e permissões |
| administradores | `/api/admin/administrators` | gestão da allowlist `system_admins` |
| health e logs | `/api/admin/health` e `/api/admin/logs` | observabilidade administrativa |

As rotas legadas continuam disponíveis por compatibilidade: `/api/v2/admin/*` aponta para as novas rotas e `/api/v2/health` aponta para `/api/admin/health`.

## Segurança aplicada na separação

- O browser recebe somente a URL do Supabase e a chave pública (`anon`).
- A chave `SUPABASE_SERVICE_ROLE_KEY` fica exclusivamente nas funções Vercel.
- Todas as rotas administrativas validam o JWT e confirmam o e-mail na tabela `system_admins`.
- `provision-tenant`, que no projeto original não validava um administrador, agora exige essa validação.
- Administradores definidos em `ROOT_ADMIN_EMAILS` não podem ser removidos pela interface.
- O CORS é fechado por padrão; preencha `ADMIN_ALLOWED_ORIGINS` apenas se o frontend e a API estiverem em domínios diferentes.

## Publicar na Vercel

1. Crie um repositório novo com esta pasta e importe-o na Vercel.
2. Em **Environment Variables**, configure todas as chaves de `.env.example`.
3. Use o mesmo projeto Supabase do KoreGastro até que uma migração de dados seja planejada.
4. Faça o primeiro deploy. A Vercel executa `npm run build`, que injeta no navegador apenas as duas variáveis públicas `VITE_*`.
5. Cadastre pelo menos um e-mail em `system_admins` (e, preferencialmente, em `ROOT_ADMIN_EMAILS`) antes de acessar o portal.

Para desenvolvimento local, copie `.env.example` para `.env.local`, preencha as variáveis e execute `npm run dev`.

## Pré-requisitos do banco

Esta extração preserva os nomes de tabela já usados no KoreGastro: `system_admins`, `profiles`, `stores`, `subscriptions`, `plans`, `plan_permissions`, `support_tickets`, `support_ticket_messages`, `recipes`, `categories`, `company_profile`, `halls`, `tables`, `unit_permissions` e `system_logs`.

Se uma tabela opcional de suporte ou logs não existir, o painel a apresenta vazia. Antes de habilitar provisionamento, confirme que as tabelas de loja e permissões têm as constraints de `upsert` esperadas (`user_id` e `manager_id,store_id`).
