# Diretrizes de UX do Admin ChefOS

Este documento define o padrão de experiência do painel administrativo. Ele traduz as heurísticas de Nielsen para as rotinas reais de suporte, beta, clientes, receita e administração do ChefOS.

## Objetivo

O Admin deve funcionar como uma área de trabalho operacional: informação clara, próxima ação evidente e baixo risco de erro. A identidade ChefOS continua presente no grafite e no laranja, mas sem competir com dados, formulários e decisões.

## Arquitetura da informação

- **Trabalho:** Início, Minha fila e Kanban.
- **Relacionamento:** Clientes, Suporte e Programa beta.
- **Receita:** Assinaturas e Planos.
- **Produto:** Cardápios.
- **Administração:** Equipe, Auditoria e Saúde.
- Onboarding é uma ação contextual de **Novo cliente**, não uma seção permanente.

Cada perfil visualiza somente destinos e ações para os quais possui capacidade. Um endereço com `#` identifica a seção aberta para permitir recarregar, compartilhar internamente e usar os botões Voltar e Avançar do navegador.

## Regras de interação

1. Toda ação assíncrona informa que está em andamento e impede envio duplicado.
2. Erros locais permanecem próximos da ação e nunca apagam campos preenchidos.
3. Falhas parciais de uma seção não encerram a sessão; somente uma falha real de autenticação volta ao login.
4. Mudanças irreversíveis ou de etapa exigem contexto e confirmação proporcional ao risco.
5. Formulários alterados avisam antes de fechar ou navegar para outra seção.
6. Modais retêm o foco, fecham por `Escape` quando seguro e devolvem o foco ao elemento que os abriu.
7. Estados vazios explicam o que aconteceu e indicam a próxima ação. Carregamento e ausência de resultados nunca são apresentados como a mesma coisa.
8. Prioridade automática sempre mostra os motivos; a decisão e a movimentação continuam humanas.

## Linguagem visual

- Texto operacional e tabelas: pelo menos `14px`.
- Metadados auxiliares: pelo menos `12px` e contraste AA.
- Campos em telas pequenas: `16px` para evitar zoom automático.
- Alvos interativos: no mínimo `44px` em telas de toque.
- No máximo quatro indicadores principais por contexto; detalhes ficam na seção correspondente.
- Gradientes, sombras e laranja são usados para hierarquia e ação, não como decoração recorrente.
- Três níveis de superfície e uma escala curta de raios mantêm consistência.

## Nielsen aplicado ao ChefOS

- **Visibilidade do estado:** carregamento por seção, estado de envio, filtros ativos, responsável e prazo visíveis.
- **Correspondência com o mundo real:** nomes de etapas e ações seguem o vocabulário da operação.
- **Controle e liberdade:** voltar, cancelar, reabrir quando permitido e preservar rascunhos.
- **Consistência:** os mesmos padrões de filtro, tabela, card, modal, aviso e botão em todo o painel.
- **Prevenção de erros:** capacidades, transições válidas, confirmações e bloqueio de envio duplicado.
- **Reconhecimento em vez de memorização:** próximos passos, filtros e contexto do registro ficam visíveis.
- **Eficiência:** pesquisa global, Minha fila e ações contextuais reduzem navegação repetitiva.
- **Estética minimalista:** cada tela prioriza o que precisa ser decidido naquele momento.
- **Recuperação de erros:** mensagem em linguagem clara, causa quando conhecida e ação para tentar novamente.
- **Ajuda contextual:** explicações aparecem junto de campos e decisões, sem transformar a tela em documentação.

## Critérios de aceite

- Fluxos essenciais funcionam com teclado e em largura móvel.
- Não há texto operacional abaixo de `12px` nem contraste inferior ao nível AA para texto normal.
- A navegação mantém seção, histórico e título coerentes.
- Nenhum erro de API apaga entradas do usuário.
- Ações incompatíveis com o perfil não são renderizadas.
- Etapas do beta só avançam por transições válidas e com observação quando exigida.
- O build, a verificação estática e os testes de contrato passam antes de publicar.
