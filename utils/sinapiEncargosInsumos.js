const { createMysqlConnection } = require('./mysqlRuntime');

const DEFAULT_BATCH_SIZE = 500;

function normalizarTexto(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function categoriaEncargoInsumo(unidade, descricao = '') {
  const sigla = normalizarTexto(unidade).replace(/\./g, '');
  if (['h', 'hr', 'hora', 'horas'].includes(sigla)) return 'Horista';
  if (['mes', 'mensal', 'meses'].includes(sigla)) return 'Mensalista';
  const texto = normalizarTexto(descricao);
  if (texto.includes('mensalista')) return 'Mensalista';
  if (texto.includes('horista')) return 'Horista';
  return null;
}

function regimeEncargoPerfil(value) {
  const regime = normalizarTexto(value);
  if (regime === 'normal'
      || regime === 'onerado'
      || regime.includes('sem desoner')
      || regime.includes('nao desoner')) return 'Onerado';
  if (regime.includes('desoner')) return 'Desonerado';
  return null;
}

function mesIndex(mes, ano) {
  const m = Number(mes);
  const a = Number(ano);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(a) || a < 1900) return null;
  return a * 12 + m;
}

function dataIndex(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{1,2})/);
  if (match) return mesIndex(Number(match[2]), Number(match[1]));
  match = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) return mesIndex(Number(match[1]), Number(match[2]));
  return null;
}

