const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  USER_OVERRIDE_TABLES,
  PHASE2_MODEL_VERSION,
} = require('../utils/dataModelManifest');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || APP_DIR;
const OUTPUT_DIR = path.join(APP_DIR, 'docs', 'generated');

const DB_SOURCES = {
  seed_template: path.join(APP_DIR, 'database', 'orcamento_obras_template.db'),
  tenant_template: path.join(APP_DIR, 'database', 'tenant_private_template.db'),
  shared_catalog: path.join(DATA_DIR, 'shared_catalog.db'),
  master: path.join(DATA_DIR, 'saas_master.db'),
};

const MASTER_TABLES = [
  'tenants',
  'users',
  'subscriptions',
  'admin_audit_log',
];

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  db.filename = dbPath;
  return db;
}

function closeDb(db) {
  return new Promise(resolve => db.close(() => resolve()));
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

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function tableNames(db) {
  const rows = await all(db, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name`);
  return rows.map(row => row.name);
}

async function tableDetails(db, table) {
  const [columns, foreignKeys, indexes, count] = await Promise.all([
    all(db, `PRAGMA table_info(${quoteIdent(table)})`),
    all(db, `PRAGMA foreign_key_list(${quoteIdent(table)})`).catch(() => []),
    all(db, `PRAGMA index_list(${quoteIdent(table)})`).catch(() => []),
    get(db, `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`).catch(() => ({ total: null })),
  ]);

  return {
    columns: columns.map(col => ({
      name: col.name,
      type: col.type || '',
      notnull: !!col.notnull,
      pk: Number(col.pk || 0),
      default_value: col.dflt_value === undefined ? null : col.dflt_value,
    })),
    primary_key: columns.filter(col => Number(col.pk || 0) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map(col => col.name),
    foreign_keys: foreignKeys.map(fk => ({
      from: fk.from,
      table: fk.table,
      to: fk.to,
      on_update: fk.on_update,
      on_delete: fk.on_delete,
    })),
    indexes: indexes.map(index => ({
      name: index.name,
      unique: !!index.unique,
      origin: index.origin,
      partial: !!index.partial,
    })),
    rows: count ? count.total : null,
  };
}

async function inspectDatabase(label, dbPath) {
  if (!fs.existsSync(dbPath)) {
    return {
      label,
      path: dbPath,
      exists: false,
      size_bytes: 0,
      tables: [],
    };
  }

  const db = openDb(dbPath);
  try {
    const names = await tableNames(db);
    const tables = [];
    for (const table of names) {
      tables.push({
        name: table,
        ...(await tableDetails(db, table)),
      });
    }
    return {
      label,
      path: dbPath,
      exists: true,
      size_bytes: fs.statSync(dbPath).size,
      tables,
    };
  } finally {
    await closeDb(db);
  }
}

function tableDomain(table) {
  if (MASTER_TABLES.includes(table)) return 'master_saas';
  if (CATALOG_TABLES.includes(table)) return 'catalogo_global';
  if (TENANT_TABLES.includes(table)) return 'tenant_privado';
  if (USER_OVERRIDE_TABLES.includes(table) || table.startsWith('tenant_')) return 'override_tenant';
  if (table.startsWith('orcasmart_')) return 'metadados';
  return 'pendente_classificacao';
}

function collectClassifiedTables(databases) {
  const byName = new Map();
  const expectedTables = [
    ...MASTER_TABLES,
    ...CATALOG_TABLES,
    ...TENANT_TABLES,
    ...USER_OVERRIDE_TABLES,
  ];

  for (const table of expectedTables) {
    if (!byName.has(table)) {
      byName.set(table, {
        name: table,
        domain: tableDomain(table),
        sources: [],
        columns: [],
        primary_key: [],
        foreign_keys: [],
        expected: true,
      });
    }
  }

  for (const db of databases) {
    for (const table of db.tables || []) {
      if (!byName.has(table.name)) {
        byName.set(table.name, {
          name: table.name,
          domain: tableDomain(table.name),
          sources: [],
          columns: table.columns,
          primary_key: table.primary_key,
          foreign_keys: table.foreign_keys,
          expected: expectedTables.includes(table.name),
        });
      } else if (!byName.get(table.name).columns.length) {
        byName.get(table.name).columns = table.columns;
        byName.get(table.name).primary_key = table.primary_key;
        byName.get(table.name).foreign_keys = table.foreign_keys;
      }
      byName.get(table.name).sources.push({
        database: db.label,
        rows: table.rows,
      });
    }
  }
  return Array.from(byName.values()).sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });
}

function groupByDomain(tables) {
  return tables.reduce((acc, table) => {
    if (!acc[table.domain]) acc[table.domain] = [];
    acc[table.domain].push(table);
    return acc;
  }, {});
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!n) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatSources(sources = []) {
  if (!sources.length) return 'esperada, ausente nos bancos analisados';
  return sources.map(source => `${source.database}: ${source.rows === null || source.rows === undefined ? '-' : source.rows}`).join('<br>');
}

function markdownReport(report) {
  const domains = groupByDomain(report.tables);
  const order = [
    'master_saas',
    'catalogo_global',
    'tenant_privado',
    'override_tenant',
    'metadados',
    'pendente_classificacao',
  ];
  const lines = [
    '# Fase 4 - Inventario do modelo de dados',
    '',
    `Gerado em: ${report.generated_at}`,
    `Versao do modelo Fase 2: ${report.phase2_model_version}`,
    '',
    '## Bancos analisados',
    '',
    '| Banco | Existe | Tamanho | Caminho |',
    '|---|---:|---:|---|',
    ...report.databases.map(db => `| ${db.label} | ${db.exists ? 'sim' : 'nao'} | ${formatBytes(db.size_bytes)} | ${db.path} |`),
    '',
    '## Resumo por dominio',
    '',
    '| Dominio | Tabelas |',
    '|---|---:|',
    ...order.filter(domain => domains[domain]).map(domain => `| ${domain} | ${domains[domain].length} |`),
    '',
  ];

  for (const domain of order) {
    const tables = domains[domain] || [];
    if (!tables.length) continue;
    lines.push(`## ${domain}`, '');
    lines.push('| Tabela | PK | Colunas | Fontes / linhas |');
    lines.push('|---|---|---:|---|');
    for (const table of tables) {
      lines.push(`| ${table.name} | ${table.primary_key.join(', ') || '-'} | ${table.columns.length} | ${formatSources(table.sources)} |`);
    }
    lines.push('');
  }

  lines.push('## Observacoes para MySQL', '');
  lines.push('- `master_saas`: deve ir para tabelas administrativas globais do SaaS.');
  lines.push('- `catalogo_global`: deve ser compartilhado por todos os tenants e editavel apenas por admin.');
  lines.push('- `tenant_privado`: deve receber `tenant_id` no MySQL ou ficar em schema logicamente isolado.');
  lines.push('- `override_tenant`: deve receber `tenant_id` e preservar o vinculo com o registro referencial original.');
  lines.push('- `pendente_classificacao`: exige decisao explicita antes da migracao.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const databases = [];
  for (const [label, dbPath] of Object.entries(DB_SOURCES)) {
    databases.push(await inspectDatabase(label, dbPath));
  }
  const report = {
    generated_at: new Date().toISOString(),
    phase2_model_version: PHASE2_MODEL_VERSION,
    user_override_domains: USER_OVERRIDE_DOMAINS,
    manifest: {
      master_tables: MASTER_TABLES,
      catalog_tables: CATALOG_TABLES,
      tenant_tables: TENANT_TABLES,
      user_override_tables: USER_OVERRIDE_TABLES,
    },
    databases,
    tables: collectClassifiedTables(databases),
  };

  const jsonPath = path.join(OUTPUT_DIR, 'fase4-data-model-inventory.json');
  const mdPath = path.join(OUTPUT_DIR, 'fase4-data-model-inventory.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, markdownReport(report), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    json: jsonPath,
    markdown: mdPath,
    tables: report.tables.length,
    pending: report.tables.filter(table => table.domain === 'pendente_classificacao').map(table => table.name),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
