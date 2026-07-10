function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function stripMunicipiosReference(createSql) {
  return String(createSql || '').replace(
    /\s+REFERENCES\s+municipios\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+\w+)*(?:\s+MATCH\s+\w+)*/gi,
    '',
  );
}

async function sanitizeObrasMunicipioForeignKey(db) {
  const foreignKeys = await all(db, 'PRAGMA foreign_key_list(obras)').catch(() => []);
  const hasMunicipiosFk = foreignKeys.some(row => String(row.table || '').toLowerCase() === 'municipios');
  if (!hasMunicipiosFk) return false;

  const schema = await get(
    db,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'obras'",
  );
  const sanitizedSql = stripMunicipiosReference(schema?.sql);
  if (!sanitizedSql || sanitizedSql === schema?.sql) return false;

  const columns = await all(db, 'PRAGMA table_info(obras)');
  const columnList = columns.map(col => quoteIdent(col.name)).join(', ');
  const indexes = await all(db, `
    SELECT name, sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'obras' AND sql IS NOT NULL
    ORDER BY name`);

  const backupTable = `obras__fk_backup_${Date.now()}`;
  await run(db, 'PRAGMA foreign_keys = OFF');
  await run(db, 'BEGIN IMMEDIATE');
  try {
    await run(db, `ALTER TABLE obras RENAME TO ${quoteIdent(backupTable)}`);
    await run(db, sanitizedSql);
    await run(db, `INSERT INTO obras (${columnList}) SELECT ${columnList} FROM ${quoteIdent(backupTable)}`);
    await run(db, `DROP TABLE ${quoteIdent(backupTable)}`);
    for (const index of indexes) {
      await run(db, index.sql);
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON').catch(() => {});
  }

  return true;
}

module.exports = {
  sanitizeObrasMunicipioForeignKey,
};
