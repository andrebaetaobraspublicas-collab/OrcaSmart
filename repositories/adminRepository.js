async function overview(master) {
  const rows = await master.all(`
    SELECT 'users_total' AS chave, COUNT(*) AS total FROM users
    UNION ALL SELECT 'users_admin', COUNT(*) FROM users WHERE role = 'admin'
    UNION ALL SELECT 'users_owner', COUNT(*) FROM users WHERE role = 'owner'
    UNION ALL SELECT 'users_active', COUNT(*) FROM users WHERE status = 'ativo'
    UNION ALL SELECT 'tenants_total', COUNT(*) FROM tenants
    UNION ALL SELECT 'tenants_active', COUNT(*) FROM tenants WHERE status = 'ativo'
  `);
  const result = {};
  rows.forEach(row => { result[row.chave] = row.total; });

  const subscriptions = await master.all(`
    SELECT COALESCE(status, 'sem_assinatura') AS status, COUNT(*) AS total
    FROM subscriptions
    GROUP BY COALESCE(status, 'sem_assinatura')
    ORDER BY total DESC`);

  return { ...result, subscriptions };
}

async function listUsers(master, filters = {}) {
  let sql = `
    SELECT u.id_user, u.id_tenant, u.nome, u.email, u.role, u.status,
           u.created_at, t.nome AS tenant, t.status AS tenant_status,
           s.status AS subscription_status
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user`;
  const where = [];
  const params = [];

  if (filters.q) {
    where.push('(LOWER(u.nome) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(t.nome) LIKE ?)');
    const q = `%${String(filters.q).toLowerCase()}%`;
    params.push(q, q, q);
  }
  if (filters.role) {
    where.push('u.role = ?');
    params.push(filters.role);
  }
  if (filters.status) {
    where.push('u.status = ?');
    params.push(filters.status);
  }
  if (filters.subscription_status) {
    where.push('COALESCE(s.status, ?) = ?');
    params.push('sem_assinatura', filters.subscription_status);
  }

  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY u.created_at DESC';
  return master.all(sql, params);
}

async function listTenants(master, filters = {}) {
  let sql = `
    SELECT t.id_tenant, t.nome, t.slug, t.db_path, t.status, t.created_at,
           COUNT(u.id_user) AS users_count
    FROM tenants t
    LEFT JOIN users u ON u.id_tenant = t.id_tenant`;
  const params = [];
  const where = [];
  if (filters.id_tenant) {
    where.push('t.id_tenant = ?');
    params.push(filters.id_tenant);
  }
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' GROUP BY t.id_tenant ORDER BY t.created_at DESC';
  return master.all(sql, params);
}

module.exports = { overview, listUsers, listTenants };
