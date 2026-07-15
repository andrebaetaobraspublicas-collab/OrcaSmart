const { createMysqlConnection } = require('./mysqlRuntime');
const bdiRules = require('../services/bdiRules');

const BDI_COLUMNS = Object.freeze({
  redutor_setorial_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.5',
  redutor_governamental_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.0',
  usa_iva_manual: 'BIGINT NULL DEFAULT 0',
  simples_rbt12: 'DECIMAL(20,8) NULL DEFAULT 0.0',
});

async function ensureTableColumns(connection, table) {
  const [tables] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  if (!tables.length) return [];
  const [rows] = await connection.execute(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  const existing = new Set(rows.map(row => row.COLUMN_NAME));
  const added = [];
  for (const [column, definition] of Object.entries(BDI_COLUMNS)) {
    if (existing.has(column)) continue;
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    added.push(`${table}.${column}`);
  }
  return added;
}

async function ensureMysqlBdiSchema(config) {
  const connection = await createMysqlConnection(config);
  try {
    const added = [];
    added.push(...await ensureTableColumns(connection, 'perfis_bdi'));
    added.push(...await ensureTableColumns(connection, 'tenant_perfis_bdi'));
    return added;
  } finally {
    await connection.end().catch(() => {});
  }
}

function toNum(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function gruposFromComponentes(componentes = []) {
  const soma = grupo => componentes
    .filter(c => c.grupo === grupo)
    .reduce((total, c) => total + toNum(c.percentual, 0), 0);
  return {
    AC: soma('AC'),
    S: soma('S'),
    R: soma('R'),
    DF: soma('DF'),
    L: soma('L'),
  };
}

async function recalcularPerfilMysql(connection, perfil, componentes, updateSql, updateParams) {
  const grupos = gruposFromComponentes(componentes);
  const calculo = bdiRules.calcularBdi(perfil, grupos);
  const bdi = Number(calculo.bdi.toFixed(6));
  const ivaeq = Number(calculo.IVAeq.toFixed(6));
  await connection.execute(updateSql, [
    bdi,
    ivaeq,
    calculo.simples?.aliquota_efetiva ?? toNum(perfil.simples_aliquota_efetiva, 0),
    calculo.simples?.original?.irpj ?? toNum(perfil.simples_irpj_percentual, 0),
    calculo.simples?.original?.csll ?? toNum(perfil.simples_csll_percentual, 0),
    calculo.simples?.faixa ?? perfil.simples_faixa ?? null,
    calculo.simples?.rbt12 ?? toNum(perfil.simples_rbt12, 0),
    ...updateParams,
  ]);
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

async function recalcularCatalogo(connection) {
  if (!await tableExists(connection, 'perfis_bdi')) return { lidos: 0, recalculados: 0, erros: [] };
  const [perfis] = await connection.query(`
    SELECT *
    FROM perfis_bdi
    WHERE COALESCE(situacao,'Ativo') <> 'Inativo'
    ORDER BY id_perfil_bdi`);
  const resultado = { lidos: perfis.length, recalculados: 0, erros: [] };
  for (const perfil of perfis) {
    try {
      const [componentes] = await connection.execute(
        'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? AND COALESCE(ativo,1)=1',
        [perfil.id_perfil_bdi],
      );
      await recalcularPerfilMysql(
        connection,
        perfil,
        componentes,
        `UPDATE perfis_bdi
         SET bdi_percentual=?, ivaeq_percentual=?, simples_aliquota_efetiva=?,
             simples_irpj_percentual=?, simples_csll_percentual=?, simples_faixa=?, simples_rbt12=?
         WHERE id_perfil_bdi=?`,
        [perfil.id_perfil_bdi],
      );
      resultado.recalculados += 1;
    } catch (err) {
      resultado.erros.push({ id: perfil.id_perfil_bdi, erro: err.message || String(err) });
    }
  }
  return resultado;
}

async function recalcularTenant(connection) {
  if (!await tableExists(connection, 'tenant_perfis_bdi')) return { lidos: 0, recalculados: 0, erros: [] };
  const [perfis] = await connection.query(`
    SELECT *
    FROM tenant_perfis_bdi
    WHERE COALESCE(tenant_override_status,'active')='active'
      AND COALESCE(situacao,'Ativo') <> 'Inativo'
    ORDER BY tenant_id, id_tenant_perfis_bdi`);
  const resultado = { lidos: perfis.length, recalculados: 0, erros: [] };
  for (const perfil of perfis) {
    try {
      const idPerfil = perfil.id_perfil_bdi || perfil.id_tenant_perfis_bdi;
      const [componentes] = await connection.execute(`
        SELECT *
        FROM tenant_componentes_bdi
        WHERE tenant_id=? AND id_perfil_bdi=? AND COALESCE(ativo,1)=1
          AND COALESCE(tenant_override_status,'active')='active'`,
      [perfil.tenant_id, idPerfil]);
      await recalcularPerfilMysql(
        connection,
        perfil,
        componentes,
        `UPDATE tenant_perfis_bdi
         SET bdi_percentual=?, ivaeq_percentual=?, simples_aliquota_efetiva=?,
             simples_irpj_percentual=?, simples_csll_percentual=?, simples_faixa=?, simples_rbt12=?,
             tenant_updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND id_tenant_perfis_bdi=?`,
        [perfil.tenant_id, perfil.id_tenant_perfis_bdi],
      );
      resultado.recalculados += 1;
    } catch (err) {
      resultado.erros.push({ id: perfil.id_tenant_perfis_bdi, tenant_id: perfil.tenant_id, erro: err.message || String(err) });
    }
  }
  return resultado;
}

async function recalcularMysqlBdiValores(config) {
  const connection = await createMysqlConnection(config);
  try {
    return {
      catalogo: await recalcularCatalogo(connection),
      tenant: await recalcularTenant(connection),
    };
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = { BDI_COLUMNS, ensureMysqlBdiSchema, recalcularMysqlBdiValores };
