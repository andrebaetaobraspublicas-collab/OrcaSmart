const municipiosRepository = require('../repositories/municipiosRepository');

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const cleaned = String(value).trim().replace('%', '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFraction(value, fallback = 0) {
  const n = toNumber(value, fallback);
  return Math.abs(n) > 1 ? n / 100 : n;
}

function parseAno(value, fallback = 2026) {
  const ano = Number.parseInt(value || fallback, 10);
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) {
    const err = new Error('Ano de referencia invalido.');
    err.status = 400;
    throw err;
  }
  return ano;
}

async function listMunicipios(db, query = {}) {
  const ano = parseAno(query.ano || 2026);
  return municipiosRepository.listMunicipios(db, {
    uf: query.uf,
    busca: String(query.busca || '').trim(),
    ano,
  });
}

async function updateAliquotas(db, idMunicipio, data = {}) {
  const existing = await municipiosRepository.getMunicipio(db, idMunicipio);
  if (!existing) {
    const err = new Error('Municipio nao encontrado.');
    err.status = 404;
    throw err;
  }

  const ano = parseAno(data.ano_aliquota || 2026);
  const ibs = normalizeFraction(data.aliquota_ibs);
  const cbs = normalizeFraction(data.aliquota_cbs);
  const iss = normalizeFraction(data.aliquota_iss);
  const iva = data.iva_percentual === null || data.iva_percentual === undefined || data.iva_percentual === ''
    ? ibs + cbs
    : normalizeFraction(data.iva_percentual);

  return municipiosRepository.upsertAliquotas(db, existing.id_municipio, { ano, iva, cbs, ibs, iss });
}

async function importAliquotas(db, rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    const err = new Error('A planilha nao possui linhas suficientes.');
    err.status = 400;
    throw err;
  }

  const headerIndex = rows.findIndex(row => row.some(cell => /codigo|c[oó]digo|ibge|municip/i.test(String(cell || ''))));
  const header = rows[headerIndex >= 0 ? headerIndex : 0].map(cell => String(cell || '').trim());
  const dataRows = rows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  const normalizedHeader = header.map(h => h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  let ibgeIndex = normalizedHeader.findIndex(h => h.includes('codigo municipio') || h.includes('codigo_municipio') || (h.includes('ibge') && h.includes('municip')));
  if (ibgeIndex < 0) ibgeIndex = normalizedHeader.findIndex(h => h.includes('ibge') || h === 'codigo' || h === 'cod');
  if (ibgeIndex < 0) ibgeIndex = 3;

  const yearColumns = [];
  normalizedHeader.forEach((h, idx) => {
    const compact = h.replace(/\s+/g, ' ').trim();
    const match = compact.match(/\b(iss|ibs|cbs)\b\D*(20\d{2}|19\d{2}|21\d{2})/i);
    if (match) yearColumns.push({ tipo: match[1].toUpperCase(), ano: Number(match[2]), idx });
  });

  const anos = [...new Set(yearColumns.map(c => c.ano))].sort((a, b) => a - b);
  if (!anos.length) {
    const err = new Error('Nenhuma coluna ISS/IBS/CBS encontrada na planilha.');
    err.status = 400;
    throw err;
  }

  let atualizados = 0;
  let naoEncontrados = 0;

  for (const ano of anos) {
    const cols = {
      ISS: yearColumns.find(c => c.ano === ano && c.tipo === 'ISS')?.idx,
      IBS: yearColumns.find(c => c.ano === ano && c.tipo === 'IBS')?.idx,
      CBS: yearColumns.find(c => c.ano === ano && c.tipo === 'CBS')?.idx,
    };

    for (const row of dataRows) {
      const hasAny = ['ISS', 'IBS', 'CBS'].some(tipo => cols[tipo] !== undefined && row[cols[tipo]] !== undefined && row[cols[tipo]] !== '');
      if (!hasAny) continue;
      const codigoRaw = String(row[ibgeIndex] || '').replace(/\D/g, '');
      const codigoIbge = Number.parseInt(codigoRaw, 10);
      if (!Number.isInteger(codigoIbge)) {
        naoEncontrados += 1;
        continue;
      }
      const municipio = await municipiosRepository.getMunicipioByIbge(db, codigoIbge);
      if (!municipio) {
        naoEncontrados += 1;
        continue;
      }
      const iss = cols.ISS !== undefined && row[cols.ISS] !== '' ? normalizeFraction(row[cols.ISS]) : Number(municipio.aliquota_iss || 0);
      const ibs = cols.IBS !== undefined && row[cols.IBS] !== '' ? normalizeFraction(row[cols.IBS]) : Number(municipio.aliquota_ibs || 0);
      const cbs = cols.CBS !== undefined && row[cols.CBS] !== '' ? normalizeFraction(row[cols.CBS]) : Number(municipio.aliquota_cbs || 0);
      await municipiosRepository.upsertAliquotas(db, municipio.id_municipio, {
        ano,
        iva: ibs + cbs,
        cbs,
        ibs,
        iss,
      });
      atualizados += 1;
    }
  }

  return {
    status: 'ok',
    atualizados,
    nao_encontrados: naoEncontrados,
    anos,
    mensagem: `${atualizados} municipios atualizados para os anos ${anos.join(', ')}.`,
  };
}

module.exports = {
  importAliquotas,
  listMunicipios,
  updateAliquotas,
};
