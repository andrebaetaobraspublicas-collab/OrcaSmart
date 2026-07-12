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

async function listSubscriptions(master, filters = {}) {
  let sql = `
    SELECT u.id_user, u.nome, u.email, u.role, u.status AS user_status,
           t.id_tenant, t.nome AS tenant, t.status AS tenant_status,
           s.id_subscription, COALESCE(s.status, 'sem_assinatura') AS subscription_status,
           s.stripe_subscription_id, COALESCE(s.stripe_customer_id, u.stripe_customer_id) AS stripe_customer_id,
           s.current_period_end, s.created_at AS subscription_created_at, s.updated_at AS subscription_updated_at
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
  if (filters.status) {
    where.push('COALESCE(s.status, ?) = ?');
    params.push('sem_assinatura', filters.status);
  }
  if (filters.tenant_status) {
    where.push('t.status = ?');
    params.push(filters.tenant_status);
  }

  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY u.created_at DESC, u.id_user DESC';
  return master.all(sql, params);
}

async function getUserSubscription(master, idUser) {
  return master.get(`
    SELECT u.id_user, u.nome, u.email, u.role, u.status AS user_status,
           t.id_tenant, t.nome AS tenant, t.status AS tenant_status,
           s.id_subscription, COALESCE(s.status, 'sem_assinatura') AS subscription_status,
           s.stripe_subscription_id, COALESCE(s.stripe_customer_id, u.stripe_customer_id) AS stripe_customer_id,
           s.current_period_end, s.created_at AS subscription_created_at, s.updated_at AS subscription_updated_at
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    WHERE u.id_user = ?`, [idUser]);
}

async function upsertUserSubscription(master, idUser, data = {}) {
  const existing = await master.get('SELECT id_subscription FROM subscriptions WHERE id_user = ?', [idUser]);
  if (existing) {
    const fields = [];
    const params = [];
    if (data.status) {
      fields.push('status = ?');
      params.push(data.status);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'current_period_end')) {
      fields.push('current_period_end = ?');
      params.push(data.current_period_end);
    }
    if (!fields.length) return { changes: 0 };
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(idUser);
    return master.run(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id_user = ?`, params);
  }

  return master.run(`
    INSERT INTO subscriptions (id_user, status, current_period_end, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [
      idUser,
      data.status || 'trial',
      Object.prototype.hasOwnProperty.call(data, 'current_period_end') ? data.current_period_end : null,
    ]);
}

async function listTenants(master, filters = {}) {
  let sql = `
    SELECT t.id_tenant, t.nome, t.slug, t.db_path, t.status, t.created_at,
           COUNT(u.id_user) AS users_count
    FROM tenants t
    LEFT JOIN users u ON u.id_tenant = t.id_tenant`;
  const params = [];
  const where = [];
  if (filters.q) {
    where.push('(LOWER(t.nome) LIKE ? OR LOWER(t.slug) LIKE ? OR LOWER(t.db_path) LIKE ?)');
    const q = `%${String(filters.q).toLowerCase()}%`;
    params.push(q, q, q);
  }
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

async function listTenantUsers(master, idTenant) {
  return master.all(`
    SELECT u.id_user, u.nome, u.email, u.role, u.status, u.created_at,
           s.status AS subscription_status, s.current_period_end
    FROM users u
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    WHERE u.id_tenant = ?
    ORDER BY u.created_at DESC`, [idTenant]);
}

async function getUser(master, idUser) {
  return master.get(`
    SELECT u.id_user, u.id_tenant, u.nome, u.email, u.role, u.status,
           t.nome AS tenant, s.status AS subscription_status
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    WHERE u.id_user = ?`, [idUser]);
}

async function getUserByEmail(master, email) {
  return master.get('SELECT id_user, email FROM users WHERE lower(email) = lower(?)', [email]);
}

async function createTenant(master, data = {}) {
  return master.run(
    'INSERT INTO tenants (nome, slug, db_path, status) VALUES (?, ?, ?, ?)',
    [data.nome, data.slug, data.db_path || 'pending', data.status || 'ativo']
  );
}

async function updateTenantDbPath(master, idTenant, dbPath) {
  return master.run('UPDATE tenants SET db_path = ? WHERE id_tenant = ?', [dbPath, idTenant]);
}

async function createUser(master, data = {}) {
  return master.run(
    'INSERT INTO users (id_tenant, nome, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    [data.id_tenant, data.nome, data.email, data.password_hash, data.role || 'owner', data.status || 'ativo']
  );
}

async function updateUser(master, idUser, data = {}) {
  const fields = [];
  const params = [];
  if (data.role) {
    fields.push('role = ?');
    params.push(data.role);
  }
  if (data.status) {
    fields.push('status = ?');
    params.push(data.status);
  }
  if (!fields.length) return { changes: 0 };
  params.push(idUser);
  return master.run(`UPDATE users SET ${fields.join(', ')} WHERE id_user = ?`, params);
}

async function updateUserPassword(master, idUser, passwordHash) {
  return master.run('UPDATE users SET password_hash = ? WHERE id_user = ?', [passwordHash, idUser]);
}

async function getTenant(master, idTenant) {
  return master.get(`
    SELECT t.id_tenant, t.nome, t.slug, t.db_path, t.status, t.created_at,
           COUNT(u.id_user) AS users_count
    FROM tenants t
    LEFT JOIN users u ON u.id_tenant = t.id_tenant
    WHERE t.id_tenant = ?
    GROUP BY t.id_tenant`, [idTenant]);
}

async function updateTenant(master, idTenant, data = {}) {
  const fields = [];
  const params = [];
  if (data.status) {
    fields.push('status = ?');
    params.push(data.status);
  }
  if (!fields.length) return { changes: 0 };
  params.push(idTenant);
  return master.run(`UPDATE tenants SET ${fields.join(', ')} WHERE id_tenant = ?`, params);
}

async function countAdmins(master) {
  const row = await master.get(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'ativo'`);
  return row ? row.total : 0;
}

async function logAdminAction(master, actor, action) {
  return master.run(`
    INSERT INTO admin_audit_log
      (id_admin, admin_email, acao, entidade_tipo, entidade_id, antes, depois)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      actor && actor.id_user ? actor.id_user : null,
      actor && actor.email ? actor.email : null,
      action.acao,
      action.entidade_tipo,
      String(action.entidade_id),
      action.antes ? JSON.stringify(action.antes) : null,
      action.depois ? JSON.stringify(action.depois) : null,
    ]);
}

async function listAuditLogs(master, filters = {}) {
  let sql = `
    SELECT id_log, id_admin, admin_email, acao, entidade_tipo, entidade_id,
           antes, depois, created_at
    FROM admin_audit_log`;
  const where = [];
  const params = [];
  if (filters.entidade_tipo) {
    where.push('entidade_tipo = ?');
    params.push(filters.entidade_tipo);
  }
  if (filters.entidade_id) {
    where.push('entidade_id = ?');
    params.push(String(filters.entidade_id));
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC, id_log DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(filters.limit || 100), 1), 300));
  return master.all(sql, params);
}

module.exports = {
  overview,
  listUsers,
  listSubscriptions,
  getUserSubscription,
  upsertUserSubscription,
  listTenants,
  listTenantUsers,
  getUser,
  getUserByEmail,
  createTenant,
  updateTenantDbPath,
  createUser,
  updateUser,
  updateUserPassword,
  getTenant,
  updateTenant,
  countAdmins,
  logAdminAction,
  listAuditLogs,
};
