const { createMysqlConnection } = require('./mysqlRuntime');
const bdiRules = require('../services/bdiRules');

const BDI_COLUMNS = Object.freeze({
  redutor_setorial_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.5',
  redutor_governamental_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.0',
  usa_iva_manual: 'BIGINT NULL DEFAULT 0',
  simples_rbt12: 'DECIMAL(20,8) NULL DEFAULT 0.0',
  usa_simples_efetiva_manual: 'BIGINT NULL DEFAULT 0',
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
    calculo.simples?.manual ? 1 : 0,
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

function previdenciarioEfetivo(perfil = {}) {
  if (perfil.regime_previdenciario === 'Desonerado') return 'Desonerado';
  if (perfil.regime_previdenciario === 'Onerado') return 'Onerado';
  return perfil.regime_tributario === 'Desonerado' ? 'Desonerado' : 'Onerado';
}

function nomeComRegimePrevidenciario(nome = '', regime = 'Onerado') {
  const limpo = String(nome || 'BDI Simples Nacional')
    .replace(/\s+-\s+(Onerado|Desonerado)$/i, '')
    .trim();
  return `${limpo} - ${regime}`;
}

async function normalizarRegimesPrevidenciariosCatalogo(connection) {
  if (!await tableExists(connection, 'perfis_bdi')) return { normalizados: 0, simplesCriados: 0 };

  const [normalizados] = await connection.execute(`
    UPDATE perfis_bdi
    SET regime_previdenciario='Desonerado'
    WHERE regime_tributario='Desonerado'
      AND COALESCE(regime_previdenciario,'') <> 'Desonerado'`);
  const [personalizados] = await connection.execute(`
    UPDATE perfis_bdi
    SET quartil='Personalizado'
    WHERE COALESCE(quartil,'')=''
      AND (LOWER(COALESCE(nome_perfil,'')) LIKE '%personalizado%'
        OR LOWER(COALESCE(descricao,'')) LIKE '%personalizado%')`);

  const [simples] = await connection.query(`
    SELECT *
    FROM perfis_bdi
    WHERE regime_tributario='Simples Nacional'
    ORDER BY id_perfil_bdi`);
  let simplesCriados = 0;

  for (const perfil of simples) {
    const atual = previdenciarioEfetivo(perfil);
    const alvo = atual === 'Desonerado' ? 'Onerado' : 'Desonerado';
    const [existentes] = await connection.execute(`
      SELECT id_perfil_bdi
      FROM perfis_bdi
      WHERE regime_tributario='Simples Nacional'
        AND COALESCE(tipo_obra,'')=COALESCE(?, '')
        AND COALESCE(ano_orcamento,0)=COALESCE(?, 0)
        AND COALESCE(quartil,'')=COALESCE(?, '')
        AND COALESCE(simples_faixa,0)=COALESCE(?, 0)
        AND COALESCE(regime_previdenciario, CASE WHEN regime_tributario='Desonerado' THEN 'Desonerado' ELSE 'Onerado' END)=?
      LIMIT 1`,
    [perfil.tipo_obra, perfil.ano_orcamento, perfil.quartil, perfil.simples_faixa, alvo]);
    if (existentes.length) continue;

    const [insert] = await connection.execute(`
      INSERT INTO perfis_bdi
      (nome_perfil,tipo_obra,regime_tributario,descricao,bdi_percentual,situacao,usa_reforma_tributaria,
       vigencia,observacoes,ano_orcamento,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,quartil,
       cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,credito_bdi_ivaeq,
       regime_previdenciario,simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,
       simples_irpj_percentual,simples_csll_percentual,redutor_setorial_ivaeq,redutor_governamental_ivaeq,
       usa_iva_manual,simples_rbt12,usa_simples_efetiva_manual)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      nomeComRegimePrevidenciario(perfil.nome_perfil, alvo),
      perfil.tipo_obra,
      'Simples Nacional',
      perfil.descricao,
      perfil.bdi_percentual,
      perfil.situacao,
      perfil.usa_reforma_tributaria,
      perfil.vigencia,
      perfil.observacoes,
      perfil.ano_orcamento,
      perfil.ivaeq_percentual,
      perfil.iss_percentual_manual,
      perfil.id_orcamento_ivaeq,
      perfil.quartil,
      perfil.cbs_percentual,
      perfil.ibs_percentual,
      perfil.fator_efetivo_ivaeq,
      perfil.percentual_mat_ivaeq,
      perfil.credito_bdi_ivaeq,
      alvo,
      perfil.simples_faixa,
      perfil.simples_faixa_label,
      perfil.simples_receita_limite,
      perfil.simples_aliquota_efetiva,
      perfil.simples_irpj_percentual,
      perfil.simples_csll_percentual,
      perfil.redutor_setorial_ivaeq,
      perfil.redutor_governamental_ivaeq,
      perfil.usa_iva_manual,
      perfil.simples_rbt12,
      perfil.usa_simples_efetiva_manual || 0,
    ]);

    const novoId = insert.insertId;
    await connection.execute(`
      INSERT INTO componentes_bdi
      (id_perfil_bdi,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes)
      SELECT ?,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes
      FROM componentes_bdi
      WHERE id_perfil_bdi=?`,
    [novoId, perfil.id_perfil_bdi]);
    simplesCriados += 1;
  }

  return {
    normalizados: normalizados.affectedRows || 0,
    personalizados: personalizados.affectedRows || 0,
    simplesCriados,
  };
}

async function normalizarRegimesPrevidenciariosTenant(connection) {
  if (!await tableExists(connection, 'tenant_perfis_bdi')) return { normalizados: 0 };
  const [normalizados] = await connection.execute(`
    UPDATE tenant_perfis_bdi
    SET regime_previdenciario='Desonerado'
    WHERE regime_tributario='Desonerado'
      AND COALESCE(regime_previdenciario,'') <> 'Desonerado'`);
  const [personalizados] = await connection.execute(`
    UPDATE tenant_perfis_bdi
    SET quartil='Personalizado'
    WHERE COALESCE(quartil,'')=''
      AND (LOWER(COALESCE(nome_perfil,'')) LIKE '%personalizado%'
        OR LOWER(COALESCE(descricao,'')) LIKE '%personalizado%')`);
  return {
    normalizados: normalizados.affectedRows || 0,
    personalizados: personalizados.affectedRows || 0,
  };
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
             simples_irpj_percentual=?, simples_csll_percentual=?, simples_faixa=?, simples_rbt12=?,
             usa_simples_efetiva_manual=?
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
             usa_simples_efetiva_manual=?, tenant_updated_at=CURRENT_TIMESTAMP
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
    const sincronizacao = {
      catalogo: await normalizarRegimesPrevidenciariosCatalogo(connection),
      tenant: await normalizarRegimesPrevidenciariosTenant(connection),
    };
    return {
      sincronizacao,
      catalogo: await recalcularCatalogo(connection),
      tenant: await recalcularTenant(connection),
    };
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  BDI_COLUMNS,
  ensureMysqlBdiSchema,
  recalcularMysqlBdiValores,
  normalizarRegimesPrevidenciariosCatalogo,
  normalizarRegimesPrevidenciariosTenant,
};
