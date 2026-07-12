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

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantDatasBase(db) {
  return tableExists(db, 'tenant_datas_base');
}

async function hasCatalogDatasBase(db) {
  return tableExists(db, 'datas_base', 'catalog');
}

async function hasOverridesTable(db) {
  return tableExists(db, 'tenant_referential_overrides');
}

async function recordDataBaseOverride(db, data = {}) {
  if (!(await hasOverridesTable(db))) return null;
  const result = await run(db, `
    INSERT INTO tenant_referential_overrides
      (domain, catalog_table, catalog_id, tenant_table, tenant_rowid, action, impact_policy, payload_json, status)
    VALUES ('datas_base', 'datas_base', ?, 'tenant_datas_base', ?, ?, 'preserve', ?, 'active')`, [
    data.catalogId || null,
    data.tenantRowid || null,
    data.action || 'create',
    data.payload ? JSON.stringify(data.payload) : null,
  ]);
  return result.lastID;
}

async function nextTenantDataBaseId(db) {
  const tenantMax = await one(db, 'SELECT MAX(id_data_base) AS max_id FROM tenant_datas_base').catch(() => null);
  const catalogMax = await one(db, 'SELECT MAX(id_data_base) AS max_id FROM catalog.datas_base').catch(() => null);
  const maxId = Math.max(Number(tenantMax?.max_id || 0), Number(catalogMax?.max_id || 0), 0);
  return maxId + 1;
}

async function getTenantByDataBaseId(db, id) {
  if (!(await hasTenantDatasBase(db))) return null;
  return one(db, `
    SELECT *, rowid AS tenant_rowid, 'tenant' AS _tenant_scope
    FROM tenant_datas_base
    WHERE id_data_base = ? AND COALESCE(tenant_override_status,'active')='active'
    LIMIT 1`, [id]);
}

async function listDatasBase(db) {
  if ((await hasTenantDatasBase(db)) && (await hasCatalogDatasBase(db))) {
    return all(db, `
      SELECT *
      FROM (
        SELECT c.id_data_base, c.mes, c.ano, c.data_referencia, c.descricao,
               NULL AS tenant_rowid, 'catalog' AS _tenant_scope
        FROM catalog.datas_base c
        WHERE NOT EXISTS (
          SELECT 1 FROM tenant_referential_overrides r
          WHERE r.domain='datas_base' AND r.catalog_table='datas_base'
            AND r.catalog_id=c.id_data_base AND r.status='active'
            AND r.action IN ('update','delete')
        )
        UNION ALL
        SELECT t.id_data_base, t.mes, t.ano, t.data_referencia, t.descricao,
               t.rowid AS tenant_rowid, 'tenant' AS _tenant_scope
        FROM tenant_datas_base t
        WHERE COALESCE(t.tenant_override_status,'active')='active'
      ) AS datas_base_unificadas
      ORDER BY ano DESC, mes DESC`);
  }
  return all(db, 'SELECT * FROM datas_base ORDER BY ano DESC, mes DESC');
}

async function getDataBase(db, id) {
  const scoped = scopedId(id);
  if ((await hasTenantDatasBase(db)) && scoped.scope === 'tenant') {
    return one(db, `
      SELECT *, rowid AS tenant_rowid, 'tenant' AS _tenant_scope
      FROM tenant_datas_base
      WHERE rowid = ? AND COALESCE(tenant_override_status,'active')='active'`, [scoped.value]);
  }
  if ((await hasTenantDatasBase(db)) && (await hasCatalogDatasBase(db))) {
    const tenant = await getTenantByDataBaseId(db, scoped.value);
    if (tenant) return tenant;
    const deleted = await one(db, `
      SELECT 1
      FROM tenant_referential_overrides
      WHERE domain='datas_base' AND catalog_table='datas_base'
        AND catalog_id=? AND status='active' AND action='delete'
      LIMIT 1`, [scoped.value]).catch(() => null);
    if (deleted) return null;
    return one(db, `
      SELECT *, NULL AS tenant_rowid, 'catalog' AS _tenant_scope
      FROM catalog.datas_base
      WHERE id_data_base = ?`, [scoped.value]);
  }
  return one(db, 'SELECT * FROM datas_base WHERE id_data_base = ?', [id]);
}

