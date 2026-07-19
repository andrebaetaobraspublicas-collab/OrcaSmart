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
      { name: 'id_log', mysql: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', pk: true },
      { name: 'id_admin', mysql: 'BIGINT UNSIGNED NULL' },
      { name: 'admin_email', mysql: 'VARCHAR(191) NULL' },
      { name: 'acao', mysql: 'VARCHAR(191) NOT NULL' },
      { name: 'entidade_tipo', mysql: 'VARCHAR(120) NOT NULL' },
      { name: 'entidade_id', mysql: 'VARCHAR(191) NOT NULL' },
      { name: 'antes', mysql: 'LONGTEXT NULL' },
      { name: 'depois', mysql: 'LONGTEXT NULL' },
      { name: 'created_at', mysql: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' },
    ],
    indexes: [
      'KEY `idx_admin_audit_log_admin` (`id_admin`)',
      'KEY `idx_admin_audit_log_entidade` (`entidade_tipo`, `entidade_id`)',
      'KEY `idx_admin_audit_log_created_at` (`created_at`)',
    ],
  },
};

const EXTRA_INDEXES = {
  tenants: [
    'UNIQUE KEY `uq_tenants_slug` (`slug`)',
    'KEY `idx_tenants_status` (`status`)',
  ],
  users: [
    'UNIQUE KEY `uq_users_email` (`email`)',
    'KEY `idx_users_tenant_status` (`id_tenant`, `status`)',
    'KEY `idx_users_role` (`role`)',
  ],
  subscriptions: [
    'KEY `idx_subscriptions_status` (`status`)',
    'KEY `idx_subscriptions_stripe_subscription` (`stripe_subscription_id`)',
    'KEY `idx_subscriptions_stripe_customer` (`stripe_customer_id`)',
  ],
  composicoes: [
    'KEY `idx_composicoes_fonte_ref` (`fonte`, `uf_referencia`, `mes_referencia`)',
    'KEY `idx_composicoes_codigo` (`codigo`)',
    'KEY `idx_composicoes_formato` (`formato`)',
  ],
  insumos: [
    'KEY `idx_insumos_origem_tipo` (`origem`, `tipo_insumo`)',
    'KEY `idx_insumos_codigo` (`codigo_insumo`)',
    'KEY `idx_insumos_situacao` (`situacao`)',
  ],
  precos_insumos: [
    'KEY `idx_precos_insumos_ref` (`id_insumo`, `id_data_base`, `uf_referencia`)',
    'KEY `idx_precos_insumos_fonte` (`id_fonte`)',
    'KEY `idx_precos_insumos_latest` (`id_insumo`, `id_preco`)',
  ],
  precos_equipamentos: [
    'KEY `idx_precos_equipamentos_ref` (`id_equip`, `id_data_base`, `uf_referencia`, `id_fonte`)',
  ],
  perfis_bdi: [
    'KEY `idx_perfis_bdi_filtros` (`ano_orcamento`, `tipo_obra`, `regime_previdenciario`, `quartil`)',
  ],
  perfis_encargos: [
    'KEY `idx_perfis_encargos_filtros` (`fonte_referencia`, `uf_referencia`, `categoria`, `regime`, `vigencia_inicio`, `vigencia_fim`)',
  ],
  municipios: [
    'KEY `idx_municipios_uf_nome` (`uf`, `nome_municipio`)',
    'KEY `idx_municipios_codigo_ibge` (`codigo_ibge_municipio`)',
  ],
  municipio_aliquotas_anuais: [
    'UNIQUE KEY `uq_municipio_ano` (`id_municipio`, `ano`)',
  ],
  orcamentos: [
    'KEY `idx_orcamentos_tenant_status` (`tenant_id`, `status`)',
    'KEY `idx_orcamentos_tenant_obra` (`tenant_id`, `id_obra`)',
  ],
  orcamento_sintetico: [
    'KEY `idx_orcamento_sintetico_tenant_orcamento` (`tenant_id`, `id_orcamento`)',
    'KEY `idx_orcamento_sintetico_composicao` (`tenant_id`, `id_composicao`)',
    'KEY `idx_orcamento_sintetico_insumo` (`tenant_id`, `id_insumo`)',
  ],
  obras: [
    'KEY `idx_obras_tenant_situacao` (`tenant_id`, `situacao`)',
    'KEY `idx_obras_tenant_uf` (`tenant_id`, `uf`)',
  ],
  tenant_referential_overrides: [
    'KEY `idx_tenant_ref_overrides_lookup` (`tenant_id`, `domain`, `catalog_table`, `catalog_id`, `status`)',
  ],
  tenant_insumos: [
    'KEY `idx_tenant_insumos_listagem` (`tenant_id`, `tenant_override_status`, `tipo_insumo`, `id_insumo`)',
  ],
  tenant_precos_insumos: [
    'KEY `idx_tenant_precos_insumos_latest` (`tenant_id`, `id_insumo`, `id_preco`)',
  ],
};

