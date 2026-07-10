function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function scopedId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value: Number(value) };
}

function params(data = {}) {
  return [String(data.sigla || '').trim(), data.descricao || null, data.tipo_unidade || null];
}

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantUnidades(db) {
  return tableExists(db, 'tenant_unidades_medida');
}

async function hasCatalogUnidades(db) {
  return tableExists(db, 'unidades_medida', 'catalog');
}

async function hasOverridesTable(db) {
  return tableExists(db, 'tenant_referential_overrides');
}

async function recordUnidadeOverride(db, data = {}) {
  if (!(await hasOverridesTable(db))) return null;
  const result = await run(db, `
    INSERT INTO tenant_referential_overrides
      (domain, catalog_table, catalog_id, tenant_table, tenant_rowid, action, impact_policy, payload_json, status)
    VALUES ('unidades_medida', 'unidades_medida', ?, 'tenant_unidades_medida', ?, ?, 'preserve', ?, 'active')`, [
    data.catalogId || null,
    data.tenantRowid || null,
    data.action || 'create',
    data.payload ? JSON.stringify(data.payload) : null,
  ]);
  return result.lastID;
}

async function nextTenantUnidadeId(db) {
  const tenantMax = await one(db, 'SELECT MAX(id_unidade) AS max_id FROM tenant_unidades_medida').catch(() => null);
  const catalogMax = await one(db, 'SELECT MAX(id_unidade) AS max_id FROM catalog.unidades_medida').catch(() => null);
  const maxId = Math.max(Number(tenantMax?.max_id || 0), Number(catalogMax?.max_id || 0), 0);
  return maxId + 1;
}

async function getTenantByUnidadeId(db, id) {
  if (!(await hasTenantUnidades(db))) return null;
  return one(db, `
    SELECT *, rowid AS tenant_rowid, 'tenant' AS _tenant_scope
    FROM tenant_unidades_medida
    WHERE id_unidade = ? AND COALESCE(tenant_override_status,'active')='active'
    LIMIT 1`, [id]);
}

async function listUnidades(db) {
  if ((await hasTenantUnidades(db)) && (await hasCatalogUnidades(db))) {
    return all(db, `
      SELECT *
      FROM (
        SELECT c.id_unidade, c.sigla, c.descricao, c.tipo_unidade,
               NULL AS tenant_rowid, 'catalog' AS _tenant_scope
        FROM catalog.unidades_medida c
        WHERE NOT EXISTS (
          SELECT 1 FROM tenant_referential_overrides r
          WHERE r.domain='unidades_medida' AND r.catalog_table='unidades_medida'
            AND r.catalog_id=c.id_unidade AND r.status='active'
            AND r.action IN ('update','delete')
        )
        UNION ALL
        SELECT t.id_unidade, t.sigla, t.descricao, t.tipo_unidade,
               t.rowid AS tenant_rowid, 'tenant' AS _tenant_scope
        FROM tenant_unidades_medida t
        WHERE COALESCE(t.tenant_override_status,'active')='active'
      )
      ORDER BY sigla`);
  }
  return all(db, 'SELECT * FROM unidades_medida ORDER BY sigla');
}

async function getUnidade(db, id) {
  const scoped = scopedId(id);
  if ((await hasTenantUnidades(db)) && scoped.scope === 'tenant') {
    return one(db, `
      SELECT *, rowid AS tenant_rowid, 'tenant' AS _tenant_scope
      FROM tenant_unidades_medida
      WHERE rowid = ? AND COALESCE(tenant_override_status,'active')='active'`, [scoped.value]);
  }
  if ((await hasTenantUnidades(db)) && (await hasCatalogUnidades(db))) {
    const tenant = await getTenantByUnidadeId(db, scoped.value);
    if (tenant) return tenant;
    const deleted = await one(db, `
      SELECT 1
      FROM tenant_referential_overrides
      WHERE domain='unidades_medida' AND catalog_table='unidades_medida'
        AND catalog_id=? AND status='active' AND action='delete'
      LIMIT 1`, [scoped.value]).catch(() => null);
    if (deleted) return null;
    return one(db, `
      SELECT *, NULL AS tenant_rowid, 'catalog' AS _tenant_scope
      FROM catalog.unidades_medida
      WHERE id_unidade = ?`, [scoped.value]);
  }
  return one(db, 'SELECT * FROM unidades_medida WHERE id_unidade = ?', [id]);
}

