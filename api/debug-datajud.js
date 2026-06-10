// Endpoint de diagnóstico do DataJud
// Modos:
//   /api/debug-datajud?tribunal=api_publica_tjsp              → 1 documento de amostra
//   /api/debug-datajud?tribunal=api_publica_tjsp&mode=mapping → mapeamento completo dos campos
//   /api/debug-datajud?tribunal=api_publica_tjsp&mode=partes  → primeiro doc que tenha partes
export default async function handler(req, res) {
  const { tribunal = 'api_publica_tjsp', mode = 'sample' } = req.query;

  const KEY = process.env.DATAJUD_API_KEY
    || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

  const headers = { 'Authorization': `ApiKey ${KEY}`, 'Content-Type': 'application/json' };
  const base    = `https://api-publica.datajud.cnj.jus.br`;

  if (mode === 'mapping') {
    const r = await fetch(`${base}/${tribunal}/_mapping`, { headers });
    const d = await r.json();
    // Extrai só as propriedades de campos (evita resposta gigante)
    const props = d[tribunal]?.mappings?.properties
               || Object.values(d)[0]?.mappings?.properties
               || d;
    return res.json(props);
  }

  if (mode === 'partes') {
    const r = await fetch(`${base}/${tribunal}/_search`, {
      method: 'POST', headers,
      body: JSON.stringify({
        size: 1,
        query: { exists: { field: 'partes' } },
        _source: ['partes', 'numeroProcesso', 'tribunal']
      })
    });
    const d = await r.json();
    return res.json(d.hits?.hits?.[0]?._source || { aviso: 'Nenhum doc com partes encontrado', raw: d });
  }

  // default: sample
  const r = await fetch(`${base}/${tribunal}/_search`, {
    method: 'POST', headers,
    body: JSON.stringify({ size: 1, query: { match_all: {} } })
  });
  const d = await r.json();
  return res.json(d.hits?.hits?.[0]?._source || d);
}
