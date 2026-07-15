const fs = require('fs');
const { run, OVERRIDE_SOURCE_TABLES } = require('./tenantTemplate');
const { CATALOG_TABLES, TENANT_TABLES } = require('./dataModelManifest');
const {
  repairTenantBackupForeignKeys,
  sanitizeTenantForeignKeysToCatalog,
} = require('./tenantForeignKeySanitizer');

const ensured = new Set();
const RISK_TABLES = [
  'riscos_analises',
  'riscos_servicos',
  'riscos_eventos',
  'riscos_simulacoes',
  'riscos_bdi_aplicacoes',
];

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function ensureColumn(db, table, column, definition) {
  const columns = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  if (columns.some(row => row.name === column)) return false;
  await run(db, `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${definition}`);
  return true;
}

async function tableExists(db, table, schema = 'main') {
  const rows = await all(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => []);
  return rows.length > 0;
}

async function attachCatalogIfAvailable(db, catalogPath) {
  if (!catalogPath || !fs.existsSync(catalogPath)) return false;
  const databases = await all(db, 'PRAGMA database_list').catch(() => []);
  if (databases.some(row => row.name === 'catalog')) return false;
  await run(db, 'ATTACH DATABASE ? AS catalog', [catalogPath]);
  return true;
}

async function ensureRuntimeOverrideTables(db, catalogPath = '') {
  const attachedHere = await attachCatalogIfAvailable(db, catalogPath).catch(() => false);
  try {
    for (const sourceTable of OVERRIDE_SOURCE_TABLES) {
      const targetTable = `tenant_${sourceTable}`;
      if (!(await tableExists(db, targetTable))) {
        if (await tableExists(db, sourceTable)) {
          await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM ${quoteIdent(sourceTable)} WHERE 0`);
        } else if (await tableExists(db, sourceTable, 'catalog')) {
          await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM catalog.${quoteIdent(sourceTable)} WHERE 0`);
        } else {
          continue;
        }
      }

      await ensureColumn(db, targetTable, 'tenant_catalog_id', 'INTEGER');
      await ensureColumn(db, targetTable, 'tenant_override_action', "TEXT NOT NULL DEFAULT 'create'");
      await ensureColumn(db, targetTable, 'tenant_override_status', "TEXT NOT NULL DEFAULT 'active'");
      await ensureColumn(db, targetTable, 'tenant_created_at', 'TEXT');
      await ensureColumn(db, targetTable, 'tenant_updated_at', 'TEXT');
      await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_catalog`)} ON ${quoteIdent(targetTable)} (tenant_catalog_id)`);
      await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_status`)} ON ${quoteIdent(targetTable)} (tenant_override_status)`);
    }
  } finally {
    if (attachedHere) await run(db, 'DETACH DATABASE catalog').catch(() => {});
  }
}

async function missingRuntimeOverrideTables(db) {
  const missing = [];
  for (const sourceTable of OVERRIDE_SOURCE_TABLES) {
    const targetTable = `tenant_${sourceTable}`;
    if (!(await tableExists(db, targetTable))) missing.push(targetTable);
  }
  return missing;
}

async function missingRiskTables(db) {
  const missing = [];
  for (const table of RISK_TABLES) {
    if (!(await tableExists(db, table))) missing.push(table);
  }
  return missing;
}

