const { createMysqlConnection } = require('./mysqlRuntime');

const CBS_2026_PERCENTUAL = 0.9;
const IBS_2026_PERCENTUAL = 0.1;
const ANO_TRANSICAO_2026 = 2026;
const DEFAULT_BATCH_SIZE = 5000;

function normalizarTipoInsumo(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function tipoInsumoTributavel2026(tipoInsumo) {
  const tipo = normalizarTipoInsumo(tipoInsumo);
  return tipo === 'material' || /^servi.*o auxiliar$/.test(tipo);
}

function calcularTributosInsumo2026(tipoInsumo, ano, precoReferencia, isPercentual = 0) {
  if (Number(ano) !== ANO_TRANSICAO_2026 || !tipoInsumoTributavel2026(tipoInsumo)) {
    return null;
  }

  const preco = Number(precoReferencia);
  const impostoSeletivo = Number(isPercentual) || 0;
  const iva = CBS_2026_PERCENTUAL + IBS_2026_PERCENTUAL + impostoSeletivo;
  return {
    cbs_percentual: CBS_2026_PERCENTUAL,
    ibs_percentual: IBS_2026_PERCENTUAL,
    is_percentual: impostoSeletivo,
    iva_equivalente: iva,
    preco_sem_tributos: Number.isFinite(preco)
      ? Number((preco / (1 + iva / 100)).toFixed(8))
      : null,
  };
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

function eligibleTypeSql(alias = 'i') {
  return `(
    UPPER(TRIM(COALESCE(${alias}.tipo_insumo,'')))='MATERIAL'
    OR UPPER(TRIM(COALESCE(${alias}.tipo_insumo,''))) LIKE 'SERVI%O AUXILIAR'
  )`;
}

function pendingTaxSql(alias = 'p') {
  return `(
    ABS(COALESCE(${alias}.cbs_percentual,-1)-${CBS_2026_PERCENTUAL}) > 0.00000001
    OR ABS(COALESCE(${alias}.ibs_percentual,-1)-${IBS_2026_PERCENTUAL}) > 0.00000001
    OR ABS(
      COALESCE(${alias}.iva_equivalente,-1)
      - (${CBS_2026_PERCENTUAL + IBS_2026_PERCENTUAL} + COALESCE(${alias}.is_percentual,0))
    ) > 0.00000001
    OR ${alias}.preco_sem_tributos IS NULL
    OR ABS(
      COALESCE(${alias}.preco_sem_tributos,0)
      - (
        COALESCE(${alias}.preco_referencia,0)
        / (1 + (${CBS_2026_PERCENTUAL + IBS_2026_PERCENTUAL} + COALESCE(${alias}.is_percentual,0)) / 100)
      )
    ) > 0.00000001
  )`;
}

async function normalizarTabela(connection, config) {
  const {
    priceTable,
    pricePk,
    inputTable,
    tenant = false,
    batchSize = DEFAULT_BATCH_SIZE,
    onProgress = null,
  } = config;

  if (!await tableExists(connection, priceTable)
      || !await tableExists(connection, inputTable)
      || !await tableExists(connection, 'datas_base')) {
    return { atualizados: 0, lotes: 0, ignorada: true };
  }

  const tenantJoin = tenant
    ? 'i.tenant_id=p.tenant_id AND i.id_insumo=p.id_insumo'
    : 'i.id_insumo=p.id_insumo';
  const tamanhoLote = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
  let atualizados = 0;
  let lotes = 0;

  while (true) {
    const [rows] = await connection.query(`
      SELECT p.\`${pricePk}\` AS id
      FROM \`${priceTable}\` p
      JOIN \`${inputTable}\` i ON ${tenantJoin}
      JOIN \`datas_base\` d ON d.id_data_base=p.id_data_base
      WHERE d.ano=?
        AND ${eligibleTypeSql('i')}
        AND ${pendingTaxSql('p')}
      ORDER BY p.\`${pricePk}\`
      LIMIT ${tamanhoLote}`, [ANO_TRANSICAO_2026]);

    const ids = rows.map(row => Number(row.id)).filter(Number.isFinite);
    if (!ids.length) break;

    const placeholders = ids.map(() => '?').join(',');
    const [result] = await connection.query(`
      UPDATE \`${priceTable}\`
      SET cbs_percentual=?,
          ibs_percentual=?,
          iva_equivalente=? + COALESCE(is_percentual,0),
          preco_sem_tributos=ROUND(
            COALESCE(preco_referencia,0)
            / (1 + (? + COALESCE(is_percentual,0)) / 100),
            8
          )
      WHERE \`${pricePk}\` IN (${placeholders})`, [
      CBS_2026_PERCENTUAL,
      IBS_2026_PERCENTUAL,
      CBS_2026_PERCENTUAL + IBS_2026_PERCENTUAL,
      CBS_2026_PERCENTUAL + IBS_2026_PERCENTUAL,
      ...ids,
    ]);

    const affected = Number(result?.affectedRows || 0);
    atualizados += affected;
    lotes += 1;
    if (typeof onProgress === 'function') {
      onProgress({ tabela: priceTable, atualizados, lotes, lote: affected });
    }
    if (ids.length < tamanhoLote) break;
  }

  return { atualizados, lotes, ignorada: false };
}

async function normalizarTributosInsumos2026(connection, options = {}) {
  const catalogo = await normalizarTabela(connection, {
    priceTable: 'precos_insumos',
    pricePk: 'id_preco',
    inputTable: 'insumos',
    batchSize: options.batchSize,
    onProgress: options.onProgress,
  });
  const tenant = await normalizarTabela(connection, {
    priceTable: 'tenant_precos_insumos',
    pricePk: 'id_tenant_precos_insumos',
    inputTable: 'tenant_insumos',
    tenant: true,
    batchSize: options.batchSize,
    onProgress: options.onProgress,
  });
  return { catalogo, tenant };
}

async function normalizarMysqlTributosInsumos2026(config, options = {}) {
  const connection = await createMysqlConnection(config);
  try {
    return await normalizarTributosInsumos2026(connection, options);
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  ANO_TRANSICAO_2026,
  CBS_2026_PERCENTUAL,
  IBS_2026_PERCENTUAL,
  normalizarTipoInsumo,
  tipoInsumoTributavel2026,
  calcularTributosInsumo2026,
  normalizarTributosInsumos2026,
  normalizarMysqlTributosInsumos2026,
};
