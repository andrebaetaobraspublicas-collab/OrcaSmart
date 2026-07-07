async function listUsers(master) {
  return master.all(`
    SELECT u.id_user, u.nome, u.email, u.role, u.status, t.nome AS tenant,
           s.status AS subscription_status
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    ORDER BY u.created_at DESC`);
}

module.exports = { listUsers };
