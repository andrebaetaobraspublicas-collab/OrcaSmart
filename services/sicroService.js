const { forEachXlsxRow } = require('../utils/spreadsheetUpload');

const UF_NOME_COD = {
  Acre: 'AC', Alagoas: 'AL', Amapa: 'AP', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceara: 'CE', Ceará: 'CE',
  'Distrito Federal': 'DF', 'Espirito Santo': 'ES', 'Espírito Santo': 'ES', Goias: 'GO', Goiás: 'GO', Maranhao: 'MA', Maranhão: 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Para: 'PA', Pará: 'PA', Paraiba: 'PB', Paraíba: 'PB',
  Parana: 'PR', Paraná: 'PR', Pernambuco: 'PE', Piaui: 'PI', Piauí: 'PI', 'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondonia: 'RO', Rondônia: 'RO', Roraima: 'RR',
  'Santa Catarina': 'SC', 'Sao Paulo': 'SP', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO',
};
const MESES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SECAO_NOMES = { A: 'Equipamentos', B: 'Mao de Obra', C: 'Material', D: 'Atividades Auxiliares', E: 'Tempo Fixo', F: 'Momento de Transporte' };

function semAcento(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function numero(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function mesReferencia(value) {
  const raw = String(value || '').trim();
  const normal = semAcento(raw);
  for (let i = 0; i < MESES.length; i += 1) {
    if (normal.startsWith(MESES[i])) {
      const ano = raw.split('/')[1]?.trim();
      return ano ? `${String(i + 1).padStart(2, '0')}/${ano}` : raw;
    }
  }
  return raw;
}

function codigoUf(value) {
  const raw = String(value || '').trim();
  if (UF_NOME_COD[raw]) return UF_NOME_COD[raw];
  const found = Object.entries(UF_NOME_COD).find(([nome]) => semAcento(nome) === semAcento(raw));
  return found ? found[1] : raw.slice(0, 2).toUpperCase();
}

function letraSecao(value) {
  const match = String(value || '').trim().match(/^([A-F])\s*[-–]/i);
  return match ? match[1].toUpperCase() : null;
}

function codigoItemValido(value, secao) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^[EPMGC]\d[\d.]{2,}$/i.test(raw)) return true;
  return ['D', 'E', 'F'].includes(secao) && /^\d[\d.]{4,}$/.test(raw);
}

