// Processos novos encontrados pelo cron via busca por OAB, ainda não cadastrados.
//   GET  /api/processos-descobertos               -> { descobertos: [...] } (pendentes do usuário logado)
//   POST /api/processos-descobertos { id, acao }   -> acao: 'ignorar' | 'marcar-importado'

import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });
  const token = auth.slice(7);

  const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ erro: 'Token inválido' });

  const supaAuth = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  if (req.method === 'GET') {
    const { data, error } = await supaAuth
      .from('processos_descobertos')
      .select('id, numero, tribunal, dados, data_ajuizamento, encontrado_em')
      .eq('user_id', user.id)
      .eq('status', 'pendente')
      .order('encontrado_em', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    return res.json({ descobertos: data || [] });
  }

  if (req.method === 'POST') {
    const { id, acao } = req.body || {};
    if (!id || !['ignorar', 'marcar-importado'].includes(acao)) {
      return res.status(400).json({ erro: 'id e acao válida são obrigatórios.' });
    }

    const { data: row } = await supaAuth
      .from('processos_descobertos')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!row) return res.status(404).json({ erro: 'Não encontrado.' });
    if (row.status !== 'pendente') return res.status(422).json({ erro: 'Esse item já foi decidido.' });

    const status = acao === 'ignorar' ? 'ignorado' : 'importado';
    const { error } = await supaAuth
      .from('processos_descobertos')
      .update({ status, decidido_em: new Date().toISOString() })
      .eq('id', id);
    if (error) return res.status(500).json({ erro: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}
