// Conta das parcelas e pagamentos de honorários. Um arquivo só, carregado pela
// tela (dashboard.html) e pelos e-mails do servidor (api/cron/
// verificar-atualizacoes.js), pra tela e e-mail nunca discordarem sobre o que
// está vencido. Por isso não usa import/export: roda como <script> comum e
// também como import de efeito colateral no Node (expõe globalThis.HonCalc).
//
// Modelo: o honorário é o ACORDO (à vista, parcelado ou recorrente). As
// parcelas não ficam gravadas, saem do acordo. O que fica gravado são os
// pagamentos (tabela honorario_pagamentos), abatidos na ordem do vencimento,
// o mais antigo primeiro. Ex.: mensal de R$ 1.500 com R$ 500 adiantados deixa
// R$ 1.000 em aberto no mês; um pagamento maior quita o mês e adianta os
// seguintes, sem ninguém editar mês a mês.
//
// Valores em centavos por dentro (soma de reais em ponto flutuante erra o
// centavo); quem usa recebe reais.
(function () {
  const PERIODO_MESES = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
  const PERIODO_DIAS  = { semanal: 7, quinzenal: 14 };
  const SUFIXO = { mensal: '/mês', quinzenal: '/quinzena', semanal: '/semana', bimestral: '/bimestre',
                   trimestral: '/trimestre', semestral: '/semestre', anual: '/ano' };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  // Trava contra laço sem fim (600 mensalidades = 50 anos).
  const LIMITE_PARCELAS = 600;

  const centavos = v => Math.round((Number(v) || 0) * 100);
  const reais    = c => c / 100;

  // Data local, não UTC: depois das 21h em Brasília o toISOString já é amanhã,
  // e um pagamento do dia 30 caía no mês seguinte.
  function hojeISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Mensal que começa dia 31 vence 28/29 em fevereiro e volta a 31 em março.
  function somarPeriodo(iso, periodicidade, n) {
    const [a, m, d] = iso.split('-').map(Number);
    if (PERIODO_DIAS[periodicidade]) {
      return new Date(Date.UTC(a, m - 1, d + PERIODO_DIAS[periodicidade] * n)).toISOString().slice(0, 10);
    }
    const meses = (PERIODO_MESES[periodicidade] || 1) * n;
    const ultimoDia = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
    return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
  }

  function fimDoMes(iso, mesesAFrente = 0) {
    const [a, m] = iso.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1 + mesesAFrente + 1, 0)).toISOString().slice(0, 10);
  }

  const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);

  // Recorrente: `valor` é o de CADA cobrança. Parcelado e à vista: `valor` é o
  // total. Sem data de vencimento, parcelado/recorrente contam do cadastro.
  function plano(h) {
    const inicio = h.data_vencimento || String(h.created_at || '').slice(0, 10) || null;
    if (h.recorrente) {
      const n = Number(h.parcelas_total) > 0 ? Number(h.parcelas_total) : null;
      return { forma: 'recorrente', n, periodicidade: h.periodicidade || 'mensal', inicio, parcelaC: centavos(h.valor) };
    }
    if (Number(h.parcelas_total) > 1) {
      return { forma: 'parcelado', n: Number(h.parcelas_total), periodicidade: 'mensal', inicio, totalC: centavos(h.valor) };
    }
    return { forma: 'avista', n: 1, periodicidade: null, inicio: h.data_vencimento || null, totalC: centavos(h.valor) };
  }

  // Pagamentos gravados + o que o sistema antigo guardava no próprio
  // honorário, que continua valendo como pagamento sem precisar mexer no
  // banco: `valor_entrada` (entrada informada no cadastro) e status 'pago'
  // (quitado de uma vez, antes de existir registro de pagamento).
  function pagamentosEfetivos(h, pagamentos) {
    const lista = (pagamentos || []).map(p => ({ ...p, valorC: centavos(p.valor) })).filter(p => p.valorC > 0);
    const criado = String(h.created_at || '').slice(0, 10) || null;
    if (centavos(h.valor_entrada) > 0) {
      lista.push({ id: 'legado-entrada', legado: 'entrada', valor: Number(h.valor_entrada), valorC: centavos(h.valor_entrada),
                   data_pagamento: criado, observacao: 'Entrada informada no cadastro' });
    }
    if (h.status === 'pago') {
      const pl = plano(h);
      const jaC = lista.reduce((s, p) => s + p.valorC, 0);
      const devidoC = pl.forma === 'recorrente' ? pl.parcelaC * (pl.n || 1) : pl.totalC;
      if (devidoC - jaC > 0) {
        lista.push({ id: 'legado-pago', legado: 'pago', valor: reais(devidoC - jaC), valorC: devidoC - jaC,
                     data_pagamento: h.data_pagamento || criado, observacao: 'Marcado como pago (antes do registro de pagamentos)' });
      }
    }
    return lista.sort((a, b) => String(a.data_pagamento || '').localeCompare(String(b.data_pagamento || '')));
  }

  function rotulo(pl, venc, n) {
    if (pl.forma === 'avista') return 'À vista';
    if (pl.forma === 'parcelado') return `Parcela ${n}/${pl.n}`;
    if (!venc) return `Cobrança ${n}`;
    const [a, m, d] = venc.split('-');
    return pl.periodicidade === 'mensal' ? `${MESES[Number(m) - 1]}/${a}` : `${d}/${m}/${a}`;
  }

  // Recorrente sem fim: gera até `ate` e, além disso, o que for preciso pra
  // absorver o que já foi pago (adiantamento de vários meses) e deixar uma
  // cobrança em aberto à frente — é ela que vira a "próxima".
  function gerarParcelas(pl, ate, pagoC) {
    if (pl.forma === 'avista') return [{ n: 1, venc: pl.inicio, valorC: pl.totalC }];
    if (!pl.inicio) return [];
    const lista = [];
    if (pl.forma === 'parcelado') {
      const base = Math.floor(pl.totalC / pl.n);
      for (let i = 0; i < pl.n; i++) {
        lista.push({ n: i + 1, venc: somarPeriodo(pl.inicio, 'mensal', i), valorC: i === pl.n - 1 ? pl.totalC - base * (pl.n - 1) : base });
      }
      return lista;
    }
    let acumulado = 0;
    for (let i = 0; i < LIMITE_PARCELAS; i++) {
      if (pl.n && i >= pl.n) break;
      const venc = somarPeriodo(pl.inicio, pl.periodicidade, i);
      if (!pl.n && venc > ate && acumulado > pagoC) break;
      lista.push({ n: i + 1, venc, valorC: pl.parcelaC });
      acumulado += pl.parcelaC;
    }
    return lista;
  }

  // opcoes.hoje: data de referência (o servidor passa a dele).
  // opcoes.ate: até quando gerar as cobranças recorrentes (o calendário pede
  // meses à frente). Padrão: fim do mês que vem.
  function calcular(h, pagamentos, opcoes = {}) {
    const hoje = opcoes.hoje || hojeISO();
    const ate  = opcoes.ate  || fimDoMes(hoje, 1);
    const pl   = plano(h);
    const pags = pagamentosEfetivos(h, pagamentos);
    const pagoC = pags.reduce((s, p) => s + p.valorC, 0);

    let resto = pagoC;
    const parcelas = gerarParcelas(pl, ate, pagoC).map(p => {
      const pagoP  = Math.min(resto, p.valorC);
      resto -= pagoP;
      const faltaC = p.valorC - pagoP;
      const situacao = faltaC === 0 ? 'quitada'
        : p.venc && p.venc < hoje ? 'vencida'
        : pagoP > 0 ? 'parcial' : 'aberta';
      return { n: p.n, venc: p.venc, rotulo: rotulo(pl, p.venc, p.n), situacao,
               valor: reais(p.valorC), pago: reais(pagoP), falta: reais(faltaC),
               _valorC: p.valorC, _pagoC: pagoP, _faltaC: faltaC };
    });

    const finito   = pl.forma !== 'recorrente' || !!pl.n;
    const quitado  = finito && parcelas.length > 0 && parcelas.every(p => p._faltaC === 0);
    const vencidas = parcelas.filter(p => p.situacao === 'vencida');
    const proxima  = parcelas.find(p => p._faltaC > 0) || null;
    let pagoAte = null;
    for (const p of parcelas) { if (p._faltaC === 0) pagoAte = p; else break; }

    // A receber: acordo com total definido (à vista, parcelado) conta tudo o
    // que falta; mensalidade conta só o que vence até o fim deste mês — senão
    // um mensal sem prazo somaria anos à frente.
    const fimMes = fimDoMes(hoje);
    const aReceberC = h.status === 'cancelado' ? 0 : parcelas
      .filter(p => p._faltaC > 0 && (pl.forma !== 'recorrente' || (p.venc && p.venc <= fimMes)))
      .reduce((s, p) => s + p._faltaC, 0);

    let grupo;
    if (h.status === 'cancelado') grupo = 'cancelado';
    else if (quitado) grupo = 'pago';
    else if (vencidas.length) grupo = 'vencido';
    else if (proxima?.venc && diasEntre(hoje, proxima.venc) <= 7) grupo = 'semana';
    else grupo = 'pendente';

    return {
      forma: pl.forma, periodicidade: pl.periodicidade, n: pl.n, finito,
      parcelas, pagamentos: pags.map(({ valorC, ...p }) => ({ ...p, valor: reais(valorC) })),
      totalPago: reais(pagoC), credito: reais(resto), _creditoC: resto,
      totalContrato: finito ? reais(parcelas.reduce((s, p) => s + p._valorC, 0)) : null,
      valorParcela: pl.forma === 'recorrente' ? reais(pl.parcelaC)
        : pl.forma === 'parcelado' ? reais(Math.floor(pl.totalC / pl.n)) : reais(pl.totalC),
      vencidas, emAtraso: reais(vencidas.reduce((s, p) => s + p._faltaC, 0)),
      proxima, pagoAte, quitado, grupo, aReceber: reais(aReceberC),
      ultimoPagamento: pags.length ? pags[pags.length - 1].data_pagamento : null,
    };
  }

  // Prévia do "Registrar pagamento": quais cobranças esse valor quita ou abate.
  function simularPagamento(h, pagamentos, valor, data, opcoes = {}) {
    const antes  = calcular(h, pagamentos, opcoes);
    const depois = calcular(h, [...(pagamentos || []), { id: '_previa', valor, data_pagamento: data }], opcoes);
    const efeitos = depois.parcelas.map(p => {
      const a = antes.parcelas.find(x => x.n === p.n);
      const aplicadoC = p._pagoC - (a ? a._pagoC : 0);
      return aplicadoC > 0 ? { rotulo: p.rotulo, venc: p.venc, aplicado: reais(aplicadoC), quitou: p._faltaC === 0, falta: p.falta } : null;
    }).filter(Boolean);
    return { efeitos, credito: reais(depois._creditoC - antes._creditoC), depois };
  }

  globalThis.HonCalc = {
    hojeISO, somarPeriodo, fimDoMes, diasEntre, plano, pagamentosEfetivos, calcular, simularPagamento,
    sufixoPeriodo: p => SUFIXO[p] || '', MESES,
  };
})();
