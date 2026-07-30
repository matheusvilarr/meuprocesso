// Vercel Serverless Function — proxy para DataJud CNJ
// Suporta busca por: número CNJ, OAB, nome do advogado, nome do cliente, CPF

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { tipo = 'numero', numero, q, tribunal, uf } = req.query;

  const DATAJUD_KEY = process.env.DATAJUD_API_KEY
    || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

  // ── BUSCA POR NÚMERO CNJ ───────────────────────────────────────────────
  if (tipo === 'numero') {
    if (!numero || numero.trim().length < 10) {
      return res.status(400).json({ erro: 'Informe o número do processo no formato CNJ.' });
    }

    const numeroLimpo    = numero.replace(/[.\-\/ ]/g, '');
    const tribunalIndex  = tribunal || detectarTribunal(numero.trim());

    if (!tribunalIndex) {
      return res.status(422).json({
        erro: 'Tribunal não identificado. Verifique o formato: 0000000-00.0000.0.00.0000'
      });
    }

    const body = { size: 1, query: { match: { numeroProcesso: numeroLimpo } } };
    const hits  = await chamarDatajud(tribunalIndex, body, DATAJUD_KEY);

    if (!hits || hits._erro) return res.status(502).json({ erro: erroDetalhe(hits) });
    if (!hits.length) return res.status(404).json({ erro: 'Processo não encontrado neste tribunal.' });

    return res.status(200).json({ resultados: [normalizarProcesso(hits[0]._source, tribunalIndex)] });
  }

  // ── BUSCAS QUE PRECISAM DE TRIBUNAL ───────────────────────────────────
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ erro: 'Informe ao menos 2 caracteres para buscar.' });
  }
  if (!tribunal) {
    return res.status(400).json({ erro: 'Selecione o tribunal para este tipo de busca.' });
  }

  let query;

  switch (tipo) {

    // OAB: uf + número (ex: UF=SP q=59360 → "SP59360", "SP 59360", "59360")
    case 'oab': {
      const oabNum  = q.replace(/\D/g, '');
      const ufUpper = (uf || '').toUpperCase();
      const variantes = ufUpper
        ? [ufUpper + oabNum, ufUpper + ' ' + oabNum, oabNum]
        : [oabNum];
      query = {
        bool: {
          should: variantes.map(v => ({ match: { 'partes.advogados.OAB': v } })),
          minimum_should_match: 1
        }
      };
      break;
    }

    // Nome do advogado — minimum_should_match evita homônimos sem quebrar em stop words ("dos","da","de")
    case 'advogado': {
      const palavras = q.trim().split(/\s+/).filter(Boolean);
      // 1 palavra → tudo casa; 2 → ambas; 3+ → 75% (ex: "Suzana Vilar dos Santos" = 3 de 4)
      const msm = palavras.length >= 3 ? '75%' : palavras.length === 2 ? 2 : 1;
      query = {
        match: {
          'partes.advogados.nome': {
            query:                q,
            fuzziness:            'AUTO',
            minimum_should_match: msm,
          }
        }
      };
      break;
    }

    // Nome do cliente (parte do processo)
    case 'cliente': {
      const palavrasC = q.trim().split(/\s+/).filter(Boolean);
      const msmC = palavrasC.length >= 3 ? '75%' : palavrasC.length === 2 ? 2 : 1;
      query = {
        match: {
          'partes.nome': {
            query:                q,
            fuzziness:            'AUTO',
            minimum_should_match: msmC,
          }
        }
      };
      break;
    }

    // CPF ou CNPJ
    case 'cpf': {
      const docLimpo = q.replace(/\D/g, '');
      query = {
        bool: {
          should: [
            { match: { 'partes.cpf':       docLimpo } },
            { match: { 'partes.cnpj':      docLimpo } },
            { match: { 'partes.documento': docLimpo } },
          ],
          minimum_should_match: 1
        }
      };
      break;
    }

    default:
      return res.status(400).json({ erro: 'Tipo de busca inválido.' });
  }

  // Pega 50 resultados sem sort fixo no servidor — o cliente ordena por movimento mais recente.
  // Sort server-side por dataAjuizamento como tiebreaker (garante resultados recentes).
  const body = {
    size: 50,
    query,
    sort: [
      { dataAjuizamento: { order: 'desc', missing: '_last', unmapped_type: 'date' } },
    ],
  };

  const hits  = await chamarDatajud(tribunal, body, DATAJUD_KEY);

  if (!hits || hits._erro) return res.status(502).json({ erro: erroDetalhe(hits) });
  if (!hits.length) return res.status(404).json({ erro: 'Nenhum resultado encontrado.' });

  return res.status(200).json({ resultados: hits.map(h => normalizarProcesso(h._source, tribunal)) });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function erroDetalhe(hits) {
  if (!hits) return 'Erro ao consultar o DataJud.';
  const shardReason = hits.detail?.error?.failed_shards?.[0]?.reason?.reason;
  const rootReason  = hits.detail?.error?.root_cause?.[0]?.reason;
  const topReason   = hits.detail?.error?.reason;
  const motivo = shardReason || rootReason || topReason || JSON.stringify(hits.detail);
  return `Erro DataJud (${hits.status}): ${motivo}`;
}