function percentualPerfil(perfil) {
  const raw = perfil?.encargo_original_percentual ?? perfil?.encargo_total;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function scoreTemporal(perfil, contexto) {
  const alvo = mesIndex(contexto.mes, contexto.ano);
  if (alvo === null) return null;
  const perfilData = mesIndex(perfil.data_base_mes, perfil.data_base_ano);
  if (perfil.id_data_base != null && perfil.id_data_base !== '') {
    return perfilData === alvo ? 0 : null;
  }
  const inicio = dataIndex(perfil.vigencia_inicio);
  const fim = dataIndex(perfil.vigencia_fim);
  if (inicio !== null || fim !== null) {
    if (inicio !== null && alvo < inicio) return null;
    if (fim !== null && alvo > fim) return null;
    return 1;
  }
  const vigencia = dataIndex(perfil.vigencia);
  if (vigencia !== null) return vigencia === alvo ? 2 : null;
  return 3;
}

function selecionarPerfilEncargoSinapi(perfis, contexto, regime) {
  const uf = String(contexto.uf || '').trim().toUpperCase();
  const categoria = String(contexto.categoria || '').trim();
  if (!uf || !categoria) return null;
  const tenantId = contexto.tenant_id == null ? null : String(contexto.tenant_id);
  return (perfis || [])
    .map((perfil) => {
      if (normalizarTexto(perfil.fonte_referencia) !== 'sinapi') return null;
      if (String(perfil.uf_referencia || '').trim().toUpperCase() !== uf) return null;
      if (normalizarTexto(perfil.categoria) !== normalizarTexto(categoria)) return null;
      if (regimeEncargoPerfil(perfil.regime) !== regime) return null;
      if (normalizarTexto(perfil.situacao || 'ativo') !== 'ativo') return null;
      const percentual = percentualPerfil(perfil);
      if (percentual === null) return null;
      const temporal = scoreTemporal(perfil, contexto);
      if (temporal === null) return null;
      const perfilTenant = perfil.tenant_id == null ? null : String(perfil.tenant_id);
      if (perfilTenant !== null && perfilTenant !== tenantId) return null;
      return {
        perfil,
        percentual,
        score: [
          perfilTenant !== null && perfilTenant === tenantId ? 0 : 1,
          temporal,
          perfil.encargo_original_percentual == null ? 1 : 0,
          -Number(perfil.id_perfil || perfil.id_tenant_perfis_encargos || 0),
        ],
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i += 1) {
        if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      }
      return 0;
    })[0] || null;
}

function resolverEncargosInsumoSinapi(perfis, row) {
  const categoria = categoriaEncargoInsumo(row.unidade, row.descricao);
  if (!categoria) return null;
  const contexto = {
    uf: row.uf_referencia,
    mes: row.mes,
    ano: row.ano,
    categoria,
    tenant_id: row.tenant_id,
  };
  const onerado = selecionarPerfilEncargoSinapi(perfis, contexto, 'Onerado');
  const desonerado = selecionarPerfilEncargoSinapi(perfis, contexto, 'Desonerado');
  if (!onerado && !desonerado) return null;
  return {
    categoria,
    onerado_percentual: onerado?.percentual ?? null,
    desonerado_percentual: desonerado?.percentual ?? null,
    id_perfil_onerado: onerado?.perfil?.tenant_id != null
      ? (onerado?.perfil?.id_tenant_perfis_encargos || onerado?.perfil?.id_perfil || null)
      : (onerado?.perfil?.id_perfil || null),
    id_perfil_desonerado: desonerado?.perfil?.tenant_id != null
      ? (desonerado?.perfil?.id_tenant_perfis_encargos || desonerado?.perfil?.id_perfil || null)
      : (desonerado?.perfil?.id_perfil || null),
  };
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function ensureColumns(connection, table) {
  const columns = [
    ['encargos_sociais_onerado_percentual', 'DECIMAL(20,8) NULL'],
    ['encargos_sociais_desonerado_percentual', 'DECIMAL(20,8) NULL'],
    ['id_perfil_encargo_onerado', 'BIGINT UNSIGNED NULL'],
    ['id_perfil_encargo_desonerado', 'BIGINT UNSIGNED NULL'],
  ];
  const created = [];
  for (const [column, ddl] of columns) {
    if (!await columnExists(connection, table, column)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
      created.push(column);
    }
  }
  return created;
}

async function carregarPerfis(connection) {
  const [catalogo] = await connection.query(`
    SELECT pe.*, db.mes AS data_base_mes, db.ano AS data_base_ano, NULL AS tenant_id
    FROM perfis_encargos pe
    LEFT JOIN datas_base db ON db.id_data_base=pe.id_data_base
    WHERE UPPER(TRIM(COALESCE(pe.fonte_referencia,'')))='SINAPI'
      AND COALESCE(pe.situacao,'Ativo')='Ativo'`);
  if (!await tableExists(connection, 'tenant_perfis_encargos')) return catalogo;
  const hasTenantDatasBase = await tableExists(connection, 'tenant_datas_base');
  const tenantDataJoin = hasTenantDatasBase
    ? `LEFT JOIN tenant_datas_base tdb
         ON tdb.tenant_id=pe.tenant_id AND tdb.id_data_base=pe.id_data_base`
    : '';
  const tenantMes = hasTenantDatasBase ? 'COALESCE(tdb.mes,db.mes)' : 'db.mes';
  const tenantAno = hasTenantDatasBase ? 'COALESCE(tdb.ano,db.ano)' : 'db.ano';
  const [tenant] = await connection.query(`
    SELECT pe.*, ${tenantMes} AS data_base_mes,
           ${tenantAno} AS data_base_ano
    FROM tenant_perfis_encargos pe
    ${tenantDataJoin}
    LEFT JOIN datas_base db ON db.id_data_base=pe.id_data_base
    WHERE UPPER(TRIM(COALESCE(pe.fonte_referencia,'')))='SINAPI'
      AND COALESCE(pe.situacao,'Ativo')='Ativo'
      AND COALESCE(pe.tenant_override_status,'active')='active'`);
  return [...catalogo, ...tenant];
}

function sameNullableNumber(a, b) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return Math.abs(Number(a) - Number(b)) < 0.00000001;
}

async function atualizarLote(connection, table, pk, rows) {
  if (!rows.length) return 0;
  const fields = [
    'encargos_sociais_onerado_percentual',
    'encargos_sociais_desonerado_percentual',
    'id_perfil_encargo_onerado',
    'id_perfil_encargo_desonerado',
  ];
  const params = [];
  const sets = fields.map((field) => {
    const cases = rows.map((row) => {
      params.push(row.id, row[field]);
      return 'WHEN ? THEN ?';
    }).join(' ');
    return `\`${field}\`=CASE \`${pk}\` ${cases} ELSE \`${field}\` END`;
  });
  const ids = rows.map(row => row.id);
  params.push(...ids);
  const [result] = await connection.query(`
    UPDATE \`${table}\`
    SET ${sets.join(', ')}
    WHERE \`${pk}\` IN (${ids.map(() => '?').join(',')})`, params);
  return Number(result?.affectedRows || 0);
}

async function normalizarTabela(connection, perfis, config, options = {}) {
  const { priceTable, pricePk, inputTable, tenant = false } = config;
  if (!await tableExists(connection, priceTable) || !await tableExists(connection, inputTable)) {
    return { associados: 0, sem_perfil: 0, conferidos: 0, ignorada: true };
  }
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
  const tenantJoin = tenant
    ? 'i.tenant_id=p.tenant_id AND i.id_insumo=p.id_insumo'
    : 'i.id_insumo=p.id_insumo';
  const hasTenantDatasBase = tenant && await tableExists(connection, 'tenant_datas_base');
  const tenantDataJoin = hasTenantDatasBase
    ? `LEFT JOIN tenant_datas_base tdb
         ON tdb.tenant_id=p.tenant_id AND tdb.id_data_base=p.id_data_base`
    : '';
  const mesExpr = hasTenantDatasBase ? 'COALESCE(tdb.mes,db.mes)' : 'db.mes';
  const anoExpr = hasTenantDatasBase ? 'COALESCE(tdb.ano,db.ano)' : 'db.ano';
  let lastId = 0;
  let associados = 0;
  let semPerfil = 0;
  let conferidos = 0;
  while (true) {
    const [rows] = await connection.query(`
      SELECT p.\`${pricePk}\` AS id, ${tenant ? 'p.tenant_id,' : 'NULL AS tenant_id,'}
             p.uf_referencia, ${mesExpr} AS mes, ${anoExpr} AS ano, i.descricao,
             COALESCE(um.sigla,'') AS unidade,
             p.encargos_sociais_onerado_percentual,
             p.encargos_sociais_desonerado_percentual,
             p.id_perfil_encargo_onerado,
             p.id_perfil_encargo_desonerado
      FROM \`${priceTable}\` p
      JOIN \`${inputTable}\` i ON ${tenantJoin}
      LEFT JOIN unidades_medida um ON um.id_unidade=i.id_unidade
      ${tenantDataJoin}
      LEFT JOIN datas_base db ON db.id_data_base=p.id_data_base
      WHERE p.\`${pricePk}\`>?
        AND UPPER(TRIM(COALESCE(i.origem,'')))='SINAPI'
        AND (
          UPPER(TRIM(COALESCE(i.tipo_insumo,''))) LIKE 'M%O DE OBRA'
          OR UPPER(TRIM(COALESCE(i.tipo_insumo,'')))='MAO DE OBRA'
        )
        ${tenant ? "AND COALESCE(p.tenant_override_status,'active')='active' AND COALESCE(i.tenant_override_status,'active')='active'" : ''}
      ORDER BY p.\`${pricePk}\`
      LIMIT ${batchSize}`, [lastId]);
    if (!rows.length) break;
    const updates = [];
    for (const row of rows) {
      lastId = Math.max(lastId, Number(row.id) || lastId);
      conferidos += 1;
      const resolved = resolverEncargosInsumoSinapi(perfis, row);
      if (!resolved || resolved.onerado_percentual == null || resolved.desonerado_percentual == null) {
        semPerfil += 1;
        continue;
      }
      const update = {
        id: row.id,
        encargos_sociais_onerado_percentual: resolved.onerado_percentual,
        encargos_sociais_desonerado_percentual: resolved.desonerado_percentual,
        id_perfil_encargo_onerado: resolved.id_perfil_onerado,
        id_perfil_encargo_desonerado: resolved.id_perfil_desonerado,
      };
      const changed = Object.keys(update)
        .filter(key => key !== 'id')
        .some(key => !sameNullableNumber(row[key], update[key]));
      if (changed) updates.push(update);
    }
    associados += await atualizarLote(connection, priceTable, pricePk, updates);
    if (typeof options.onProgress === 'function') {
      options.onProgress({ tabela: priceTable, associados, sem_perfil: semPerfil, conferidos });
    }
    if (rows.length < batchSize) break;
  }
  return { associados, sem_perfil: semPerfil, conferidos, ignorada: false };
}

async function normalizarEncargosInsumosSinapi(connection, options = {}) {
  const schema = {};
  for (const table of ['precos_insumos', 'tenant_precos_insumos']) {
    if (await tableExists(connection, table)) schema[table] = await ensureColumns(connection, table);
  }
  const perfis = await carregarPerfis(connection);
  const catalogo = await normalizarTabela(connection, perfis, {
    priceTable: 'precos_insumos',
    pricePk: 'id_preco',
    inputTable: 'insumos',
  }, options);
  const tenant = await normalizarTabela(connection, perfis, {
    priceTable: 'tenant_precos_insumos',
    pricePk: 'id_tenant_precos_insumos',
    inputTable: 'tenant_insumos',
    tenant: true,
  }, options);
  return { schema, perfis: perfis.length, catalogo, tenant };
}

async function normalizarMysqlEncargosInsumosSinapi(config, options = {}) {
  const connection = await createMysqlConnection(config);
  try {
    return await normalizarEncargosInsumosSinapi(connection, options);
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  categoriaEncargoInsumo,
  regimeEncargoPerfil,
  selecionarPerfilEncargoSinapi,
  resolverEncargosInsumoSinapi,
  normalizarEncargosInsumosSinapi,
  normalizarMysqlEncargosInsumosSinapi,
};