async function createUnidade(db, data) {
  if (await hasTenantUnidades(db)) {
    const idUnidade = await nextTenantUnidadeId(db);
    const now = new Date().toISOString();
    const result = await run(
      db,
      `INSERT INTO tenant_unidades_medida
        (id_unidade, sigla, descricao, tipo_unidade,
         tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
       VALUES (?,?,?,?,NULL,'create','active',?,?)`,
      [idUnidade, ...params(data), now, now],
    );
    await recordUnidadeOverride(db, { tenantRowid: result.lastID, action: 'create', payload: data });
    return getUnidade(db, idUnidade);
  }
  const result = await run(db, 'INSERT INTO unidades_medida (sigla, descricao, tipo_unidade) VALUES (?,?,?)', params(data));
  return getUnidade(db, result.lastID);
}

async function updateUnidade(db, id, data) {
  const scoped = scopedId(id);
  if (await hasTenantUnidades(db)) {
    const existingTenant = scoped.scope === 'tenant'
      ? await one(db, 'SELECT rowid, id_unidade FROM tenant_unidades_medida WHERE rowid=? AND COALESCE(tenant_override_status,\'active\')=\'active\'', [scoped.value])
      : await getTenantByUnidadeId(db, scoped.value);
    if (existingTenant) {
      const result = await run(
        db,
        `UPDATE tenant_unidades_medida
         SET sigla=?, descricao=?, tipo_unidade=?, tenant_updated_at=?
         WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`,
        [...params(data), new Date().toISOString(), existingTenant.rowid || existingTenant.tenant_rowid],
      );
      if (!result.changes) return null;
      return getUnidade(db, existingTenant.id_unidade);
    }
    if (await hasCatalogUnidades(db)) {
      const catalog = await one(db, 'SELECT * FROM catalog.unidades_medida WHERE id_unidade=?', [scoped.value]);
      if (!catalog) return null;
      const now = new Date().toISOString();
      const result = await run(
        db,
        `INSERT INTO tenant_unidades_medida
          (id_unidade, sigla, descricao, tipo_unidade,
           tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
         VALUES (?,?,?,?,?,'update','active',?,?)`,
        [scoped.value, ...params(data), scoped.value, now, now],
      );
      await recordUnidadeOverride(db, { catalogId: scoped.value, tenantRowid: result.lastID, action: 'update', payload: data });
      return getUnidade(db, scoped.value);
    }
  }
  const result = await run(db, 'UPDATE unidades_medida SET sigla=?, descricao=?, tipo_unidade=? WHERE id_unidade=?', [...params(data), id]);
  if (!result.changes) return null;
  return getUnidade(db, id);
}

async function deleteUnidade(db, id) {
  const scoped = scopedId(id);
  if (await hasTenantUnidades(db)) {
    const tenant = scoped.scope === 'tenant'
      ? await one(db, 'SELECT rowid, id_unidade FROM tenant_unidades_medida WHERE rowid=? AND COALESCE(tenant_override_status,\'active\')=\'active\'', [scoped.value])
      : await getTenantByUnidadeId(db, scoped.value);
    if (tenant) {
      return run(db, `
        UPDATE tenant_unidades_medida
        SET tenant_override_status='deleted', tenant_updated_at=?
        WHERE rowid=?`, [new Date().toISOString(), tenant.rowid || tenant.tenant_rowid]);
    }
    if (await hasCatalogUnidades(db)) {
      const catalog = await one(db, 'SELECT id_unidade FROM catalog.unidades_medida WHERE id_unidade=?', [scoped.value]);
      if (!catalog) return { changes: 0 };
      await recordUnidadeOverride(db, { catalogId: scoped.value, action: 'delete', payload: {} });
      return { changes: 1 };
    }
  }
  return run(db, 'DELETE FROM unidades_medida WHERE id_unidade = ?', [id]);
}

module.exports = {
  listUnidades,
  getUnidade,
  createUnidade,
  updateUnidade,
  deleteUnidade,
};
