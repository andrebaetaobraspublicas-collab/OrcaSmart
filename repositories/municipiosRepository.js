const { mysqlModeEnabled } = require('../utils/mysqlRuntime');

function isMysqlRuntime() {
  return mysqlModeEnabled();
}

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

async function ensureAliquotasTable(db) {
  if (isMysqlRuntime()) {
    await run(db, `
      CREATE TABLE IF NOT EXISTS municipio_aliquotas_anuais (
        id_aliquota BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        id_municipio BIGINT UNSIGNED NOT NULL,
        ano INT NOT NULL,
        iva_percentual DECIMAL(20,8) NOT NULL DEFAULT 0,
        aliquota_cbs DECIMAL(20,8) NOT NULL DEFAULT 0,
        aliquota_ibs DECIMAL(20,8) NOT NULL DEFAULT 0,
        aliquota_iss DECIMAL(20,8) NOT NULL DEFAULT 0,
        data_atualizacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id_aliquota),
        UNIQUE KEY uq_municipio_aliquotas_anuais_municipio_ano (id_municipio, ano),
        KEY idx_municipio_aliquotas_anuais_ano (ano),
        KEY idx_municipio_aliquotas_anuais_municipio (id_municipio)
      )`);
    return;
  }

  await run(db, `
    CREATE TABLE IF NOT EXISTS municipio_aliquotas_anuais (
      id_aliquota INTEGER PRIMARY KEY AUTOINCREMENT,
      id_municipio INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      iva_percentual REAL NOT NULL DEFAULT 0.0,
      aliquota_cbs REAL NOT NULL DEFAULT 0.0,
      aliquota_ibs REAL NOT NULL DEFAULT 0.0,
      aliquota_iss REAL NOT NULL DEFAULT 0.0,
      data_atualizacao TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (id_municipio) REFERENCES municipios(id_municipio) ON DELETE CASCADE,
      UNIQUE(id_municipio, ano)
    )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_municipio_aliquotas_anuais_ano ON municipio_aliquotas_anuais(ano)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_municipio_aliquotas_anuais_municipio ON municipio_aliquotas_anuais(id_municipio)');
}

async function listEstados(db) {
  return all(db, 'SELECT id_estado, codigo_ibge, uf, nome_estado FROM estados ORDER BY uf');
}

async function listMunicipios(db, { uf, busca, ano }) {
  await ensureAliquotasTable(db);
  const anoRef = Number(ano || 2026);
  const params = [anoRef, anoRef];
  const where = [];
  if (uf) {
    where.push('m.uf = ?');
    params.push(String(uf).toUpperCase().trim());
  }
  if (busca) {
    const codigoIbgeCast = isMysqlRuntime()
      ? 'CAST(m.codigo_ibge_municipio AS CHAR)'
      : 'CAST(m.codigo_ibge_municipio AS TEXT)';
    where.push(`(m.nome_municipio LIKE ? OR ${codigoIbgeCast} LIKE ?)`);
    params.push(`%${busca}%`, `%${busca}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(db, `
    SELECT m.id_municipio, m.codigo_ibge_municipio, m.nome_municipio, m.uf,
           COALESCE(ma.aliquota_ibs, m.aliquota_ibs) AS aliquota_ibs,
           COALESCE(ma.aliquota_cbs, m.aliquota_cbs) AS aliquota_cbs,
           COALESCE(ma.aliquota_iss, m.aliquota_iss) AS aliquota_iss,
           COALESCE(ma.ano, m.ano_aliquota, ?) AS ano_aliquota,
           COALESCE(ma.iva_percentual, COALESCE(m.aliquota_ibs,0) + COALESCE(m.aliquota_cbs,0)) AS iva_percentual,
           e.nome_estado
    FROM municipios m
    LEFT JOIN estados e ON m.id_estado = e.id_estado
    LEFT JOIN municipio_aliquotas_anuais ma ON ma.id_municipio = m.id_municipio AND ma.ano = ?
    ${clause}
    ORDER BY m.uf, m.nome_municipio`, params);
}

async function getMunicipio(db, idMunicipio) {
  await ensureAliquotasTable(db);
  const municipio = await one(db, `
    SELECT m.*, e.nome_estado
    FROM municipios m
    LEFT JOIN estados e ON m.id_estado = e.id_estado
    WHERE m.id_municipio = ?`, [idMunicipio]);
  if (!municipio) return null;
  municipio.aliquotas_anuais = await all(db, `
    SELECT ano, iva_percentual, aliquota_cbs, aliquota_ibs, aliquota_iss, data_atualizacao
    FROM municipio_aliquotas_anuais
    WHERE id_municipio = ?
    ORDER BY ano`, [idMunicipio]);
  return municipio;
}

async function getMunicipioByIbge(db, codigoIbge) {
  return one(db, `
    SELECT id_municipio, aliquota_iss, aliquota_ibs, aliquota_cbs
    FROM municipios
    WHERE codigo_ibge_municipio = ?`, [codigoIbge]);
}

async function upsertAliquotas(db, idMunicipio, { ano, iva, cbs, ibs, iss }) {
  await ensureAliquotasTable(db);
  if (isMysqlRuntime()) {
    await run(db, `
      INSERT INTO municipio_aliquotas_anuais
        (id_municipio, ano, iva_percentual, aliquota_cbs, aliquota_ibs, aliquota_iss, data_atualizacao)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        iva_percentual = VALUES(iva_percentual),
        aliquota_cbs = VALUES(aliquota_cbs),
        aliquota_ibs = VALUES(aliquota_ibs),
        aliquota_iss = VALUES(aliquota_iss),
        data_atualizacao = CURRENT_TIMESTAMP`, [idMunicipio, ano, iva, cbs, ibs, iss]);
  } else {
    await run(db, `
      INSERT INTO municipio_aliquotas_anuais
        (id_municipio, ano, iva_percentual, aliquota_cbs, aliquota_ibs, aliquota_iss, data_atualizacao)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id_municipio, ano) DO UPDATE SET
        iva_percentual = excluded.iva_percentual,
        aliquota_cbs = excluded.aliquota_cbs,
        aliquota_ibs = excluded.aliquota_ibs,
        aliquota_iss = excluded.aliquota_iss,
        data_atualizacao = datetime('now')`, [idMunicipio, ano, iva, cbs, ibs, iss]);
  }

  if (Number(ano) === 2026) {
    await run(db, `
      UPDATE municipios
      SET aliquota_ibs = ?, aliquota_cbs = ?, aliquota_iss = ?, ano_aliquota = ?
      WHERE id_municipio = ?`, [ibs, cbs, iss, ano, idMunicipio]);
  }

  return one(db, `
    SELECT m.id_municipio, m.codigo_ibge_municipio, m.nome_municipio, m.uf,
           ma.aliquota_ibs, ma.aliquota_cbs, ma.aliquota_iss,
           ma.ano AS ano_aliquota, ma.iva_percentual
    FROM municipios m
    JOIN municipio_aliquotas_anuais ma ON ma.id_municipio = m.id_municipio AND ma.ano = ?
    WHERE m.id_municipio = ?`, [ano, idMunicipio]);
}

module.exports = {
  ensureAliquotasTable,
  getMunicipio,
  getMunicipioByIbge,
  listEstados,
  listMunicipios,
  upsertAliquotas,
};
