const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const INVENTORY_PATH = path.join(APP_DIR, 'docs', 'generated', 'fase4-data-model-inventory.json');
const OUTPUT_DIR = path.join(APP_DIR, 'database', 'mysql');
const SUMMARY_PATH = path.join(APP_DIR, 'docs', 'generated', 'fase4-mysql-schema-summary.md');

const DOMAIN_FILES = {
  master_saas: '00_master_saas.sql',
  catalogo_global: '10_catalogo_global.sql',
  tenant_privado: '20_tenant_privado.sql',
  override_tenant: '30_override_tenant.sql',
  metadados: '40_metadados.sql',
};

const DOMAIN_TITLES = {
  master_saas: 'Master SaaS',
  catalogo_global: 'Catalogo global compartilhado',
  tenant_privado: 'Dados privados dos tenants',
  override_tenant: 'Overrides e registros do usuario',
  metadados: 'Metadados operacionais',
};

const MANUAL_TABLES = {
  admin_audit_log: {
    domain: 'master_saas',
    columns: [
      { name: 'id_audit_log', mysql: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', pk: true },
      { name: 'id_admin_user', mysql: 'BIGINT UNSIGNED NULL' },
      { name: 'id_tenant', mysql: 'BIGINT UNSIGNED NULL' },
      { name: 'action', mysql: 'VARCHAR(120) NOT NULL' },
      { name: 'entity_type', mysql: 'VARCHAR(120) NULL' },
      { name: 'entity_id', mysql: 'VARCHAR(191) NULL' },
      { name: 'details_json', mysql: 'JSON NULL' },
      { name: 'created_at', mysql: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' },
    ],
    indexes: [
      'KEY `idx_admin_audit_log_admin` (`id_admin_user`)',
      'KEY `idx_admin_audit_log_tenant` (`id_tenant`)',
      'KEY `idx_admin_audit_log_created_at` (`created_at`)',
    ],
  },
};

function readInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`Inventario nao encontrado: ${INVENTORY_PATH}. Execute npm run phase4:audit-model primeiro.`);
  }
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
}

function q(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^CURRENT_TIMESTAMP$/i.test(text)) return 'CURRENT_TIMESTAMP';
  if (/^date\('now'\)$/i.test(text)) return null;
  if (/^datetime\('now'\)$/i.test(text)) return 'CURRENT_TIMESTAMP';
  if (/^\(.+\)$/.test(text)) return null;
  return text;
}

function looksLikeDateColumn(name, defaultValue) {
  const n = String(name).toLowerCase();
  return n.endsWith('_at')
    || n.includes('created_at')
    || n.includes('updated_at')
    || /CURRENT_TIMESTAMP/i.test(String(defaultValue || ''))
    || /^datetime\('now'\)$/i.test(String(defaultValue || ''));
}

function hasTextDefault(column) {
  const type = String(column.type || '').toUpperCase();
  return type.includes('TEXT') && normalizeDefault(column.default_value) !== null;
}

function mysqlType(column, table) {
  const sqliteType = String(column.type || '').trim().toUpperCase();
  const name = String(column.name || '').toLowerCase();
  const isPk = Number(column.pk || 0) > 0;
  const defaultValue = normalizeDefault(column.default_value);

  if (looksLikeDateColumn(name, defaultValue)) return 'DATETIME';
  if (isPk && sqliteType.includes('INT')) return 'BIGINT UNSIGNED';
  if (isPk && sqliteType.includes('TEXT')) return 'VARCHAR(191)';
  if (sqliteType.includes('INT')) return 'BIGINT';
  if (sqliteType.includes('REAL') || sqliteType.includes('FLOA') || sqliteType.includes('DOUB')) return 'DECIMAL(20,8)';
  if (sqliteType.includes('NUM') || sqliteType.includes('DEC')) return 'DECIMAL(20,8)';
  if (sqliteType.includes('BLOB')) return 'LONGBLOB';
  if (name.endsWith('_json') || table === 'admin_audit_log') return 'JSON';
  if (hasTextDefault(column)) return 'VARCHAR(255)';
  if (sqliteType.includes('CHAR') || sqliteType.includes('CLOB') || sqliteType.includes('TEXT')) return 'TEXT';
  return 'VARCHAR(255)';
}

function mysqlDefault(column, type) {
  const normalized = normalizeDefault(column.default_value);
  if (normalized === null) return '';
  if (type === 'TEXT' || type === 'LONGBLOB' || type === 'JSON') return '';
  if (/^CURRENT_TIMESTAMP$/i.test(normalized)) return ' DEFAULT CURRENT_TIMESTAMP';
  return ` DEFAULT ${normalized}`;
}

function columnLine(column, table, primaryKey) {
  const isSingleIntegerPk = primaryKey.length === 1
    && primaryKey[0] === column.name
    && String(column.type || '').toUpperCase().includes('INT');
  const type = mysqlType(column, table);
  const nullable = column.notnull || primaryKey.includes(column.name) ? 'NOT NULL' : 'NULL';
  const autoIncrement = isSingleIntegerPk ? ' AUTO_INCREMENT' : '';
  return `  ${q(column.name)} ${type} ${nullable}${autoIncrement}${mysqlDefault(column, type)}`;
}

function syntheticPkName(table) {
  return `id_${table.replace(/^tenant_/, 'tenant_')}`;
}

