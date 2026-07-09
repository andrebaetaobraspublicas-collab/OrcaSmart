async function listUsers(master) {
  return master.all(`
    SELECT u.id_user, u.nome, u.email, u.role, u.status, t.nome AS tenant,
           s.status AS subscription_status
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    ORDER BY u.created_at DESC`);
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

module.exports = { listUsers, listTenants };