async function createDataBase(db, data) {
  if (await hasTenantDatasBase(db)) {
    const idDataBase = await nextTenantDataBaseId(db);
    const result = await run(
      db,
      `INSERT INTO tenant_datas_base
        (id_data_base, mes, ano, data_referencia, descricao,
         tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
       VALUES (?,?,?,?,?,NULL,'create','active',?,?)`,
      [idDataBase, data.mes, data.ano, data.data_referencia, data.descricao, new Date().toISOString(), new Date().toISOString()],
    );
    await recordDataBaseOverride(db, { tenantRowid: result.lastID, action: 'create', payload: data });
    return getDataBase(db, idDataBase);
  }
  const result = await run(
    db,
    'INSERT INTO datas_base (mes, ano, data_referencia, descricao) VALUES (?,?,?,?)',
    [data.mes, data.ano, data.data_referencia, data.descricao],
  );
  return getDataBase(db, result.lastID);
}

async function updateDataBase(db, id, data) {
  const scoped = scopedId(id);
  if (await hasTenantDatasBase(db)) {
    const existingTenant = scoped.scope === 'tenant'
      ? await one(db, 'SELECT rowid, id_data_base FROM tenant_datas_base WHERE rowid=? AND COALESCE(tenant_override_status,\'active\')=\'active\'', [scoped.value])
      : await getTenantByDataBaseId(db, scoped.value);
    if (existingTenant) {
      const result = await run(
        db,
        `UPDATE tenant_datas_base
         SET mes=?, ano=?, data_referencia=?, descricao=?, tenant_updated_at=?
         WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`,
        [data.mes, data.ano, data.data_referencia, data.descricao, new Date().toISOString(), existingTenant.rowid || existingTenant.tenant_rowid],
      );
      if (!result.changes) return null;
      return getDataBase(db, existingTenant.id_data_base);
    }
    if (await hasCatalogDatasBase(db)) {
      const catalog = await one(db, 'SELECT * FROM catalog.datas_base WHERE id_data_base=?', [scoped.value]);
      if (!catalog) return null;
      const result = await run(
        db,
        `INSERT INTO tenant_datas_base
          (id_data_base, mes, ano, data_referencia, descricao,
           tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
         VALUES (?,?,?,?,?,?,'update','active',?,?)`,
        [scoped.value, data.mes, data.ano, data.data_referencia, data.descricao, scoped.value, new Date().toISOString(), new Date().toISOString()],
      );
      await recordDataBaseOverride(db, { catalogId: scoped.value, tenantRowid: result.lastID, action: 'update', payload: data });
      return getDataBase(db, scoped.value);
    }
  }
  const result = await run(
    db,
    'UPDATE datas_base SET mes=?, ano=?, data_referencia=?, descricao=? WHERE id_data_base=?',
    [data.mes, data.ano, data.data_referencia, data.descricao, id],
  );
  if (!result.changes) return null;
  return getDataBase(db, id);
}

async function countOrcamentos(db, idDataBase) {
  const row = await one(db, 'SELECT COUNT(*) AS total FROM orcamentos WHERE id_data_base = ?', [idDataBase]);
  return row?.total || 0;
}

async function deleteDataBase(db, id) {
  const scoped = scopedId(id);
  if (await hasTenantDatasBase(db)) {
    const tenant = scoped.scope === 'tenant'
      ? await one(db, 'SELECT rowid, id_data_base, tenant_catalog_id FROM tenant_datas_base WHERE rowid=? AND COALESCE(tenant_override_status,\'active\')=\'active\'', [scoped.value])
      : await getTenantByDataBaseId(db, scoped.value);
    if (tenant) {
      return run(db, `
        UPDATE tenant_datas_base
        SET tenant_override_status='deleted', tenant_updated_at=?
        WHERE rowid=?`, [new Date().toISOString(), tenant.rowid || tenant.tenant_rowid]);
    }
    if (await hasCatalogDatasBase(db)) {
      const catalog = await one(db, 'SELECT id_data_base FROM catalog.datas_base WHERE id_data_base=?', [scoped.value]);
      if (!catalog) return { changes: 0 };
      await recordDataBaseOverride(db, { catalogId: scoped.value, action: 'delete', payload: {} });
      return { changes: 1 };
    }
  }
  return run(db, 'DELETE FROM datas_base WHERE id_data_base = ?', [id]);
}

module.exports = {
  listDatasBase,
  getDataBase,
  createDataBase,
  updateDataBase,
  countOrcamentos,
  deleteDataBase,
};
