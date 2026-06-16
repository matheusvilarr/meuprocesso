import { getAdminClient, requireAdmin } from './_lib.js';

export default async function handler(req, res) {
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

  const { data: usersList, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return res.status(500).json({ erro: usersErr.message });
  const users = usersList?.users || [];

  const { data: processosRows } = await admin
    .from('processos')
    .select('user_id')
    .neq('status', 'Arquivado');
  const contagem = {};
  for (const p of processosRows || []) {
    contagem[p.user_id] = (contagem[p.user_id] || 0) + 1;
  }

  const { data: adminsRows } = await admin.from('admins').select('user_id, nivel');
  const adminMap = {};
  for (const a of adminsRows || []) adminMap[a.user_id] = a.nivel;

  const advogados = users
    .map(u => ({
      id:           u.id,
      nome:         u.user_metadata?.full_name || u.user_metadata?.nome || '—',
      email:        u.email,
      oab:          u.user_metadata?.oab || '—',
      criadoEm:     u.created_at,
      ultimoLogin:  u.last_sign_in_at || null,
      bloqueado:    !!(u.banned_until && new Date(u.banned_until) > new Date()),
      numProcessos: contagem[u.id] || 0,
      nivelAdmin:   adminMap[u.id] || null,
    }))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const { data: codigos } = await admin
    .from('codigos_acesso')
    .select('id, codigo, descricao, ativo, usos_max, usos_atual, created_at')
    .order('created_at', { ascending: false });

  return res.json({ ok: true, advogados, codigos: codigos || [], meuNivel: adminUser.nivel });
}