async function hasBackupForeignKeyRefs(db, tenantTables = null) {
  const tenantSet = tenantTables
    ? new Set((tenantTables || []).map(table => String(table).toLowerCase()))
    : null;
  const rows = await all(db, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
      AND sql LIKE '%__fk_backup_%'`).catch(() => []);
  return rows.some(row => !tenantSet || tenantSet.has(String(row.name).toLowerCase()));
}

async function ensureRuntimeTenantSchema(db, key = '', catalogPath = '') {
  if (key && ensured.has(key)) {
    const missing = [
      ...(await missingRuntimeOverrideTables(db)),
      ...(await missingRiskTables(db)),
    ];
    const needsFkRepair = await hasBackupForeignKeyRefs(db, TENANT_TABLES);
    if (!missing.length && !needsFkRepair) return false;
    ensured.delete(key);
  }

  await repairTenantBackupForeignKeys(db, TENANT_TABLES);
  await sanitizeTenantForeignKeysToCatalog(db, CATALOG_TABLES, TENANT_TABLES);
  await ensureRuntimeOverrideTables(db, catalogPath);

  await run(db, `CREATE TABLE IF NOT EXISTS riscos_analises (
    id_analise INTEGER PRIMARY KEY AUTOINCREMENT,
    id_orcamento INTEGER NOT NULL,
    nome TEXT NOT NULL,
    regime_execucao TEXT NOT NULL DEFAULT 'preco_unitario',
    criterio_alocacao TEXT NOT NULL DEFAULT 'nao_definido',
    justificativa_variacao_quantidade TEXT,
    justificativa_percentil TEXT,
    metodo_escopo TEXT NOT NULL DEFAULT 'abc_a',
    extrapolar INTEGER NOT NULL DEFAULT 0,
    iteracoes INTEGER NOT NULL DEFAULT 10000,
    percentil_alvo REAL NOT NULL DEFAULT 80,
    semente INTEGER NOT NULL DEFAULT 20260715,
    incluir_eventos INTEGER NOT NULL DEFAULT 1,
    incluir_quantitativos INTEGER NOT NULL DEFAULT 1,
    observacoes TEXT,
    status TEXT NOT NULL DEFAULT 'Em elaboracao',
    resultado_json TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_riscos_analises_orcamento ON riscos_analises (id_orcamento)');

  await run(db, `CREATE TABLE IF NOT EXISTS riscos_servicos (
    id_risco_servico INTEGER PRIMARY KEY AUTOINCREMENT,
    id_analise INTEGER NOT NULL,
    id_item_orcamento INTEGER,
    item_num TEXT,
    codigo TEXT,
    fonte TEXT,
    descricao TEXT NOT NULL,
    unidade TEXT,
    quantidade REAL NOT NULL DEFAULT 0,
    custo_unitario REAL NOT NULL DEFAULT 0,
    valor_base REAL NOT NULL DEFAULT 0,
    classificacao_abc TEXT,
    percentual_abc REAL NOT NULL DEFAULT 0,
    percentual_acumulado REAL NOT NULL DEFAULT 0,
    selecionado INTEGER NOT NULL DEFAULT 0,
    tipo_risco TEXT NOT NULL DEFAULT 'variacao_custo_unitario',
    responsavel TEXT NOT NULL DEFAULT 'contratado',
    incluir_contingencia INTEGER NOT NULL DEFAULT 1,
    distribuicao TEXT NOT NULL DEFAULT 'triangular',
    nivel_qualitativo TEXT DEFAULT 'medio',
    minimo REAL NOT NULL DEFAULT -5,
    mais_provavel REAL NOT NULL DEFAULT 5,
    maximo REAL NOT NULL DEFAULT 10,
    media REAL,
    desvio_padrao REAL,
    probabilidade REAL NOT NULL DEFAULT 100,
    grupo_correlacao TEXT,
    composicao_json TEXT,
    justificativa TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_riscos_servicos_analise ON riscos_servicos (id_analise)');

  await run(db, `CREATE TABLE IF NOT EXISTS riscos_eventos (
    id_evento_risco INTEGER PRIMARY KEY AUTOINCREMENT,
    id_analise INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    categoria TEXT,
    probabilidade REAL NOT NULL DEFAULT 0,
    impacto_minimo REAL NOT NULL DEFAULT 0,
    impacto_mais_provavel REAL NOT NULL DEFAULT 0,
    impacto_maximo REAL NOT NULL DEFAULT 0,
    distribuicao_impacto TEXT NOT NULL DEFAULT 'triangular',
    responsavel TEXT NOT NULL DEFAULT 'contratado',
    incluir_contingencia INTEGER NOT NULL DEFAULT 1,
    estrategia_mitigacao TEXT,
    observacao TEXT,
    grupo_correlacao TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_riscos_eventos_analise ON riscos_eventos (id_analise)');

  await run(db, `CREATE TABLE IF NOT EXISTS riscos_simulacoes (
    id_simulacao INTEGER PRIMARY KEY AUTOINCREMENT,
    id_analise INTEGER NOT NULL,
    metodo TEXT NOT NULL DEFAULT 'monte_carlo',
    parametros_json TEXT,
    resumo_json TEXT NOT NULL,
    amostras_json TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_riscos_simulacoes_analise ON riscos_simulacoes (id_analise, criado_em)');

  await run(db, `CREATE TABLE IF NOT EXISTS riscos_bdi_aplicacoes (
    id_aplicacao_risco INTEGER PRIMARY KEY AUTOINCREMENT,
    id_analise INTEGER NOT NULL,
    id_perfil_bdi TEXT,
    modo TEXT NOT NULL,
    taxa_contingencia REAL NOT NULL DEFAULT 0,
    risco_anterior REAL NOT NULL DEFAULT 0,
    risco_novo REAL NOT NULL DEFAULT 0,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_riscos_bdi_analise ON riscos_bdi_aplicacoes (id_analise)');

  if (await tableExists(db, 'tenant_perfis_bdi')) {
    await ensureColumn(db, 'tenant_perfis_bdi', 'redutor_setorial_ivaeq', 'REAL DEFAULT 0.5');
    await ensureColumn(db, 'tenant_perfis_bdi', 'redutor_governamental_ivaeq', 'REAL DEFAULT 0');
    await ensureColumn(db, 'tenant_perfis_bdi', 'usa_iva_manual', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'tenant_perfis_bdi', 'simples_rbt12', 'REAL DEFAULT 0');
    await ensureColumn(db, 'tenant_perfis_bdi', 'usa_simples_efetiva_manual', 'INTEGER DEFAULT 0');
  }

  await run(db, `
    CREATE TABLE IF NOT EXISTS tenant_referential_overrides (
      id_override INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      catalog_table TEXT NOT NULL,
      catalog_id INTEGER,
      tenant_table TEXT,
      tenant_rowid INTEGER,
      action TEXT NOT NULL CHECK(action IN ('create','update','delete','preserve')),
      impact_policy TEXT NOT NULL DEFAULT 'preserve',
      payload_json TEXT,
      impact_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_tenant_referential_overrides_domain ON tenant_referential_overrides (domain, catalog_table, catalog_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_tenant_referential_overrides_status ON tenant_referential_overrides (status)');

  await ensureColumn(db, 'obras', 'cib', 'TEXT');
  await ensureColumn(db, 'obras', 'id_municipio', 'INTEGER');
  await ensureColumn(db, 'obras', 'ano_realizacao', 'INTEGER');
  await ensureColumn(db, 'obras', 'fator_setorial', 'REAL DEFAULT 0.5');
  await ensureColumn(db, 'obras', 'redutor_compras_governamentais', 'REAL DEFAULT 0');

  if (key) {
    const missing = [
      ...(await missingRuntimeOverrideTables(db)),
      ...(await missingRiskTables(db)),
    ];
    if (!missing.length) ensured.add(key);
  }
  return true;
}

module.exports = { ensureRuntimeTenantSchema };
