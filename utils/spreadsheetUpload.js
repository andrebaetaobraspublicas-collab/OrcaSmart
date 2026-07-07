const zlib = require('zlib');

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnIndex(cellRef) {
  const letters = String(cellRef || '').match(/[A-Z]+/i)?.[0] || 'A';
  return letters.toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function unzipXlsx(buffer) {
  const files = {};
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo XLSX invalido: diretorio ZIP nao encontrado.');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let ptr = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const uncompSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buffer.slice(dataStart, dataStart + compSize);
    if (method === 0) files[name] = data.toString('utf8');
    else if (method === 8) files[name] = zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
    else if (uncompSize === 0) files[name] = '';
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function firstSheetPath(files) {
  if (!files['xl/workbook.xml']) return 'xl/worksheets/sheet1.xml';
  const workbook = files['xl/workbook.xml'];
  const relId = workbook.match(/<sheet[^>]+r:id="([^"]+)"/)?.[1];
  if (!relId || !files['xl/_rels/workbook.xml.rels']) return 'xl/worksheets/sheet1.xml';
  const relRe = new RegExp(`<Relationship[^>]+Id="${relId}"[^>]+Target="([^"]+)"`);
  const target = files['xl/_rels/workbook.xml.rels'].match(relRe)?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`;
}

function sharedStrings(files) {
  const xml = files['xl/sharedStrings.xml'];
  if (!xml) return [];
  const out = [];
  const siRe = /<si[\s\S]*?<\/si>/g;
  const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
  for (const si of xml.match(siRe) || []) {
    let text = '';
    let m;
    while ((m = tRe.exec(si))) text += decodeXml(m[1]);
    out.push(text);
  }
  return out;
}

function parseXlsxBuffer(buffer) {
  const files = unzipXlsx(buffer);
  const sheet = files[firstSheetPath(files)] || files['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('Nenhuma planilha foi encontrada no arquivo XLSX.');
  const sst = sharedStrings(files);
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheet))) {
    const row = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const ref = attrs.match(/\sr="([^"]+)"/)?.[1] || '';
      const type = attrs.match(/\st="([^"]+)"/)?.[1] || '';
      const idx = columnIndex(ref);
      let value = '';
      const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
      if (type === 's') value = sst[Number(v)] || '';
      else if (type === 'inlineStr') value = decodeXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '');
      else value = decodeXml(v || '');
      row[idx] = value;
    }
    if (row.some(v => String(v || '').trim())) rows.push(row);
  }
  return rows;
}

function parseMultipart(buffer, contentType) {
  const boundary = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error('Upload multipart sem boundary.');
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;
  let pos = buffer.indexOf(marker);
  while (pos >= 0) {
    const next = buffer.indexOf(marker, pos + marker.length);
    if (next < 0) break;
    let part = buffer.slice(pos + marker.length, next);
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const split = part.indexOf(Buffer.from('\r\n\r\n'));
    if (split > -1) {
      const headers = part.slice(0, split).toString('utf8');
      const body = part.slice(split + 4);
      const name = headers.match(/name="([^"]+)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      if (name && filename !== undefined) file = { fieldname: name, originalname: filename, buffer: body };
      else if (name) fields[name] = body.toString('utf8').trim();
    }
    pos = next;
  }
  return { fields, file };
}

function parseMultipartAll(buffer, contentType) {
  const boundary = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error('Upload multipart sem boundary.');
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let pos = buffer.indexOf(marker);
  while (pos >= 0) {
    const next = buffer.indexOf(marker, pos + marker.length);
    if (next < 0) break;
    let part = buffer.slice(pos + marker.length, next);
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const split = part.indexOf(Buffer.from('\r\n\r\n'));
    if (split > -1) {
      const headers = part.slice(0, split).toString('utf8');
      const body = part.slice(split + 4);
      const name = headers.match(/name="([^"]+)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      if (name && filename !== undefined) {
        const file = { fieldname: name, originalname: filename, buffer: body };
        if (!files[name]) files[name] = file;
        else if (Array.isArray(files[name])) files[name].push(file);
        else files[name] = [files[name], file];
      } else if (name) {
        fields[name] = body.toString('utf8').trim();
      }
    }
    pos = next;
  }
  return { fields, files, file: Object.values(files)[0] || null };
}

module.exports = {
  decodeXml,
  parseMultipart,
  parseMultipartAll,
  parseXlsxBuffer,
};
