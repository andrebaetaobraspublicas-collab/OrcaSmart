const crypto = require('crypto');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseOrseFilename(filename) {
  const name = String(filename || '').trim();
  const match = name.match(/^(\d{4})(0[1-9]|1[0-2])(\d{2})-(\d{2})\.orse$/i);
  if (!match) return null;
  return {
    ano: Number(match[1]),
    mes: Number(match[2]),
    ordem: Number(match[3]),
    anexo: Number(match[4]),
    referencia: `${match[2]}/${match[1]}`,
  };
}

function shannonEntropy(buffer) {
  if (!buffer?.length) return 0;
  const counts = new Uint32Array(256);
  for (const byte of buffer) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const probability = count / buffer.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function knownFormat(buffer) {
  if (buffer.subarray(0, 16).toString('ascii') === 'SQLite format 3\0') return 'SQLite';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'ZIP/Office';
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return 'GZIP';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'PDF';
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'OLE/Office legado';
  return null;
}

function analyzeOrseFile(file = {}) {
  const filename = String(file.originalname || '').trim();
  const buffer = file.buffer;
  if (!/\.orse$/i.test(filename)) throw httpError(400, 'O arquivo deve possuir a extensão .ORSE.');
  if (!Buffer.isBuffer(buffer) || buffer.length < 256) throw httpError(400, 'O arquivo ORSE está vazio ou incompleto.');

  const metadata = parseOrseFilename(filename);
  if (!metadata) {
    throw httpError(400, 'Nome de arquivo ORSE inválido. Use o padrão AAAAMMOO-AA.ORSE, como 20260501-00.ORSE.');
  }

  const detected = knownFormat(buffer);
  if (detected) {
    throw httpError(400, `O conteúdo recebido corresponde a ${detected}, e não ao pacote binário mensal do ORSE.`);
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  const entropy = shannonEntropy(sample);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    arquivo: filename,
    tamanho_bytes: buffer.length,
    referencia: metadata.referencia,
    ano: metadata.ano,
    mes: metadata.mes,
    ordem: metadata.ordem,
    anexo: metadata.anexo,
    sha256: checksum,
    perfil_binario: entropy >= 7.5 ? 'alta_entropia' : 'binario_proprietario',
    entropia_amostra: Number(entropy.toFixed(4)),
    importacao_disponivel: false,
    escopo_previsto: ['insumos', 'composicoes'],
    descartar_outros_conteudos: true,
    mensagem: 'O arquivo segue a nomenclatura oficial e possui estrutura binária proprietária/lacrada. Nenhum dado foi gravado. A importação dependerá de um decodificador compatível ou de uma exportação oficial intermediária; quando habilitada, ficará restrita a insumos e composições.',
  };
}

module.exports = {
  analyzeOrseFile,
  knownFormat,
  parseOrseFilename,
  shannonEntropy,
};