function parseSicroWorkbook(buffer, options = {}) {
  const composicoes = [];
  let atual = null;
  let secaoAtual = null;
  const finalize = () => {
    if (atual?.codigo) composicoes.push(atual);
    atual = null;
    secaoAtual = null;
  };

  forEachXlsxRow(buffer, (sourceRow) => {
    const c = Array.from({ length: 15 }, (_, i) => String(sourceRow[i] ?? '').trim());
    const v0 = c[0];
    if (v0.includes('SISTEMA DE CUSTOS REFERENCIAIS')) {
      finalize();
      atual = {
        uf: codigoUf(c[3]), fic: numero(c[7]), codigo: null, descricao: '', mes_referencia: '',
        producao_equipe: null, unidade_producao: '', custo_unitario: null,
        custo_horario_execucao: null, custo_unitario_execucao: null, custo_fic: null,
        subtotal_sicro: null, secoes: {},
      };
      return;
    }
    if (!atual) return;
    if (v0 === 'Custo Unitário de Referência' || semAcento(v0) === 'Custo Unitario de Referencia') {
      atual.mes_referencia = mesReferencia(c[3]);
      atual.producao_equipe = numero(c[7]);
      atual.unidade_producao = c[8];
      return;
    }
    if (!atual.codigo && /^\d[\d.]{4,}$/.test(v0) && c[1]) {
      atual.codigo = `SICRO.${v0}`;
      atual.descricao = c[1];
      return;
    }
    const letra = letraSecao(v0);
    if (letra) {
      secaoAtual = letra;
      atual.secoes[letra] ||= { itens: [], custo_total_secao: null };
      return;
    }
    if (!secaoAtual) return;
    const secao = atual.secoes[secaoAtual];
    const total = semAcento(c.slice(0, 9).join(' '));
    if (total.includes('Custo unitario direto total')) { atual.custo_unitario = numero(c[8]); return; }
    if (total.includes('Custo horario total de execucao')) { atual.custo_horario_execucao = numero(c[8]); return; }
    if (total.includes('Custo unitario de execucao')) { atual.custo_unitario_execucao = numero(c[8]); return; }
    if (total.includes('Custo do FIC')) { atual.custo_fic = numero(c[8]); return; }
    if (/Custo (horario|unitario) total|Custo total de/.test(total)) {
      if (secao.custo_total_secao === null) secao.custo_total_secao = numero(c[8]);
      return;
    }
    if (total.includes('Subtotal')) {
      atual.subtotal_sicro = numero(c[8]);
      return;
    }
    if (v0 === 'Obs.') { secaoAtual = null; return; }
    if (!codigoItemValido(v0, secaoAtual)) return;
    const item = { codigo_item: v0, descricao: c[1] };
    if (secaoAtual === 'A') Object.assign(item, { quantidade: numero(c[2]), util_operativa: numero(c[3]), util_improdutiva: numero(c[4]), custo_hp: numero(c[5]), custo_hi: numero(c[6]), custo_total: numero(c[8]) });
    else if (['B', 'C', 'D'].includes(secaoAtual)) Object.assign(item, { quantidade: numero(c[2]), unidade: c[3], preco_unitario: numero(c[5]), custo_total: numero(c[8]) });
    else if (secaoAtual === 'E') Object.assign(item, { cod_transporte: c[2], quantidade: numero(c[3]), unidade: c[4], preco_unitario: numero(c[6]), custo_total: numero(c[8]) });
    else Object.assign(item, { quantidade: numero(c[2]), unidade: c[3], cod_transp_ln: c[4], cod_transp_rp: c[5], cod_transp_p: c[6], custo_total: numero(c[8]) });
    secao.itens.push(item);
  }, { maxRows: options.maxRows });
  finalize();
  return composicoes;
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params.map(value => value === undefined ? null : value), (err, rows) => err ? reject(err) : resolve(rows || [])));
}
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params.map(value => value === undefined ? null : value), (err, row) => err ? reject(err) : resolve(row || null)));
}
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params.map(value => value === undefined ? null : value), function done(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); }));
}

function analisarMetadadosSicro(buffer) {
  let uf = '';
  let mes = '';
  let total = 0;
  forEachXlsxRow(buffer, (row) => {
    const first = String(row[0] ?? '').trim();
    if (first.includes('SISTEMA DE CUSTOS REFERENCIAIS')) {
      total += 1;
      if (!uf) uf = codigoUf(row[3]);
    } else if (!mes && semAcento(first) === 'Custo Unitario de Referencia') {
      mes = mesReferencia(row[3]);
    }
  });
  return { uf, mes_referencia: mes, qtd_composicoes_estimada: total };
}