function shouldAddTenantId(domain, table) {
  if (!['tenant_privado', 'override_tenant'].includes(domain)) return false;
  return !['tenant_referential_overrides'].includes(table) || true;
}

function tableStatements(table) {
  const manual = MANUAL_TABLES[table.name];
  if (manual) return manualStatements(table.name, manual);

  const lines = [];
  const constraints = [];
  const indexes = [];
  const columns = table.columns || [];
  const primaryKey = table.primary_key || [];
  const needsTenantId = shouldAddTenantId(table.domain, table.name);

  if (!columns.length) {
    lines.push(`  ${q(syntheticPkName(table.name))} BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`);
    constraints.push(`  PRIMARY KEY (${q(syntheticPkName(table.name))})`);
  }

  if (needsTenantId) {
    lines.push('  `tenant_id` BIGINT UNSIGNED NOT NULL');
    indexes.push(`  KEY ${q(`idx_${table.name}_tenant_id`)} (${q('tenant_id')})`);
  }

  for (const column of columns) {
    lines.push(columnLine(column, table.name, primaryKey));
  }

  if (primaryKey.length) {
    constraints.push(`  PRIMARY KEY (${primaryKey.map(q).join(', ')})`);
  } else if (columns.length) {
    const pk = syntheticPkName(table.name);
    lines.unshift(`  ${q(pk)} BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`);
    constraints.push(`  PRIMARY KEY (${q(pk)})`);
  }

  for (const fk of table.foreign_keys || []) {
    if (!fk.from || !fk.table || !fk.to) continue;
    constraints.push(`  KEY ${q(`idx_${table.name}_${fk.from}`)} (${q(fk.from)})`);
  }

  return createTableSql(table.name, [...lines, ...constraints, ...indexes]);
}

function manualStatements(tableName, table) {
  const lines = table.columns.map(column => `  ${q(column.name)} ${column.mysql}`);
  const pk = table.columns.filter(column => column.pk).map(column => column.name);
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  for (const index of table.indexes || []) lines.push(`  ${index}`);
  return createTableSql(tableName, lines);
}

function createTableSql(tableName, lines) {
  return [
    `CREATE TABLE IF NOT EXISTS ${q(tableName)} (`,
    lines.join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
    '',
  ].join('\n');
}

function fileHeader(domain, inventory) {
  return [
    '-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB',
    `-- Dominio: ${DOMAIN_TITLES[domain] || domain}`,
    `-- Gerado em: ${new Date().toISOString()}`,
    `-- Inventario base: ${inventory.generated_at}`,
    '-- Revisar antes de executar em producao.',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ].join('\n');
}

function fileFooter() {
  return [
    'SET FOREIGN_KEY_CHECKS = 1;',
    '',
  ].join('\n');
}

function groupByDomain(tables) {
  return tables.reduce((acc, table) => {
    if (!acc[table.domain]) acc[table.domain] = [];
    acc[table.domain].push(table);
    return acc;
  }, {});
}

function writeSchemaFiles(inventory) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const grouped = groupByDomain(inventory.tables);
  const written = [];

  for (const [domain, fileName] of Object.entries(DOMAIN_FILES)) {
    const tables = (grouped[domain] || []).sort((a, b) => a.name.localeCompare(b.name));
    const body = tables.map(tableStatements).join('\n');
    const outputPath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(outputPath, `${fileHeader(domain, inventory)}${body}${fileFooter()}`, 'utf8');
    written.push({ domain, fileName, tables: tables.length, outputPath });
  }

  return written;
}

function writeSummary(inventory, written) {
  const lines = [
    '# Fase 4 - Schema MySQL/MariaDB inicial',
    '',
    `Gerado em: ${new Date().toISOString()}`,
    `Inventario base: ${inventory.generated_at}`,
    '',
    '## Arquivos gerados',
    '',
    '| Dominio | Arquivo | Tabelas |',
    '|---|---|---:|',
    ...written.map(item => `| ${item.domain} | database/mysql/${item.fileName} | ${item.tables} |`),
    '',
    '## Premissas',
    '',
    '- O schema e um ponto de partida para revisao, ainda sem migracao de dados.',
    '- Tabelas `tenant_privado` e `override_tenant` recebem `tenant_id` para isolamento logico no MySQL.',
    '- Tabelas sem chave primaria explicita recebem chave sintetica `id_<tabela>`.',
    '- Campos numericos `REAL` do SQLite foram mapeados para `DECIMAL(20,8)`.',
    '- Campos de data/hora com `CURRENT_TIMESTAMP` foram mapeados para `DATETIME`.',
    '- Chaves estrangeiras serao refinadas na etapa de migracao apos validar relacionamentos reais e cascatas.',
    '',
  ];
  fs.writeFileSync(SUMMARY_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const inventory = readInventory();
  const pending = inventory.tables.filter(table => table.domain === 'pendente_classificacao');
  if (pending.length) {
    throw new Error(`Existem tabelas sem classificacao: ${pending.map(table => table.name).join(', ')}`);
  }
  const written = writeSchemaFiles(inventory);
  writeSummary(inventory, written);
  console.log(JSON.stringify({
    ok: true,
    outputDir: OUTPUT_DIR,
    summary: SUMMARY_PATH,
    files: written.map(item => ({
      file: item.fileName,
      domain: item.domain,
      tables: item.tables,
    })),
  }, null, 2));
}

main();
