const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { createMysqlConnection } = require('../utils/mysqlRuntime');

const SEED_PATH = path.join(__dirname, '..', 'database', 'seeds', 'emop-062025.json.gz');
const EXPECTED = Object.freeze({ composicoes: 22202, insumos: 7179, precos: 7134 });
const SOURCE = 'EMOP';
const UF = 'RJ';
const REFERENCE = '06/2025';
const BATCH_SIZE = 250;

function readSeed(seedPath = SEED_PATH) {
  const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(seedPath)).toString('utf8'));
  validateSeed(payload);
  return payload;
}

function validateSeed(payload) {
  if (!payload || !payload.meta || !Array.isArray(payload.composicoes) || !Array.isArray(payload.insumos)) {
    throw new Error('Seed EMOP invalido ou incompleto.');
  }
  const meta = payload.meta;
  if (meta.fonte !== SOURCE || meta.uf !== UF || meta.data_base !== REFERENCE) {
    throw new Error('Metadados do seed EMOP nao correspondem a EMOP/RJ 06/2025.');
  }
  if (payload.composicoes.length !== EXPECTED.composicoes || payload.insumos.length !== EXPECTED.insumos) {
    throw new Error('Quantidade de registros do seed EMOP diverge da extracao auditada.');
  }
  if (new Set(payload.composicoes.map(item => item.codigo)).size !== EXPECTED.composicoes
    || new Set(payload.insumos.map(item => item.codigo)).size !== EXPECTED.insumos) {
    throw new Error('O seed EMOP contem codigos duplicados.');
  }
  const availablePrices = payload.insumos.filter(item => item.preco !== null && item.preco !== undefined).length;
  if (availablePrices !== EXPECTED.precos) {
    throw new Error('Quantidade de precos do seed EMOP diverge da extracao auditada.');
  }
  return true;
}

function compositionRegime(code) {
  const suffix = String(code || '').slice(-1).toUpperCase();
  if (/^[A-E]$/.test(suffix)) return 'Desonerado';
  if (/^[0-4]$/.test(suffix)) return 'Não desonerado';
  return null;
}

function normalizeUnit(value) {
  return String(value || '#N/D').trim().toUpperCase() || '#N/D';
}

function placeholders(rowLength, rows) {
  return Array.from({ length: rows }, () => `(${Array(rowLength).fill('?').join(',')})`).join(',');
}

async function insertBatches(connection, sqlPrefix, rows, onProgress, phase) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const values = batch.flat();
    await connection.execute(`${sqlPrefix} VALUES ${placeholders(batch[0].length, batch.length)}`, values);
    inserted += batch.length;
    if (onProgress) onProgress({ phase, inserted, total: rows.length });
  }
}

async function currentCounts(connection) {
  const [[compositions]] = await connection.execute(
    'SELECT COUNT(*) AS total FROM composicoes WHERE fonte=? AND uf_referencia=? AND mes_referencia=?',
    [SOURCE, UF, REFERENCE],
  );
  const [[inputs]] = await connection.execute(
    'SELECT COUNT(*) AS total FROM insumos WHERE origem=?',
    [SOURCE],
  );
  const [[prices]] = await connection.execute(`
    SELECT COUNT(*) AS total
    FROM precos_insumos p
    INNER JOIN insumos i ON i.id_insumo=p.id_insumo
    INNER JOIN datas_base d ON d.id_data_base=p.id_data_base
    INNER JOIN fontes_referencia f ON f.id_fonte=p.id_fonte
    WHERE i.origem=? AND f.nome_fonte=? AND p.uf_referencia=? AND d.mes=6 AND d.ano=2025
  `, [SOURCE, SOURCE, UF]);
  return {
    composicoes: Number(compositions.total),
    insumos: Number(inputs.total),
    precos: Number(prices.total),
  };
}

function complete(counts) {
  return counts.composicoes === EXPECTED.composicoes
    && counts.insumos === EXPECTED.insumos
    && counts.precos === EXPECTED.precos;
}

async function ensureSource(connection) {
  const [rows] = await connection.execute(
    'SELECT id_fonte FROM fontes_referencia WHERE LOWER(TRIM(nome_fonte))=LOWER(?) ORDER BY id_fonte LIMIT 1',
    [SOURCE],
  );
  if (rows[0]) {
    await connection.execute(`
      UPDATE fontes_referencia
      SET nome_fonte=?, tipo_fonte='Oficial', orgao_responsavel=?, abrangencia=?, observacoes=?
      WHERE id_fonte=?
    `, [
      SOURCE,
      'Empresa de Obras Públicas do Estado do Rio de Janeiro - EMOP-RJ',
      UF,
      'Catálogo oficial EMOP-RJ, referência junho de 2025.',
      rows[0].id_fonte,
    ]);
    return rows[0].id_fonte;
  }
  const [result] = await connection.execute(`
    INSERT INTO fontes_referencia (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia,observacoes)
    VALUES (?,'Oficial',?,?,?)
  `, [
    SOURCE,
    'Empresa de Obras Públicas do Estado do Rio de Janeiro - EMOP-RJ',
    UF,
    'Catálogo oficial EMOP-RJ, referência junho de 2025.',
  ]);
  return result.insertId;
}

