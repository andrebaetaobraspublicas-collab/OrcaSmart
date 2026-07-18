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
      if (secao.custo_total_secao === null) secao.custo_total_secao = numero(c[8]);
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

async function insertMany(db, table, columns, rows, batchSize = 200) {
  for (const batch of chunks(rows, batchSize)) {
    if (!batch.length) continue;
    const tuple = `(${columns.map(() => '?').join(',')})`;
    await dbRun(db, `INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`, batch.flat());
  }
}

async function updateCompositions(db, rows, batchSize = 100) {
  const columns = ['descricao','unidade','fic','producao_equipe','unidade_producao','custo_unitario','custo_horario_execucao','custo_unitario_execucao','custo_fic','subtotal_sicro','tenant_updated_at'];
  for (const batch of chunks(rows, batchSize)) {
    if (!batch.length) continue;
    const params = [];
    const assignments = columns.map((column, columnIndex) => {
      const cases = batch.map((row) => {
        params.push(row[11], row[columnIndex]);
        return 'WHEN ? THEN ?';
      }).join(' ');
      return `${column}=CASE id_composicao ${cases} ELSE ${column} END`;
    });
    const ids = batch.map(row => row[11]);
    params.push(...ids);
    await dbRun(db, `UPDATE tenant_composicoes SET ${assignments.join(',')} WHERE id_composicao IN (${ids.map(() => '?').join(',')})`, params);
  }
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
      const existing = await dbAll(conn, `SELECT id_composicao, codigo, uf_referencia, mes_referencia
        FROM tenant_composicoes WHERE fonte='SICRO' AND COALESCE(tenant_override_status,'active')='active'`);
      const map = new Map(existing.map(row => [`${row.codigo}|${row.uf_referencia}|${row.mes_referencia}`, Number(row.id_composicao)]));
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
        const key = `${comp.codigo}|${uf}|${comp.mes_referencia}`;
        let id = map.get(key);
        if (id && !sobrepor) { counts.composicoes_ignoradas += 1; continue; }
        if (id) {
          updateComps.push([comp.descricao, comp.unidade_producao, comp.fic, comp.producao_equipe, comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao, comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro, now, id]);
          replaceIds.push(id);
          counts.composicoes_atualizadas += 1;
        } else {
          id = nextComp++;
          map.set(key, id);
          newComps.push([tenantId, id, comp.codigo, 'SICRO', 'PRODUCAO_HORARIA', comp.descricao, comp.unidade_producao, comp.mes_referencia, uf, comp.fic, comp.producao_equipe, comp.unidade_producao, comp.custo_unitario, comp.custo_horario_execucao, comp.custo_unitario_execucao, comp.custo_fic, comp.subtotal_sicro, 'Ativo', 'create', 'active', now, now]);
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
      await insertMany(conn, 'tenant_composicoes', ['tenant_id','id_composicao','codigo','fonte','formato','descricao','unidade','mes_referencia','uf_referencia','fic','producao_equipe','unidade_producao','custo_unitario','custo_horario_execucao','custo_unitario_execucao','custo_fic','subtotal_sicro','situacao','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], newComps, 150);
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

module.exports = { numero, mesReferencia, parseSicroWorkbook, analisarMetadadosSicro, analisarSicro, importarSicro };
