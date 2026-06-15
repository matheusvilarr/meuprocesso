import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  const SUPA_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const token = req.headers['authorization']?.slice(7);
  if (!token) return res.status(401).json({ erro: 'Não autorizado.' });

  const userClient = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ erro: 'Token inválido.' });

  const { titulo, tipo, data, processo_id, urgencia, notificar_antes, escritorio_id } = req.body || {};
  if (!titulo || !data) return res.status(400).json({ erro: 'Título e data são obrigatórios.' });

  // Se vier escritorio_id, valida que o usuário é colaborador ativo desse escritório
  let targetUserId = user.id;
  if (escritorio_id && escritorio_id !== user.id) {
    const supaAdmin = createClient(SUPA_URL, SUPA_SVC_KEY);
    const { data: colab } = await supaAdmin
      .from('colaboradores')
      .select('id')
      .eq('escritorio_id', escritorio_id)
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .maybeSingle();
    if (!colab) return res.status(403).json({ erro: 'Acesso negado a este escritório.' });
    targetUserId = escritorio_id;
  }

  // Usa service role quando colaborador insere sob user_id do titular (RLS bloquearia)
  const insertClient = targetUserId !== user.id
    ? createClient(SUPA_URL, SUPA_SVC_KEY)
    : createClient(SUPA_URL, SUPA_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

  const { data: evento, error: insErr } = await insertClient.from('eventos').insert({
    user_id:         targetUserId,
    titulo,
    tipo:            tipo            || 'lembrete',
    data,
    processo_id:     processo_id     || null,
    urgencia:        urgencia        || 'baixa',
    notificar_antes: notificar_antes ?? 1,
  }).select().single();

  if (insErr) return res.status(500).json({ erro: insErr.message });

  // Email de confirmação removido — o evento aparece no digest matinal do dia seguinte

  return res.status(200).json({ ok: true, evento });
}