async function analisarSicro(db, buffer) {
  const metadados = analisarMetadadosSicro(buffer);
  let sobreposicao = 0;
  if (metadados.uf && metadados.mes_referencia) {
    const row = await dbGet(db, `SELECT COUNT(*) AS total FROM tenant_composicoes
      WHERE fonte='SICRO' AND uf_referencia=? AND mes_referencia=?
        AND UPPER(COALESCE(situacao_ref,'ONERADO'))='ONERADO'
        AND COALESCE(tenant_override_status,'active')='active'`, [metadados.uf, metadados.mes_referencia]).catch(() => null);
    sobreposicao = Number(row?.total || 0);
  }
  return { ...metadados, sobreposicao };
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizarRegimeSicro(value) {
  return semAcento(value).trim().toUpperCase().includes('DESONER')
    ? 'Desonerado'
    : 'Onerado';
}

function codigoBaseSicro(codigo) {
  return String(codigo || '')
    .trim()
    .toUpperCase()
    .replace(/^SICRO\./, '');
}

function compositionKey(codigo, uf, mesReferenciaValor, regime = 'Onerado') {
  return `${codigoBaseSicro(codigo)}|${String(uf || '').trim().toUpperCase()}|${String(mesReferenciaValor || '').trim()}|${normalizarRegimeSicro(regime)}`;
}

async function insertMany(db, table, columns, rows, batchSize = 200) {
  for (const batch of chunks(rows, batchSize)) {
    if (!batch.length) continue;
    const tuple = `(${columns.map(() => '?').join(',')})`;
    await dbRun(db, `INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`, batch.flat());
  }
}

async function updateCompositions(db, rows, batchSize = 100) {
  const columns = ['descricao','unidade','fic','producao_equipe','unidade_producao','custo_unitario','custo_horario_execucao','custo_unitario_execucao','custo_fic','subtotal_sicro','situacao_ref','tenant_updated_at'];
  for (const batch of chunks(rows, batchSize)) {
    if (!batch.length) continue;
    const params = [];
    const assignments = columns.map((column, columnIndex) => {
      const cases = batch.map((row) => {
        params.push(row[row.length - 1], row[columnIndex]);
        return 'WHEN ? THEN ?';
      }).join(' ');
      return `${column}=CASE id_composicao ${cases} ELSE ${column} END`;
    });
    const ids = batch.map(row => row[row.length - 1]);
    params.push(...ids);
    await dbRun(db, `UPDATE tenant_composicoes SET ${assignments.join(',')} WHERE id_composicao IN (${ids.map(() => '?').join(',')})`, params);
  }
}

function arredondarSicro(value) {
  return Number(Number(value || 0).toFixed(4));
}

function prepararComposicoesSicroDesoneradas(composicoes, secoes, itens, precosMaoObra) {
  const secoesPorComposicao = new Map();
  const itensPorSecao = new Map();
  for (const item of itens || []) {
    const key = `${item.id_composicao}|${item.id_secao}`;
    if (!itensPorSecao.has(key)) itensPorSecao.set(key, []);
    itensPorSecao.get(key).push({ ...item });
  }
  for (const secao of secoes || []) {
    const key = String(secao.id_composicao);
    if (!secoesPorComposicao.has(key)) secoesPorComposicao.set(key, []);
    secoesPorComposicao.get(key).push({
      ...secao,
      itens: itensPorSecao.get(`${secao.id_composicao}|${secao.id_secao}`) || [],
    });
  }

  const faltantes = new Set();
  const derivadas = (composicoes || []).map((origem) => {
    const comp = {
      ...origem,
      situacao_ref: 'Desonerado',
      _origem: origem,
      secoes: (secoesPorComposicao.get(String(origem.id_composicao)) || [])
        .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
        .map(secao => ({
          ...secao,
          itens: secao.itens
            .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
            .map(item => ({ ...item })),
        })),
    };
    for (const secao of comp.secoes) {
      if (String(secao.letra_secao || '').toUpperCase() !== 'B') continue;
      for (const item of secao.itens) {
        const codigo = String(item.codigo_item || '').trim().toUpperCase();
        const preco = precosMaoObra.get(codigo);
        if (!(preco >= 0)) {
          faltantes.add(codigo || '(sem código)');
          continue;
        }
        item.preco_unitario = preco;
        item.custo_total = arredondarSicro(Number(item.quantidade || 0) * preco);
      }
    }
    return comp;
  });

  const custoPorCodigo = new Map(derivadas.map(comp => [
    codigoBaseSicro(comp.codigo),
    Number(comp.custo_unitario || 0),
  ]));
  for (let passada = 0; passada < 12; passada += 1) {
    let alterou = false;
    for (const comp of derivadas) {
      const totais = {};
      for (const secao of comp.secoes) {
        const letra = String(secao.letra_secao || '').toUpperCase();
        if (['D', 'E'].includes(letra)) {
          for (const item of secao.itens) {
            const custoComposicao = custoPorCodigo.get(codigoBaseSicro(item.codigo_item));
            if (!(custoComposicao >= 0)) continue;
            item.preco_unitario = custoComposicao;
            item.custo_total = arredondarSicro(Number(item.quantidade || 0) * custoComposicao);
          }
        }
        // O relatório encerra algumas composições com a linha "Subtotal"
        // ainda sob a última seção aberta. Importações antigas acabaram
        // persistindo esse subtotal geral em seções vazias (principalmente D),
        // e a derivação desonerada o somava novamente ao custo de execução.
        // O total confiável de qualquer seção analítica é a soma de seus itens;
        // uma seção sem itens necessariamente contribui com zero.
        secao.custo_total_secao = arredondarSicro(
          secao.itens.reduce((total, item) => total + Number(item.custo_total || 0), 0),
        );
        totais[letra] = secao.custo_total_secao;
      }

      const producao = Number(comp.producao_equipe || 0);
      const custoHorario = Number(totais.A || 0) + Number(totais.B || 0);
      const custoUnitarioExecucao = producao > 0 ? custoHorario / producao : 0;
      const origemExecucao = Number(comp._origem.custo_unitario_execucao || 0);
      const origemFic = Number(comp._origem.custo_fic || 0);
      const fatorFic = origemExecucao > 0 ? origemFic / origemExecucao : Number(comp.fic || 0);
      const custoFic = custoUnitarioExecucao * fatorFic;
      const subtotal = custoUnitarioExecucao + custoFic
        + Number(totais.C || 0) + Number(totais.D || 0);
      const custoUnitario = subtotal + Number(totais.E || 0) + Number(totais.F || 0);
      comp.custo_horario_execucao = arredondarSicro(custoHorario);
      comp.custo_unitario_execucao = arredondarSicro(custoUnitarioExecucao);
      comp.custo_fic = arredondarSicro(custoFic);
      comp.subtotal_sicro = arredondarSicro(subtotal);
      comp.custo_unitario = arredondarSicro(custoUnitario);
      const codigo = codigoBaseSicro(comp.codigo);
      if (Math.abs(Number(custoPorCodigo.get(codigo) || 0) - comp.custo_unitario) > 0.0001) {
        custoPorCodigo.set(codigo, comp.custo_unitario);
        alterou = true;
      }
    }
    if (!alterou) break;
  }

  return { composicoes: derivadas, codigos_mao_obra_sem_preco: [...faltantes].sort() };
}

async function materializarComposicoesSicroDesoneradas(conn, options = {}) {
  const tenantId = Number(options.tenantId);
  const uf = String(options.uf || '').trim().toUpperCase();
  const mesRef = String(options.mesRef || '').trim();
  const precosMaoObra = options.precosMaoObra instanceof Map
    ? options.precosMaoObra
    : new Map(Object.entries(options.precosMaoObra || {}));
  const fontes = await dbAll(conn, `
    SELECT *
    FROM tenant_composicoes
    WHERE fonte='SICRO' AND uf_referencia=? AND mes_referencia=?
      AND UPPER(COALESCE(situacao_ref,'ONERADO'))<>'DESONERADO'
      AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY id_composicao`, [uf, mesRef]);
  if (!fontes.length) {
    const error = new Error(
      `Nenhuma composição analítica SICRO onerada foi encontrada para ${uf} e ${mesRef}. `
      + 'Importe primeiro o Relatório Analítico de Composições de Custos do SICRO.',
    );
    error.status = 409;
    throw error;
  }

  const idsFonte = fontes.map(comp => Number(comp.id_composicao));
  const secoes = [];
  const itens = [];
  for (const batch of chunks(idsFonte, 500)) {
    const marks = batch.map(() => '?').join(',');
    secoes.push(...await dbAll(conn, `
      SELECT * FROM tenant_composicoes_secoes
      WHERE id_composicao IN (${marks})
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY id_composicao, ordem, id_secao`, batch));
    itens.push(...await dbAll(conn, `
      SELECT * FROM tenant_composicoes_secao_itens
      WHERE id_composicao IN (${marks})
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY id_composicao, id_secao, ordem, id_item_secao`, batch));
  }

  const preparadas = prepararComposicoesSicroDesoneradas(fontes, secoes, itens, precosMaoObra);
  if (preparadas.codigos_mao_obra_sem_preco.length) {
    const amostra = preparadas.codigos_mao_obra_sem_preco.slice(0, 12).join(', ');
    const error = new Error(
      `${preparadas.codigos_mao_obra_sem_preco.length} código(s) de mão de obra usados nas composições `
      + `não foram encontrados no relatório desonerado: ${amostra}`
      + `${preparadas.codigos_mao_obra_sem_preco.length > 12 ? '…' : ''}.`,
    );
    error.status = 400;
    throw error;
  }

  const existentes = await dbAll(conn, `
    SELECT id_composicao, codigo
    FROM tenant_composicoes
    WHERE fonte='SICRO' AND uf_referencia=? AND mes_referencia=?
      AND UPPER(COALESCE(situacao_ref,''))='DESONERADO'
      AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY id_composicao`, [uf, mesRef]);
  const existentesPorCodigo = new Map(existentes.map(row => [
    codigoBaseSicro(row.codigo),
    Number(row.id_composicao),
  ]));
  let nextComp = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_composicao),0)+1 AS n FROM tenant_composicoes'))?.n || 1);
  let nextSec = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_secao),0)+1 AS n FROM tenant_composicoes_secoes'))?.n || 1);
  let nextItem = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_item_secao),0)+1 AS n FROM tenant_composicoes_secao_itens'))?.n || 1);
  const now = new Date().toISOString();
  const newComps = [];
  const updateComps = [];
  const replaceIds = [];
  const newSections = [];
  const newItems = [];

  for (const comp of preparadas.composicoes) {
    let id = existentesPorCodigo.get(codigoBaseSicro(comp.codigo));
    if (id) {
      updateComps.push([
        comp.descricao, comp.unidade, comp.fic, comp.producao_equipe,
        comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao,
        comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro,
        'Desonerado', now, id,
      ]);
      replaceIds.push(id);
    } else {
      id = nextComp++;
      newComps.push([
        tenantId, id, comp.codigo, 'SICRO', 'PRODUCAO_HORARIA', comp.descricao,
        comp.unidade, mesRef, uf, 'Desonerado', comp.fic, comp.producao_equipe,
        comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao,
        comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro,
        comp.situacao || 'Ativo', 'create', 'active', now, now,
      ]);
    }
    for (const secao of comp.secoes) {
      const idSecao = nextSec++;
      newSections.push([
        tenantId, idSecao, id, secao.letra_secao, secao.nome_secao,
        secao.custo_total_secao, secao.ordem, 'create', 'active', now, now,
      ]);
      for (const item of secao.itens) {
        newItems.push([
          tenantId, nextItem++, id, idSecao, secao.letra_secao, item.codigo_item,
          item.descricao, item.quantidade, item.unidade, item.util_operativa,
          item.util_improdutiva, item.custo_hp, item.custo_hi, item.preco_unitario,
          item.custo_total, item.cod_transporte, item.cod_transp_ln,
          item.cod_transp_rp, item.cod_transp_p, item.fit, item.dmt, item.ordem,
          'create', 'active', now, now,
        ]);
      }
    }
  }

  for (const batch of chunks(replaceIds, 500)) {
    const marks = batch.map(() => '?').join(',');
    await dbRun(conn, `DELETE FROM tenant_composicoes_secao_itens WHERE id_composicao IN (${marks})`, batch);
    await dbRun(conn, `DELETE FROM tenant_composicoes_secoes WHERE id_composicao IN (${marks})`, batch);
  }
  await updateCompositions(conn, updateComps);
  await insertMany(conn, 'tenant_composicoes', [
    'tenant_id','id_composicao','codigo','fonte','formato','descricao','unidade',
    'mes_referencia','uf_referencia','situacao_ref','fic','producao_equipe',
    'unidade_producao','custo_unitario','custo_horario_execucao',
    'custo_unitario_execucao','custo_fic','subtotal_sicro','situacao',
    'tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at',
  ], newComps, 150);
  await insertMany(conn, 'tenant_composicoes_secoes', [
    'tenant_id','id_secao','id_composicao','letra_secao','nome_secao',
    'custo_total_secao','ordem','tenant_override_action','tenant_override_status',
    'tenant_created_at','tenant_updated_at',
  ], newSections, 300);
  await insertMany(conn, 'tenant_composicoes_secao_itens', [
    'tenant_id','id_item_secao','id_composicao','id_secao','letra_secao',
    'codigo_item','descricao','quantidade','unidade','util_operativa',
    'util_improdutiva','custo_hp','custo_hi','preco_unitario','custo_total',
    'cod_transporte','cod_transp_ln','cod_transp_rp','cod_transp_p','fit','dmt',
    'ordem','tenant_override_action','tenant_override_status','tenant_created_at',
    'tenant_updated_at',
  ], newItems, 250);
  return {
    composicoes_desoneradas_geradas: newComps.length,
    composicoes_desoneradas_atualizadas: updateComps.length,
    secoes_desoneradas_geradas: newSections.length,
    itens_desonerados_gerados: newItems.length,
  };
}