async function ensureDate(connection) {
  const [rows] = await connection.execute(
    'SELECT id_data_base FROM datas_base WHERE mes=6 AND ano=2025 ORDER BY id_data_base LIMIT 1',
  );
  if (rows[0]) return rows[0].id_data_base;
  const [result] = await connection.execute(
    'INSERT INTO datas_base (mes,ano,data_referencia,descricao) VALUES (6,2025,?,?)',
    [REFERENCE, 'EMOP/RJ 06/2025'],
  );
  return result.insertId;
}

async function ensureUnits(connection, inputs) {
  const [existing] = await connection.execute('SELECT id_unidade,sigla FROM unidades_medida');
  const byUnit = new Map(existing.map(row => [normalizeUnit(row.sigla), row.id_unidade]));
  const required = [...new Set(inputs.map(item => normalizeUnit(item.unidade)))];
  for (const unit of required) {
    if (byUnit.has(unit)) continue;
    const [result] = await connection.execute(
      'INSERT INTO unidades_medida (sigla,descricao,tipo_unidade) VALUES (?,?,?)',
      [unit, unit, 'Outro'],
    );
    byUnit.set(unit, result.insertId);
  }
  return byUnit;
}

async function replaceCatalog(connection, seed, options = {}) {
  const onProgress = options.onProgress;
  await connection.beginTransaction();
  try {
    const idFonte = await ensureSource(connection);
    const idDataBase = await ensureDate(connection);
    const units = await ensureUnits(connection, seed.insumos);

    await connection.execute(
      'DELETE p FROM precos_insumos p INNER JOIN insumos i ON i.id_insumo=p.id_insumo WHERE i.origem=?',
      [SOURCE],
    );
    await connection.execute('DELETE FROM insumos WHERE origem=?', [SOURCE]);
    await connection.execute(
      'DELETE FROM composicoes WHERE fonte=? AND uf_referencia=? AND mes_referencia=?',
      [SOURCE, UF, REFERENCE],
    );

    const compositionRows = seed.composicoes.map(item => [
      item.codigo,
      SOURCE,
      'SINTETICO',
      item.descricao,
      normalizeUnit(item.unidade),
      REFERENCE,
      UF,
      compositionRegime(item.codigo),
      item.preco,
      'Ativo',
      'Composição sintética publicada no Catálogo EMOP-RJ 06/2025; o PDF não informa os itens analíticos.',
    ]);
    await insertBatches(connection, `
      INSERT INTO composicoes
      (codigo,fonte,formato,descricao,unidade,mes_referencia,uf_referencia,situacao_ref,custo_unitario,situacao,observacoes)
    `, compositionRows, onProgress, 'composicoes');

    const inputRows = seed.insumos.map(item => [
      item.codigo,
      item.descricao,
      'Material',
      units.get(normalizeUnit(item.unidade)),
      SOURCE,
      'Não',
      'Ativo',
      item.preco === null || item.preco === undefined
        ? 'Catálogo EMOP-RJ 06/2025: preço mascarado/indisponível na publicação. Tipo de insumo não informado no catálogo sintético.'
        : 'Catálogo EMOP-RJ 06/2025. Tipo de insumo não informado no catálogo sintético.',
    ]);
    await insertBatches(connection, `
      INSERT INTO insumos
      (codigo_insumo,descricao,tipo_insumo,id_unidade,origem,encargos_aplicaveis,situacao,observacoes)
    `, inputRows, onProgress, 'insumos');

    const [insertedInputs] = await connection.execute(
      'SELECT id_insumo,codigo_insumo FROM insumos WHERE origem=?',
      [SOURCE],
    );
    const ids = new Map(insertedInputs.map(row => [String(row.codigo_insumo), row.id_insumo]));
    if (ids.size !== EXPECTED.insumos) throw new Error('Nao foi possivel relacionar todos os insumos EMOP inseridos.');

    const priceRows = seed.insumos
      .filter(item => item.preco !== null && item.preco !== undefined)
      .map(item => [
        ids.get(String(item.codigo)),
        idDataBase,
        idFonte,
        UF,
        item.preco,
        item.preco,
        item.preco,
        '30/06/2025',
        'Preço unitário publicado no Catálogo EMOP-RJ 06/2025.',
      ]);
    await insertBatches(connection, `
      INSERT INTO precos_insumos
      (id_insumo,id_data_base,id_fonte,uf_referencia,preco_desonerado,preco_nao_desonerado,preco_referencia,data_coleta,observacoes)
    `, priceRows, onProgress, 'precos');

    const counts = await currentCounts(connection);
    if (!complete(counts)) {
      throw new Error(`Carga EMOP incompleta: ${JSON.stringify(counts)}`);
    }
    await connection.commit();
    return { status: 'imported', ...counts, precosIndisponiveis: EXPECTED.insumos - EXPECTED.precos };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

async function ensureEmopCatalog(config, options = {}) {
  const connection = await createMysqlConnection(config);
  try {
    const counts = await currentCounts(connection);
    if (complete(counts)) {
      return { status: 'already-current', ...counts, precosIndisponiveis: EXPECTED.insumos - EXPECTED.precos };
    }
    return await replaceCatalog(connection, readSeed(options.seedPath), options);
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  ensureEmopCatalog,
  _test: { EXPECTED, readSeed, validateSeed, compositionRegime, normalizeUnit, complete },
};
