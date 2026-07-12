function isAdmin(req) {
  return req && req.user && req.user.role === 'admin';
}

function isTenantScopedId(id) {
  return String(id || '').trim().startsWith('tenant:');
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ensureAdmin(req, message) {
  if (!isAdmin(req)) {
    throw httpError(403, message || 'Operacao permitida apenas para administradores.');
  }
}

function ensureAdminOrTenantScoped(req, id, action, label) {
  if (isAdmin(req) || isTenantScopedId(id)) return;
  const verb = action || 'alterar';
  const target = label || 'registro referencial';
  throw httpError(
    403,
    `Usuarios comuns nao podem ${verb} ${target}. Crie ou edite uma versao propria do usuario.`
  );
}

module.exports = {
  ensureAdmin,
  ensureAdminOrTenantScoped,
  isAdmin,
  isTenantScopedId,
};