const MANUAL_COLUMN_TYPES = {
  orcamento_sintetico: {
    id_composicao: 'VARCHAR(191)',
    id_insumo: 'VARCHAR(191)',
    descricao: 'TEXT',
  },
  tenants: {
    nome: 'VARCHAR(255)',
    slug: 'VARCHAR(191)',
    db_path: 'VARCHAR(500)',
  },
  users: {
    nome: 'VARCHAR(255)',
    email: 'VARCHAR(191)',
    password_hash: 'VARCHAR(255)',
    stripe_customer_id: 'VARCHAR(191)',
  },
  subscriptions: {
    stripe_subscription_id: 'VARCHAR(191)',
    stripe_customer_id: 'VARCHAR(191)',
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

  if (MANUAL_COLUMN_TYPES[table] && MANUAL_COLUMN_TYPES[table][column.name]) {
    return MANUAL_COLUMN_TYPES[table][column.name];
  }
  if (looksLikeDateColumn(name, defaultValue)) return 'DATETIME';
  if (isPk && sqliteType.includes('INT')) return 'BIGINT UNSIGNED';
  if (isPk && sqliteType.includes('TEXT')) return 'VARCHAR(191)';
  if (sqliteType.includes('INT')) return looksLikeIdentifier(name) ? 'BIGINT UNSIGNED' : 'BIGINT';
  if (sqliteType.includes('REAL') || sqliteType.includes('FLOA') || sqliteType.includes('DOUB')) return 'DECIMAL(20,8)';
  if (sqliteType.includes('NUM') || sqliteType.includes('DEC')) return 'DECIMAL(20,8)';
  if (sqliteType.includes('BLOB')) return 'LONGBLOB';
  if (name.endsWith('_json') || table === 'admin_audit_log') return 'JSON';
  if (hasTextDefault(column)) return 'VARCHAR(255)';
  if (sqliteType.includes('CHAR') || sqliteType.includes('CLOB') || sqliteType.includes('TEXT')) {
    return varcharTypeForTextColumn(name);
  }
  return 'VARCHAR(255)';
}

function looksLikeIdentifier(name) {
  return name === 'id'
    || name.startsWith('id_')
    || name.endsWith('_id')
    || /^id[A-Z_]/.test(name);
}

function varcharTypeForTextColumn(name) {
  if (name === 'descricao' || name === 'observacoes' || name.includes('obs')) return 'TEXT';
  if (name.includes('json')) return 'JSON';
  if (name === 'email') return 'VARCHAR(191)';
  if (name === 'uf' || name.endsWith('_uf')) return 'VARCHAR(2)';
  if (name.includes('slug')) return 'VARCHAR(191)';
  if (name.includes('path')) return 'VARCHAR(500)';
  if (name.startsWith('codigo') || name.endsWith('_codigo')) return 'VARCHAR(120)';
  if (name === 'codigo' || name === 'fonte' || name === 'origem' || name === 'sistema') return 'VARCHAR(120)';
  if (name === 'domain' || name === 'catalog_table' || name === 'tenant_table') return 'VARCHAR(120)';
  if (name === 'action' || name === 'impact_policy') return 'VARCHAR(80)';
  if (name.includes('referencia') || name.includes('vigencia')) return 'VARCHAR(32)';
  if (name.includes('situacao') || name.includes('status') || name.includes('regime') || name.includes('categoria')) return 'VARCHAR(80)';
  if (name.includes('tipo') || name.includes('formato') || name.includes('grupo') || name.includes('unidade') || name.includes('quartil')) return 'VARCHAR(120)';
  if (name.includes('nome')) return 'VARCHAR(255)';
  return 'TEXT';
}

function mysqlDefault(column, type) {
  const normalized = normalizeDefault(column.default_value);
  if (normalized === null) return '';
  if (type === 'TEXT' || type === 'LONGBLOB' || type === 'JSON') return '';
  if (/^CURRENT_TIMESTAMP$/i.test(normalized)) return ' DEFAULT CURRENT_TIMESTAMP';
  return ` DEFAULT ${normalized}`;
}

function columnLine(column, table, primaryKey, domain) {
  const isSingleIntegerPk = primaryKey.length === 1
    && primaryKey[0] === column.name
    && !['tenant_privado'].includes(domain)
    && !(domain === 'override_tenant' && table === 'tenant_referential_overrides')
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
    lines.push(columnLine(column, table.name, primaryKey, table.domain));
  }

  if (primaryKey.length) {
    const pkColumns = needsTenantId && ['tenant_privado'].includes(table.domain)
      ? ['tenant_id', ...primaryKey]
      : needsTenantId && table.name === 'tenant_referential_overrides'
        ? ['tenant_id', ...primaryKey]
        : primaryKey;
    constraints.push(`  PRIMARY KEY (${pkColumns.map(q).join(', ')})`);
  } else if (columns.length) {
    const pk = syntheticPkName(table.name);
    lines.unshift(`  ${q(pk)} BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`);
    constraints.push(`  PRIMARY KEY (${q(pk)})`);
  }

  for (const fk of table.foreign_keys || []) {
    if (!fk.from || !fk.table || !fk.to) continue;
    constraints.push(`  KEY ${q(`idx_${table.name}_${fk.from}`)} (${q(fk.from)})`);
  }

  for (const index of EXTRA_INDEXES[table.name] || []) {
    constraints.push(`  ${index}`);
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
    '- Colunas de identificadores sao normalizadas para `BIGINT UNSIGNED`.',
    '- Campos curtos usados em filtros e indices sao mapeados para `VARCHAR`.',
    '- Indices iniciais cobrem filtros de catalogo, tenants, orcamentos, obras, precos, BDI, encargos e overrides.',
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
