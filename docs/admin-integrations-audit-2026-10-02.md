# Admin ChefOS: identidade, operação e integrações

## Entrega

A identidade aprovada da landing foi aplicada ao Admin: símbolo SVG original no favicon e nas telas de acesso, DM Sans/DM Serif Display, fundo creme, superfícies claras, laranja e navegação verde. O stylesheet canônico preserva os componentes existentes e seus estados; o arquivo de compatibilidade continua sem duplicar componentes.

A ajuda de cada página fica recolhida. Atalhos acompanham as permissões da pessoa. A navegação usa ícones SVG consistentes, busca global e menu recolhível. O cabeçalho mobile e os indicadores foram ajustados para 320 e 390 pixels.

Assinaturas, exportação e totais dos planos consideram todas as operações. O formulário exige a loja selecionada. A ficha do cliente reúne o acesso de todas as lojas e encaminha à visão de integrações filtrada pelo cliente.

## Auditoria e correções

| Área | Evidência / problema | Tratamento |
|---|---|---|
| iFood administrativo | A API central aceitava qualquer e-mail da tabela administrativa, inclusive suspenso | JWT verificado, vínculo da identidade, status ativo, função e MFA conforme política do servidor |
| Cobrança administrativa | Qualquer administrador ativo conseguia acessar comandos financeiros diretamente | Leitura separada de gestão de assinaturas e de planos; auditor/suporte não podem alterar contratos |
| Assinaturas por loja | A UI mostrava apenas a primeira assinatura do cliente e não enviava storeId | Uma linha e uma ação por operação; CSV e totais coerentes |
| Recorrência MP | Alteração local poderia divergir do contrato do provedor | Edição interna bloqueada em contratos MP; consulta/sincronização por bridge autenticada e auditada |
| Vínculo financeiro | Sincronização/cancelamento não conferia a referência da operação no provedor | Confere ID e external_reference antes de continuar |
| Faturas MP | subscription.user_id é stores.id, mas invoice.user_id referencia auth.users | Resolve owner_id da loja; preserva dono, ID e criação da fatura no reenvio |
| Checkout / webhook | Em 02/10, portal.chefos.online/api/mercadopago-webhook devolvia HTML; API central devolvia JSON | Destino padrão do webhook passa a api.chefos.online; retorno do checkout usa a rota com hash do portal |
| OAuth MP | Callback podia usar a origem da interface, e o sucesso redirecionava relativamente à API | Callback padrão da API e retorno absoluto ao portal; variáveis explícitas continuam respeitadas |
| Browser MP | Preflight real do checkout e OAuth devolvia 405 sem CORS | Helper canônico antes de método/auth, permitindo origens oficiais e rejeitando origens externas |
| Beta gratuito | Edição de assinatura/plano ou ativação poderia usar plano pago | Guardas nas rotas administrativas; ativação exige plano gratuito e sem recorrência |
| Diagnóstico | Cadastro não demonstra transação concluída | Visão por operação distingue configurado, atenção, não verificado e acesso vigente; consultas parciais não geram falsos estados positivos |

## Consulta de produção, somente leitura

Projeto Supabase gastroKore, 02/10/2026. Nenhuma conta, assinatura, pedido ou pagamento real foi alterado nesta auditoria.

- 18 assinaturas; nenhuma ligada à recorrência Mercado Pago; quatro com status elegível e período vencido.
- 13 candidaturas e dois participantes beta, sendo um ativo. Ambos ainda sem loja/assinatura vinculadas. A situação passou a aparecer no diagnóstico e nos sinais do beta; a operação correta deve ser identificada antes de vincular registros históricos. Não reiniciar o ciclo nem atribuir uma loja por suposição.
- Um vínculo iFood ativo; dois estabelecimentos Cielo ativos e 13 vínculos de terminais cadastrados. Estes números não comprovam uso recente ou pagamento aprovado.
- Nenhuma conta de recebimento de restaurante Mercado Pago e nenhuma fatura de assinatura cadastradas. A conta de cobrança da plataforma é distinta e só é conferida por sessão administrativa autenticada.
- Todos os planos possuem permissões. As tabelas administrativas/beta e de integrações verificadas têm RLS; políticas de recebimento/dispositivos exigem permissão da operação. Grants isolados não foram interpretados como acesso público.

## Validação

- Admin: build, sintaxe e 50 testes, incluindo operação explícita, perfil somente leitura, falhas parciais, proteção do beta e ausência de tokens na resposta.
- API: build portátil/TypeScript e suíte completa; inclui autorização, CORS, faturas, iFood e correlação de pagamentos Cielo.
- Navegador: páginas administrativas renderizadas em desktop; fluxo de consulta/sincronização MP com dados fictícios; sete páginas principais em 320 px sem overflow da página; cabeçalho também conferido em 390 px.
- A prévia é local e utiliza dados fictícios; não adiciona bypass de autenticação ao produto.

## Testes que exigem operação / provedor

1. Identificar os dois registros beta históricos e preparar a loja/assinatura adequada sem reiniciar datas existentes.
2. Revisar comercialmente as quatro assinaturas vencidas. Não prorrogar acesso automaticamente.
3. Conferir as variáveis explícitas e registrar o callback `https://api.chefos.online/api/v2/webhooks_providers/mercadopago-oauth` na aplicação Mercado Pago. Um override antigo pode continuar apontando ao portal.
4. Completar OAuth com conta de teste, checkout/retorno, webhook assinado, fatura, renovação e cancelamento no ambiente de teste do provedor.
5. Receber e processar pedido iFood de teste, inclusive múltiplas marcas da mesma cozinha.
6. Na Cielo física, validar Pix/cartão aprovado, erro/cancelamento, recuperação e conciliação, com conferência do caixa e da versão web.

Não classificar a cadeia financeira como homologada de ponta a ponta apenas por cadastro, testes automatizados ou disponibilidade de endpoint.

Referências: [API de assinaturas Mercado Pago](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/update-preapproval/put), [segurança da Data API Supabase](https://supabase.com/docs/guides/api/securing-your-api).