async function importarSicro(db, buffer, options = {}) {
  const composicoes = parseSicroWorkbook(buffer);
  if (!composicoes.length) throw new Error('Nenhuma composicao encontrada. Use o Relatorio Analitico de Composicoes de Custos do SICRO.');
  const tenantId = Number(options.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('Usuario sem tenant valido para a importacao SICRO.');
  const ufOverride = String(options.ufOverride || '').trim().toUpperCase();
  const sobrepor = options.sobrepor === true;
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  progress(12, 'Lendo relatorio', `${composicoes.length.toLocaleString('pt-BR')} composicoes encontradas.`);

  return db.withConnection(async (conn) => {
    await dbRun(conn, 'BEGIN TRANSACTION');
    try {
      await dbGet(conn, 'SELECT GET_LOCK(?, 30) AS acquired', [`sicro-import-${tenantId}`]).catch(() => ({ acquired: 1 }));
      const existing = await dbAll(conn, `SELECT id_composicao, codigo, uf_referencia, mes_referencia, situacao_ref
        FROM tenant_composicoes WHERE fonte='SICRO' AND COALESCE(tenant_override_status,'active')='active'
        ORDER BY id_composicao`);
      const map = new Map(existing.map(row => [
        compositionKey(row.codigo, row.uf_referencia, row.mes_referencia, row.situacao_ref),
        Number(row.id_composicao),
      ]));
      const maxComp = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_composicao),0) AS n FROM tenant_composicoes'))?.n || 0);
      const maxSec = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_secao),0) AS n FROM tenant_composicoes_secoes'))?.n || 0);
      const maxItem = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_item_secao),0) AS n FROM tenant_composicoes_secao_itens'))?.n || 0);
      let nextComp = maxComp + 1;
      let nextSec = maxSec + 1;
      let nextItem = maxItem + 1;
      const newComps = [];
      const updateComps = [];
      const replaceIds = [];
      const sections = [];
      const items = [];
      const counts = { composicoes_inseridas: 0, composicoes_atualizadas: 0, composicoes_ignoradas: 0, secoes_inseridas: 0, itens_inseridos: 0 };
      const now = new Date().toISOString();

      for (const comp of composicoes) {
        const uf = ufOverride || comp.uf;
        const key = compositionKey(comp.codigo, uf, comp.mes_referencia, 'Onerado');
        let id = map.get(key);
        if (id && !sobrepor) { counts.composicoes_ignoradas += 1; continue; }
        if (id) {
          updateComps.push([comp.descricao, comp.unidade_producao, comp.fic, comp.producao_equipe, comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao, comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro, 'Onerado', now, id]);
          replaceIds.push(id);
          counts.composicoes_atualizadas += 1;
        } else {
          id = nextComp++;
          map.set(key, id);
          newComps.push([tenantId, id, comp.codigo, 'SICRO', 'PRODUCAO_HORARIA', comp.descricao, comp.unidade_producao, comp.mes_referencia, uf, 'Onerado', comp.fic, comp.producao_equipe, comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao, comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro, 'Ativo', 'create', 'active', now, now]);
          counts.composicoes_inseridas += 1;
        }
        Object.entries(comp.secoes).sort(([a], [b]) => a.localeCompare(b)).forEach(([letra, secao], ordem) => {
          const idSecao = nextSec++;
          sections.push([tenantId, idSecao, id, letra, SECAO_NOMES[letra] || letra, secao.custo_total_secao, ordem, 'create', 'active', now, now]);
          counts.secoes_inseridas += 1;
          secao.itens.forEach((item, itemOrdem) => {
            items.push([tenantId, nextItem++, id, idSecao, letra, item.codigo_item, item.descricao, item.quantidade, item.unidade, item.util_operativa, item.util_improdutiva, item.custo_hp, item.custo_hi, item.preco_unitario, item.custo_total, item.cod_transporte, item.cod_transp_ln, item.cod_transp_rp, item.cod_transp_p, item.fit, item.dmt, itemOrdem, 'create', 'active', now, now]);
            counts.itens_inseridos += 1;
          });
        });
      }

      progress(25, 'Preparando banco de dados', 'Substituindo somente composicoes SICRO selecionadas.');
      for (const batch of chunks(replaceIds, 500)) {
        const marks = batch.map(() => '?').join(',');
        await dbRun(conn, `DELETE FROM tenant_composicoes_secao_itens WHERE id_composicao IN (${marks})`, batch);
        await dbRun(conn, `DELETE FROM tenant_composicoes_secoes WHERE id_composicao IN (${marks})`, batch);
      }
      await updateCompositions(conn, updateComps);
      progress(40, 'Gravando composicoes', `${counts.composicoes_inseridas} novas e ${counts.composicoes_atualizadas} atualizadas.`);
      await insertMany(conn, 'tenant_composicoes', ['tenant_id','id_composicao','codigo','fonte','formato','descricao','unidade','mes_referencia','uf_referencia','situacao_ref','fic','producao_equipe','unidade_producao','custo_unitario','custo_horario_execucao','custo_unitario_execucao','custo_fic','subtotal_sicro','situacao','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], newComps, 150);
      progress(62, 'Gravando secoes', `${sections.length.toLocaleString('pt-BR')} secoes preparadas.`);
      await insertMany(conn, 'tenant_composicoes_secoes', ['tenant_id','id_secao','id_composicao','letra_secao','nome_secao','custo_total_secao','ordem','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], sections, 300);
      progress(78, 'Gravando itens', `${items.length.toLocaleString('pt-BR')} itens preparados.`);
      await insertMany(conn, 'tenant_composicoes_secao_itens', ['tenant_id','id_item_secao','id_composicao','id_secao','letra_secao','codigo_item','descricao','quantidade','unidade','util_operativa','util_improdutiva','custo_hp','custo_hi','preco_unitario','custo_total','cod_transporte','cod_transp_ln','cod_transp_rp','cod_transp_p','fit','dmt','ordem','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], items, 250);
      await dbRun(conn, 'COMMIT');
      await dbGet(conn, 'SELECT RELEASE_LOCK(?) AS released', [`sicro-import-${tenantId}`]).catch(() => null);
      const first = composicoes[0] || {};
      return { ...counts, total_processadas: composicoes.length, uf: ufOverride || first.uf, mes_referencia: first.mes_referencia, mensagem: `${counts.composicoes_inseridas} composicoes inseridas, ${counts.composicoes_atualizadas} atualizadas, ${counts.secoes_inseridas} secoes e ${counts.itens_inseridos} itens importados.` };
    } catch (err) {
      await dbRun(conn, 'ROLLBACK').catch(() => null);
      await dbGet(conn, 'SELECT RELEASE_LOCK(?) AS released', [`sicro-import-${tenantId}`]).catch(() => null);
      throw err;
    }
  });
}

module.exports = {
  numero,
  mesReferencia,
  parseSicroWorkbook,
  analisarMetadadosSicro,
  analisarSicro,
  importarSicro,
  prepararComposicoesSicroDesoneradas,
  materializarComposicoesSicroDesoneradas,
};
