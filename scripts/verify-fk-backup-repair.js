const sqlite3 = require('sqlite3');
const { repairTenantBackupForeignKeys } = require('../utils/tenantForeignKeySanitizer');

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

(async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, 'PRAGMA foreign_keys = OFF');
    await run(db, 'CREATE TABLE orcamentos (id_orcamento INTEGER PRIMARY KEY, nome TEXT)');
    await run(db, 'CREATE TABLE eventogramas (id_eventograma INTEGER PRIMARY KEY, id_orcamento INTEGER REFERENCES "orcamentos__fk_backup_1783685415678"(id_orcamento), nome TEXT)');

    const changed = await repairTenantBackupForeignKeys(db, ['orcamentos', 'eventogramas']);
    if (!changed.includes('eventogramas')) {
      throw new Error(`Tabela eventogramas nao foi reparada: ${changed.join(', ')}`);
    }

    const fks = await all(db, 'PRAGMA foreign_key_list(eventogramas)');
    if (fks.length !== 1 || fks[0].table !== 'orcamentos') {
      throw new Error(`FK esperada para orcamentos, obtido: ${JSON.stringify(fks)}`);
    }

    await run(db, 'PRAGMA foreign_keys = ON');
    await run(db, 'INSERT INTO orcamentos (id_orcamento, nome) VALUES (1, ?)', ['Teste']);
    await run(db, 'INSERT INTO eventogramas (id_orcamento, nome) VALUES (1, ?)', ['Evento']);
    console.log('OK: backup FK repair');
  } finally {
    db.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
