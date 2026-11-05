// Banco DUBLÊ para fotografar o sistema real com dados fictícios.
// Substitui js/supabase-client.js em voo (rota do Playwright). Nada aqui
// fala com o Supabase de verdade — toda gravação é descartada.
(function () {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const d  = n => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const dt = (n, h = '00:00:00') => `${d(n)}T${h}`;
  const iso = (n, h = '09:24:00') => new Date(`${d(n)}T${h}-03:00`).toISOString();
  const UID = 'a1b2c3d4-0000-4000-8000-000000000001';

  const user = {
    id: UID, email: 'helena.prado@pradoadvocacia.com.br',
    created_at: '2026-06-02T13:00:00Z', last_sign_in_at: iso(0, '08:10:00'),
    app_metadata: { providers: ['email'] },
    user_metadata: {
      full_name: 'Helena Marques Prado', nome: 'Helena Marques Prado', oab: 'DF 48215',
      ultimo_acesso: new Date().toISOString(), visao_processos: 'tabela',
      historico_djen: { DF48215: { concluido: iso(-30), ini: d(-395), fim: d(-30), pagina: 1 } },
      onboarding_email_enviado: true,
    },
  };

  const djen = (n, tipo, doc) => ({ nome: `DJEN — ${tipo}${doc ? ' · ' + doc : ''}`, data: dt(n), _fonte: 'djen', _url: 'https://comunicaapi.pje.jus.br/' });
  const mov  = (n, nome, h = '10:12:00') => ({ nome, data: dt(n, h) });

  const P = (id, o) => Object.assign({
    id: 'p' + id, user_id: UID, status: 'Ativo', area: 'Cível', favorito: false, importante: false,
    notificacao_pendente: false, novos_movimentos: null, notas_manuais: [], historico_numeros: [],
    created_at: iso(-60 - id), ultima_verificacao: iso(0, '06:31:00'), parte_contraria: '',
    numero_registro_superior: null, movimentos_hash: 'x', sync_falhas: 0,
  }, o);

  const processos = [
    P(1, { numero: '0712849-33.2026.8.07.0001', nome: 'Procedimento Comum Cível', classe: 'Procedimento Comum Cível',
      apelido: 'Cobrança — obra Vila Ipê', cliente: 'Construtora Serra Dourada Ltda.', parte_contraria: 'Condomínio Residencial Vila Ipê',
      tribunal: 'TJDFT', orgao_julgador: '3ª Vara Cível de Brasília', datajud_index: 'api_publica_tjdft', favorito: true,
      notificacao_pendente: true, novos_movimentos: [djen(0, 'Intimação', 'Decisão')],
      movimentos_recentes: [djen(0, 'Intimação', 'Decisão'), mov(-1, 'Decisão Interlocutória'), mov(-9, 'Conclusos para decisão'), mov(-14, 'Juntada de Petição de réplica'), mov(-30, 'Audiência de conciliação realizada sem acordo')] }),
    P(2, { numero: '5022817-64.2025.8.09.0051', nome: 'Procedimento Comum Cível', classe: 'Procedimento Comum Cível',
      cliente: 'Marisa Teodoro Albuquerque', parte_contraria: 'Banco Cerrado S.A.', tribunal: 'TJGO', orgao_julgador: '7ª Vara Cível de Goiânia',
      datajud_index: 'api_publica_tjgo', notificacao_pendente: true, novos_movimentos: [djen(0, 'Intimação', 'Despacho')],
      movimentos_recentes: [djen(0, 'Intimação', 'Despacho'), mov(-6, 'Juntada de laudo pericial'), mov(-21, 'Nomeação de perito')] }),
    P(3, { numero: '0009342-18.2026.5.10.0004', nome: 'Ação Trabalhista - Rito Ordinário', classe: 'Ação Trabalhista - Rito Ordinário',
      area: 'Trabalhista', cliente: 'Rodrigo Almeida Duarte', parte_contraria: 'Transportes Lago Norte Ltda.', tribunal: 'TRT10',
      orgao_julgador: '4ª Vara do Trabalho de Brasília', datajud_index: 'api_publica_trt10', favorito: true,
      notificacao_pendente: true, novos_movimentos: [mov(-1, 'Designada audiência de instrução')],
      movimentos_recentes: [mov(-1, 'Designada audiência de instrução'), mov(-12, 'Contestação apresentada'), mov(-40, 'Distribuído por sorteio')] }),
    P(4, { numero: '0703117-52.2025.8.07.0016', nome: 'Procedimento do Juizado Especial Cível', classe: 'Procedimento do Juizado Especial Cível',
      apelido: 'Voo cancelado — indenização', cliente: 'Luciana Prates Holanda', parte_contraria: 'Aérea Planalto S.A.', tribunal: 'TJDFT',
      orgao_julgador: '2º Juizado Especial Cível de Brasília', datajud_index: 'api_publica_tjdft',
      movimentos_recentes: [mov(-3, 'Sentença de procedência'), mov(-20, 'Conclusos para sentença'), mov(-35, 'Audiência de conciliação')] }),
    P(5, { numero: '1031845-07.2025.4.01.3400', nome: 'Procedimento Comum Cível', classe: 'Procedimento Comum Cível', area: 'Previdenciário',
      cliente: 'Ademir Vasconcelos Rocha', parte_contraria: 'Instituto Nacional do Seguro Social', tribunal: 'TRF1',
      orgao_julgador: '14ª Vara Federal Cível da SJDF', datajud_index: 'api_publica_trf1',
      movimentos_recentes: [mov(-4, 'Juntada de Contestação'), mov(-25, 'Citação expedida')] }),
    P(6, { numero: '0745520-91.2024.8.07.0001', nome: 'Execução de Título Extrajudicial', classe: 'Execução de Título Extrajudicial',
      cliente: 'Padaria Pão do Lago ME', parte_contraria: 'Mercearia Bom Preço Ltda.', tribunal: 'TJDFT', orgao_julgador: '19ª Vara Cível de Brasília',
      datajud_index: 'api_publica_tjdft', movimentos_recentes: [djen(-5, 'Intimação', 'Ato ordinatório'), mov(-5, 'Penhora on-line (SISBAJUD) positiva'), mov(-18, 'Expedição de mandado')] }),
    P(7, { numero: '0812264-40.2023.8.07.0003', nome: 'Divórcio Litigioso', classe: 'Divórcio Litigioso', area: 'Família',
      cliente: 'Joana Fontes Ribeiro', tribunal: 'TJDFT', orgao_julgador: '1ª Vara de Família de Ceilândia', datajud_index: 'api_publica_tjdft',
      movimentos_recentes: [mov(-7, 'Estudo psicossocial juntado'), mov(-33, 'Audiência de mediação')] }),
    P(8, { numero: '0001478-63.2026.5.10.0011', nome: 'Ação Trabalhista - Rito Sumaríssimo', classe: 'Ação Trabalhista - Rito Sumaríssimo',
      area: 'Trabalhista', cliente: 'Clínica Sorriso Norte Ltda.', parte_contraria: 'Thaís Bezerra Mourão', tribunal: 'TRT10',
      orgao_julgador: '11ª Vara do Trabalho de Brasília', datajud_index: 'api_publica_trt10',
      movimentos_recentes: [mov(-8, 'Juntada de procuração'), mov(-15, 'Notificação inicial')] }),
    P(9, { numero: '0734602-10.2021.8.02.0001', nome: 'Agravo em Recurso Especial', classe: 'Agravo em Recurso Especial',
      cliente: 'Cooperativa Agrícola Vale do Paranã', parte_contraria: 'Fazenda Três Barras S.A.', tribunal: 'STJ', orgao_julgador: 'Terceira Turma',
      datajud_index: 'api_publica_stj', numero_registro_superior: 'AREsp 3254978',
      historico_numeros: [{ numero: '0734602-10.2021.8.02.0001', etiqueta: '1ª instância', origem: 'cadastro' }, { numero: 'AREsp 3254978', etiqueta: 'STJ', origem: 'fila_stj' }],
      movimentos_recentes: [mov(-10, 'Conclusos ao Relator'), mov(-28, 'Distribuído por prevenção')] }),
    P(10, { numero: '0707781-25.2025.8.07.0020', nome: 'Despejo por Falta de Pagamento', classe: 'Despejo por Falta de Pagamento',
      cliente: 'Imobiliária Alvorada do Cerrado', parte_contraria: 'Gustavo Pimentel Arruda', tribunal: 'TJDFT', orgao_julgador: '1ª Vara Cível de Águas Claras',
      datajud_index: 'api_publica_tjdft', movimentos_recentes: [mov(-11, 'Mandado de despejo expedido'), mov(-26, 'Sentença')] }),
    P(11, { numero: '5103394-70.2024.8.13.0024', nome: 'Inventário', classe: 'Inventário', area: 'Família',
      cliente: 'Espólio de Arlindo Queiroz Neto', tribunal: 'TJMG', orgao_julgador: '2ª Vara de Sucessões de Belo Horizonte',
      datajud_index: 'api_publica_tjmg', movimentos_recentes: [mov(-16, 'Primeiras declarações apresentadas')] }),
    P(12, { numero: '1009933-58.2026.8.26.0100', nome: 'Monitória', classe: 'Monitória', cliente: 'Distribuidora Ipiranga Sul Ltda.',
      parte_contraria: 'Comercial Moraes & Filhos', tribunal: 'TJSP', orgao_julgador: '32ª Vara Cível do Foro Central',
      datajud_index: 'api_publica_tjsp', movimentos_recentes: [mov(-19, 'Citação por carta')] }),
  ];

  const eventos = [
    { id: 'e1', user_id: UID, titulo: 'Reunião com Serra Dourada — estratégia do recurso', tipo: 'reuniao', data: d(0), hora: '16:00', urgencia: 'media', concluido: false, processo_id: 'p1' },
    { id: 'e2', user_id: UID, titulo: 'Audiência de instrução — Rodrigo x Lago Norte', tipo: 'audiencia', data: d(1), hora: '14:30', urgencia: 'alta', concluido: false, processo_id: 'p3' },
    { id: 'e3', user_id: UID, titulo: 'Prazo: manifestação sobre o laudo (Marisa)', tipo: 'prazo_processual', data: d(2), urgencia: 'alta', concluido: false, processo_id: 'p2' },
    { id: 'e4', user_id: UID, titulo: 'Prazo: embargos à execução', tipo: 'prazo_processual', data: d(4), urgencia: 'media', concluido: false, processo_id: 'p6' },
    { id: 'e5', user_id: UID, titulo: 'Retorno à cliente Luciana sobre a sentença', tipo: 'lembrete', data: d(0), urgencia: 'baixa', concluido: true, concluido_em: iso(0, '10:05:00'), processo_id: 'p4' },
    { id: 'e6', user_id: UID, titulo: 'Prazo: réplica — INSS', tipo: 'prazo_processual', data: d(9), urgencia: 'media', concluido: false, processo_id: 'p5' },
  ];

  const tarefas = [
    { id: 't1', user_id: UID, titulo: 'Minutar manifestação sobre o laudo pericial', coluna: 'em_andamento', prioridade: 'urgente', prazo: d(2), processo_id: 'p2', quadro_id: null, created_at: iso(-3), updated_at: iso(0, '09:40:00'), updated_by_nome: 'Helena Marques Prado' },
    { id: 't2', user_id: UID, titulo: 'Preparar rol de testemunhas — audiência de instrução', coluna: 'a_fazer', prioridade: 'urgente', prazo: d(1), processo_id: 'p3', quadro_id: null, created_at: iso(-5), updated_at: iso(-1) },
    { id: 't3', user_id: UID, titulo: 'Calcular atualização do débito (SISBAJUD)', coluna: 'a_fazer', prioridade: 'media', prazo: d(4), processo_id: 'p6', quadro_id: null, created_at: iso(-2), updated_at: iso(-2) },
    { id: 't4', user_id: UID, titulo: 'Revisar contrato de honorários — Clínica Sorriso Norte', coluna: 'revisao', prioridade: 'baixa', prazo: d(6), processo_id: 'p8', quadro_id: null, created_at: iso(-6), updated_at: iso(-1) },
    { id: 't5', user_id: UID, titulo: 'Protocolar primeiras declarações', coluna: 'concluida', prioridade: 'media', prazo: d(-2), processo_id: 'p11', quadro_id: null, created_at: iso(-9), updated_at: iso(-2) },
    { id: 't6', user_id: UID, titulo: 'Avisar Luciana da sentença e prazo de recurso da ré', coluna: 'a_fazer', prioridade: 'media', prazo: d(3), processo_id: 'p4', quadro_id: null, created_at: iso(-1), updated_at: iso(-1) },
  ];

  const honorarios = [
    { id: 'h1', user_id: UID, cliente_nome: 'Construtora Serra Dourada Ltda.', descricao: 'Parcela 3/6 — contrato de êxito', valor: 4800, data_vencimento: d(3), status: 'pendente', tipo: 'parcelado', processo_id: 'p1', created_at: iso(-40) },
    { id: 'h2', user_id: UID, cliente_nome: 'Padaria Pão do Lago ME', descricao: 'Honorários iniciais — execução', valor: 1500, data_vencimento: d(-2), status: 'vencido', tipo: 'fixo', processo_id: 'p6', created_at: iso(-20) },
    { id: 'h3', user_id: UID, cliente_nome: 'Luciana Prates Holanda', descricao: '30% sobre a condenação', valor: 2340, data_vencimento: d(20), status: 'pendente', tipo: 'exito', processo_id: 'p4', created_at: iso(-3) },
    { id: 'h4', user_id: UID, cliente_nome: 'Rodrigo Almeida Duarte', descricao: 'Entrada', valor: 1200, data_vencimento: d(-15), status: 'pago', data_pagamento: d(-15), tipo: 'fixo', processo_id: 'p3', created_at: iso(-50) },
    // Histórico de recebimentos pra o gráfico dos 6 meses não aparecer zerado
    ...[[-2, 6300, 'Construtora Serra Dourada Ltda.', 'Parcela 2/6 — contrato de êxito'], [-24, 2900, 'Clínica Sorriso Norte Ltda.', 'Mensalidade — consultivo trabalhista'],
        [-31, 1700, 'Padaria Pão do Lago ME', 'Honorários — notificação extrajudicial'], [-52, 4100, 'Construtora Serra Dourada Ltda.', 'Parcela 1/6 — contrato de êxito'],
        [-63, 2900, 'Clínica Sorriso Norte Ltda.', 'Mensalidade — consultivo trabalhista'], [-88, 3300, 'Imobiliária Alvorada do Cerrado', 'Despejo — honorários iniciais'],
        [-118, 2600, 'Joana Fontes Ribeiro', 'Divórcio — 2ª parcela'], [-146, 2150, 'Ademir Vasconcelos Rocha', 'Previdenciário — entrada']]
      .map(([n, valor, cliente_nome, descricao], i) => ({ id: 'hp' + i, user_id: UID, cliente_nome, descricao, valor, data_vencimento: d(n), status: 'pago', data_pagamento: d(n), tipo: 'fixo', created_at: iso(n - 10) })),
  ];

  const clientes = [...new Set(processos.map(p => p.cliente))].map((nome, i) => ({ id: 'c' + i, user_id: UID, nome, created_at: iso(-60) }));

  const tabelas = {
    processos, eventos, tarefas, honorarios, clientes,
    assinaturas: [{ escritorio_id: UID, plano: 'anual', status: 'ativo', data_expiracao: iso(240) }],
    admins: [], colaboradores: [], processo_compartilhamentos: [], quadro_compartilhamentos: [], quadros: [],
    documentos: [], tarefa_comentarios: [], solicitacoes_licenca: [], convites: [], fila_consulta_stj: [],
  };
  window.__dubla = { tabelas, hoje: d(0) };

  function consulta(tabela) {
    let linhas = [...(tabelas[tabela] || [])];
    let head = false, single = false, maybe = false, escrita = false;
    const q = {
      select(_c, o) { if (o?.head) head = true; return q; },
      eq(c, v)  { if (!escrita) linhas = linhas.filter(r => r[c] === undefined || r[c] === v || String(r[c]) === String(v)); return q; },
      neq(c, v) { if (!escrita) linhas = linhas.filter(r => r[c] !== v); return q; },
      in(c, a)  { if (!escrita) linhas = linhas.filter(r => a.includes(r[c])); return q; },
      gt(c, v)  { if (!escrita) linhas = linhas.filter(r => r[c] == null || r[c] > v); return q; },
      gte(c, v) { if (!escrita) linhas = linhas.filter(r => r[c] == null || r[c] >= v); return q; },
      lt(c, v)  { if (!escrita) linhas = linhas.filter(r => r[c] == null || r[c] < v); return q; },
      lte(c, v) { if (!escrita) linhas = linhas.filter(r => r[c] == null || r[c] <= v); return q; },
      is(c, v)  { if (!escrita) linhas = linhas.filter(r => (r[c] ?? null) === v); return q; },
      not(c, op, v) { if (!escrita && op === 'is' && v === null) linhas = linhas.filter(r => r[c] != null); return q; },
      or() { return q; }, ilike() { return q; }, like() { return q; }, filter() { return q; }, match() { return q; }, contains() { return q; },
      order(c, o = {}) { const asc = o.ascending !== false; linhas.sort((a, b) => String(a[c] ?? '').localeCompare(String(b[c] ?? '')) * (asc ? 1 : -1)); return q; },
      limit(n) { linhas = linhas.slice(0, n); return q; },
      range(a, b) { linhas = linhas.slice(a, b + 1); return q; },
      single() { single = true; return q; }, maybeSingle() { maybe = true; return q; },
      insert() { escrita = true; linhas = []; return q; }, update() { escrita = true; return q; },
      upsert() { escrita = true; linhas = []; return q; }, delete() { escrita = true; return q; },
      then(ok, err) {
        const r = escrita ? { data: null, error: null }
          : head ? { data: null, error: null, count: linhas.length }
          : single || maybe ? { data: linhas[0] ?? null, error: null }
          : { data: linhas, error: null, count: linhas.length };
        return Promise.resolve(r).then(ok, err);
      },
    };
    return q;
  }

  const session = { access_token: 'dubla', user };
  window._supabase = {
    from: consulta,
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user } }),
      updateUser: async (o) => ({ data: { user: { ...user, user_metadata: { ...user.user_metadata, ...(o?.data || {}) } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    storage: { from: () => ({ upload: async () => ({}), remove: async () => ({}), list: async () => ({ data: [] }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: { signedUrl: '#' } }) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    rpc: async () => ({ data: null, error: null }),
  };
})();
var _supabase = window._supabase;
