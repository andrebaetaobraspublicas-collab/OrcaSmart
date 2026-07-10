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

function tablePattern(tableNames) {
  return tableNames
    .map(table => String(table).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

function stripReferencesToTables(createSql, tableNames) {
  const pattern = tablePattern(tableNames);
  if (!pattern) return createSql;
  const tableRef = `(?:${pattern})`;
  const referenceTail = String.raw`\s+REFERENCES\s+${tableRef}\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+\w+)*(?:\s+MATCH\s+\w+)*`;
  return String(createSql || '')
    .replace(new RegExp(String.raw`,\s*FOREIGN\s+KEY\s*\([^)]*\)${referenceTail}`, 'gi'), '')
    .replace(new RegExp(referenceTail, 'gi'), '');
}

async function rebuildTableWithSql(db, table, createSql) {
  const columns = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  const columnList = columns.map(col => quoteIdent(col.name)).join(', ');
  const indexes = await all(db, `
    SELECT name, sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name`, [table]);

  const backupTable = `${table}__fk_backup_${Date.now()}`;
  await run(db, `ALTER TABLE ${quoteIdent(table)} RENAME TO ${quoteIdent(backupTable)}`);
  await run(db, createSql);
  await run(db, `INSERT INTO ${quoteIdent(table)} (${columnList}) SELECT ${columnList} FROM ${quoteIdent(backupTable)}`);
  await run(db, `DROP TABLE ${quoteIdent(backupTable)}`);
  for (const index of indexes) {
    await run(db, index.sql);
  }
}

async function sanitizeTenantForeignKeysToCatalog(db, catalogTables = []) {
  const catalogSet = new Set((catalogTables || []).map(table => String(table).toLowerCase()));
  if (!catalogSet.size) return [];

  const tables = await all(db, `
    SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY name`);

  const candidates = [];
  for (const table of tables) {
    const foreignKeys = await all(db, `PRAGMA foreign_key_list(${quoteIdent(table.name)})`).catch(() => []);
    const catalogRefs = foreignKeys
      .map(row => String(row.table || ''))
      .filter(ref => catalogSet.has(ref.toLowerCase()));
    if (!catalogRefs.length) continue;

    const sanitizedSql = stripReferencesToTables(table.sql, [...new Set(catalogRefs)]);
    if (!sanitizedSql || sanitizedSql === table.sql) continue;
    candidates.push({
      name: table.name,
      sql: sanitizedSql,
      refs: [...new Set(foreignKeys.map(row => String(row.table || '')).filter(Boolean))],
    });
  }
  if (!candidates.length) return [];

  const candidateNames = new Set(candidates.map(table => table.name));
  const ordered = [];
  const pending = [...candidates];
  while (pending.length) {
    const readyIndex = pending.findIndex(table =>
      table.refs.every(ref => !candidateNames.has(ref) || ordered.some(done => done.name === ref)));
    const index = readyIndex >= 0 ? readyIndex : 0;
    ordered.push(pending.splice(index, 1)[0]);
  }

  const changedTables = [];
  await run(db, 'PRAGMA foreign_keys = OFF');
  await run(db, 'BEGIN IMMEDIATE');
  try {
    for (const table of ordered) {
      await rebuildTableWithSql(db, table.name, table.sql);
      changedTables.push(table.name);
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON').catch(() => {});
  }

  return changedTables;
}

module.exports = {
  sanitizeTenantForeignKeysToCatalog,
};
