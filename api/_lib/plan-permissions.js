export const PLAN_PERMISSION_GROUPS = [
  {
    id: 'vendas',
    name: 'Vendas e atendimento',
    description: 'Ferramentas usadas pela equipe no salão e no caixa.',
    permissions: [
      { key: '/home', name: 'Início operacional', description: 'Acesso à tela inicial da operação.' },
      { key: '/pos', name: 'Ponto de venda', description: 'Lançamento e acompanhamento de pedidos.' },
      { key: '/cashier', name: 'Controle de caixa', description: 'Abertura, movimentações e fechamento do caixa.' },
      { key: '/reservations', name: 'Reservas', description: 'Agenda e organização das reservas de mesas.' },
      { key: '/customers', name: 'Clientes e fidelidade', description: 'Cadastro, histórico e relacionamento com clientes.' }
    ]
  },
  {
    id: 'producao',
    name: 'Cozinha e produção',
    description: 'Organização da cozinha, preparo e qualidade.',
    permissions: [
      { key: '/kds', name: 'Painel da cozinha', description: 'Fila de produção e acompanhamento dos pedidos.' },
      { key: '/mise-en-place', name: 'Preparação antecipada', description: 'Planejamento e controle da produção.' },
      { key: '/technical-sheets', name: 'Fichas técnicas', description: 'Receitas, rendimento, insumos e custos.' },
      { key: '/checklists', name: 'Listas de verificação', description: 'Rotinas operacionais e conferências da equipe.' },
      { key: '/temperatures', name: 'Controle de temperaturas', description: 'Registros de segurança e qualidade dos alimentos.' }
    ]
  },
  {
    id: 'cardapios_delivery',
    name: 'Cardápios e entregas',
    description: 'Canais digitais, cardápios e integrações de entrega.',
    permissions: [
      { key: '/menu', name: 'Cardápio da operação', description: 'Produtos, categorias, preços e disponibilidade.' },
      { key: '/menu-builder', name: 'Construtor de cardápios', description: 'Criação e publicação de cardápios digitais.' },
      { key: '/delivery', name: 'Painel de entregas', description: 'Gestão dos pedidos recebidos para entrega.' },
      { key: '/delivery-tracking', name: 'Rastreamento de entregas', description: 'Acompanhamento operacional das entregas em rota.' },
      { key: '/ifood-kds', name: 'Produção do iFood', description: 'Pedidos do iFood integrados à cozinha.' },
      { key: '/ifood-menu', name: 'Cardápio do iFood', description: 'Sincronização e gestão do cardápio no iFood.' },
      { key: '/ifood-store-manager', name: 'Gestão da loja no iFood', description: 'Status e configurações operacionais da integração.' }
    ]
  },
  {
    id: 'estoque',
    name: 'Estoque e compras',
    description: 'Suprimentos, movimentações e abastecimento.',
    permissions: [
      { key: '/inventory', name: 'Controle de estoque', description: 'Saldos, movimentações, validade e custos.' },
      { key: '/requisitions', name: 'Requisições internas', description: 'Solicitações de materiais entre equipes e setores.' },
      { key: '/purchasing', name: 'Central de compras', description: 'Cotações, pedidos e acompanhamento das compras.' },
      { key: '/suppliers', name: 'Fornecedores', description: 'Cadastro e relacionamento com fornecedores.' }
    ]
  },
  {
    id: 'gestao',
    name: 'Gestão e resultados',
    description: 'Visão gerencial, indicadores e comunicação.',
    permissions: [
      { key: '/dashboard', name: 'Painel gerencial', description: 'Indicadores e visão geral do restaurante.' },
      { key: '/performance', name: 'Desempenho', description: 'Metas e acompanhamento dos resultados da operação.' },
      { key: '/reports', name: 'Relatórios', description: 'Análises detalhadas para tomada de decisão.' },
      { key: '/whatsapp', name: 'WhatsApp', description: 'Acesso ao módulo principal de atendimento e integração via WhatsApp.' },
      { key: '/whatsapp-chats', name: 'Conversas do WhatsApp', description: 'Conversas e automações do canal de atendimento.' }
    ]
  },
  {
    id: 'equipe',
    name: 'Equipe e recursos humanos',
    description: 'Pessoas, jornadas, ausências e folha de pagamento.',
    permissions: [
      { key: '/employees', name: 'Funcionários', description: 'Cadastro e gestão da equipe.' },
      { key: '/schedules', name: 'Escalas de trabalho', description: 'Planejamento das jornadas e turnos.' },
      { key: '/time-clock', name: 'Controle de ponto', description: 'Registro e acompanhamento das horas trabalhadas.' },
      { key: '/my-leave', name: 'Minhas ausências', description: 'Solicitações de folgas e ausências do colaborador.' },
      { key: '/leave-management', name: 'Gestão de ausências', description: 'Aprovação e acompanhamento das ausências da equipe.' },
      { key: '/payroll', name: 'Folha de pagamento', description: 'Conferência e fechamento da folha.' }
    ]
  },
  {
    id: 'conta',
    name: 'Conta e configurações',
    description: 'Preferências pessoais, ajuda e configuração do sistema.',
    permissions: [
      { key: '/my-profile', name: 'Meu perfil', description: 'Dados e preferências da conta do colaborador.' },
      { key: '/tutorials', name: 'Central de aprendizagem', description: 'Tutoriais e materiais para aprender a usar o ChefOS.' },
      { key: '/settings', name: 'Configurações do sistema', description: 'Parâmetros gerais e segurança da operação.' }
    ]
  }
];

export const PLAN_PERMISSION_KEYS = PLAN_PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));