async function chamarDatajud(index, body, key) {
  try {
    const r = await fetch(
      `https://api-publica.datajud.cnj.jus.br/${index}/_search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${key}`,
          'Content-Type':  'application/json'
        },
        signal: AbortSignal.timeout(28000),
        body: JSON.stringify(body)
      }
    );
    const buffer = await r.arrayBuffer();
    const text   = decodificarBuffer(buffer);
    const d      = JSON.parse(text);
    if (!r.ok) return { _erro: true, status: r.status, detail: d };
    return d.hits?.hits || [];
  } catch (e) {
    return { _erro: true, status: 0, detail: e.message };
  }
}

function decodificarBuffer(buffer) {
  // Tenta UTF-8 estrito; se falhar (bytes inválidos de sistemas legados brasileiros),
  // faz fallback para Windows-1252 (ISO-8859-1 estendido, padrão histórico em tribunais).
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function normalizarProcesso(p, index) {
  return {
    numero:          formatarNumero(p.numeroProcesso),
    tribunal:        p.tribunal,
    _datajudIndex:   index || null,
    classe:          p.classe?.nome        || null,
    assuntos:        (p.assuntos || []).map(a => a.nome),
    orgaoJulgador:   p.orgaoJulgador?.nome || null,
    dataAjuizamento: parsarData(p.dataAjuizamento),
    grau:            p.grau                || null,
    nivelSigilo:     p.nivelSigilo ?? null,
    partes:          (p.partes || []).map(parte => ({
      nome:  parte.nome,
      tipo:  parte.tipoParte?.descricao || parte.tipoParte?.nome || parte.tipo || '',
      oab:   parte.advogados?.[0]?.OAB || parte.advogados?.[0]?.oab || parte.oab || null
    })),
    movimentos: (p.movimentos || [])
      .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
      .slice(0, 100)
      .map(m => ({ nome: m.nome, data: m.dataHora }))
  };
}

function parsarData(s) {
  if (!s) return null;
  const str = String(s);
  // Formato DataJud: yyyyMMddHHmmss (14 dígitos) ou yyyyMMdd (8 dígitos)
  if (/^\d{14}$/.test(str)) {
    return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}`;
  }
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  }
  return s; // já é ISO ou outro formato
}

function formatarNumero(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  if (s.length !== 20) return num;
  return `${s.slice(0,7)}-${s.slice(7,9)}.${s.slice(9,13)}.${s.slice(13,14)}.${s.slice(14,16)}.${s.slice(16)}`;
}

function detectarTribunal(numero) {
  const match = numero.match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
  if (!match) return null;
  const j = match[1], tt = parseInt(match[2], 10);
  switch (j) {
    case '1': return 'api_publica_stf';
    case '3': return 'api_publica_stj';
    case '4': return tt >= 1 && tt <= 6  ? `api_publica_trf${tt}` : null;
    case '5': return tt >= 1 && tt <= 24 ? `api_publica_trt${tt}` : null;
    case '6': return ESTADOS[tt] ? `api_publica_tre-${ESTADOS[tt]}` : null;
    case '7':
      if (tt === 8)  return 'api_publica_tjmsp';
      if (tt === 13) return 'api_publica_tjmmg';
      if (tt === 21) return 'api_publica_tjmrs';
      return null;
    case '8': return tt === 7 ? 'api_publica_tjdft' : (ESTADOS[tt] ? `api_publica_tj${ESTADOS[tt]}` : null);
    case '9': return 'api_publica_tjdft';
    default:  return null;
  }
}

const ESTADOS = {
  1:'ac',2:'al',3:'ap',4:'am',5:'ba',6:'ce',7:'df',
  8:'es',9:'go',10:'ma',11:'mt',12:'ms',13:'mg',14:'pa',
  15:'pb',16:'pr',17:'pe',18:'pi',19:'rj',20:'rn',21:'rs',
  22:'ro',23:'rr',24:'sc',25:'se',26:'sp',27:'to'
};
