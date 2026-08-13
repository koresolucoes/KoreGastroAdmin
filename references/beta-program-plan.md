# Programa Beta ChefOS — Plano de Trabalho

## Objetivo

Conduzir o ChefOS para um beta fechado com captação pública, triagem no Admin, dados protegidos, consentimento claro e conversão futura de Parceiros Fundadores.

## Regras fixas

- Beta sem cobrança automática e sem cartão.
- Consentimento do programa separado de marketing opcional.
- Não expor PII, pedidos ou dados de funcionários em analytics.
- Usar `app_metadata` para autorização administrativa.
- Aplicar RLS, grants mínimos e verificação de segurança em tabelas expostas.

## Fase 0 — Direção e narrativa

Status: concluída.

Definição do beta fechado, comunicação de Parceiros Fundadores e identidade comercial do programa.

## Fase 1 — Captação pública

Status: concluída.

Landing com proposta clara do beta, mensagem para early adopters e formulário público preparado para o fluxo oficial.

## Fase 2 — Base segura do beta

Status: concluída tecnicamente; painel operacional integrado à `main`.

Entregas já aplicadas:

- tabela pública de candidaturas com fluxo mínimo do beta;
- endpoint público de candidatura via servidor;
- pipeline de Administração para candidaturas e conversão;
- RLS e políticas explícitas para as tabelas novas do beta;
- índice de desempenho para `beta_consent_events.application_id`;
- `company_profile_public` ajustada para `security_invoker = true`.
- operação de triagem no Admin com busca, filtros e indicador de candidaturas sem movimentação;
- ficha completa do candidato com contatos, consentimentos, histórico e responsável interno;
- registro obrigatório de cada conversa ou decisão antes de mudar a etapa;
- criação do participante, onboarding, ativação e cálculo automático dos 90 dias;
- limpeza dos dados do beta em memória ao encerrar a sessão administrativa.

Validação atual:

- o advisor do Supabase não aponta mais os avisos do beta que foram corrigidos;
- `npm run check` segue verde no painel admin.
- o verificador do painel exige os marcadores do fluxo operacional, não apenas a presença do endpoint.

Próximos passos:

1. validar o fluxo operacional autenticado no deploy de produção do Admin;
2. ligar automações de e-mail transacional para candidatura, aprovação, onboarding e encerramento;
3. adicionar métricas de ativação, uso e feedback sem PII em analytics;
4. migrar o restante da captação para o fluxo unificado do beta, se necessário.

## Fase 3 — Operação e automações

Status: operação manual e centro de trabalho unificado implementados; automações ainda pendentes.

O acompanhamento manual de candidatos e participantes já está implementado no Admin.

Decisões do Kanban operacional:

- um único motor de trabalho atende suporte e programa beta sem duplicar os registros originais;
- o Radar inteligente reúne os itens críticos, do dia, da semana, aguardando e concluídos;
- os quadros nativos preservam as etapas reais de suporte e beta;
- a prioridade é determinística e explicável, considerando urgência, prazo, tempo sem movimentação, etapa e ausência de responsável;
- nenhuma automação muda o card sozinha: o responsável confirma toda movimentação;
- atribuição, prazo e ordenação do quadro ficam em `admin_work_items`, tabela interna acessível apenas pelo backend administrativo; no beta, o responsável também é sincronizado com a candidatura para a ficha nativa permanecer coerente;
- mudanças continuam registradas na auditoria e alterações de etapa do beta exigem observação;
- a primeira versão usa atualização sob demanda; Realtime fica adiado até existir necessidade operacional comprovada.

Validação concluída antes da publicação:

- sintaxe e verificador do Admin aprovados;
- políticas, grants, índices e integridade da tabela validados no Supabase;
- movimentação segura de suporte e beta validada em transação revertida, sem dados artificiais persistidos;
- revisão visual aprovada em desktop e mobile, com alternativa acessível ao arrastar e soltar.

Ainda faltam e-mails automáticos, feedback pós-uso, métricas, onboarding guiado e preparo para a transição beta → lançamento.
