const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const MYSQL_DIR = path.join(APP_DIR, 'database', 'mysql');
const INVENTORY_PATH = path.join(APP_DIR, 'docs', 'generated', 'fase4-data-model-inventory.json');
const REPORT_PATH = path.join(APP_DIR, 'docs', 'generated', 'fase4-mysql-schema-validation.md');

function readFiles() {
  if (!fs.existsSync(MYSQL_DIR)) throw new Error(`Diretorio MySQL nao encontrado: ${MYSQL_DIR}`);
  return fs.readdirSync(MYSQL_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => ({
      name,
      path: path.join(MYSQL_DIR, name),
      content: fs.readFileSync(path.join(MYSQL_DIR, name), 'utf8'),
    }));
}

function readInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) return null;
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
}

function parseTables(file) {
  const tables = [];
  const regex = /CREATE TABLE IF NOT EXISTS `([^`]+)` \(([\s\S]*?)\n\) ENGINE=/g;
  let match;
  while ((match = regex.exec(file.content))) {
    const [, name, body] = match;
    const columns = new Map();
    const indexes = [];
    const primaryKey = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      const column = line.match(/^`([^`]+)`\s+([A-Z0-9(),\s]+)(?:\s|$)/i);
      if (column) {
        columns.set(column[1], {
          name: column[1],
          type: column[2].trim().toUpperCase(),
          line,
        });
      }
      const index = line.match(/^(?:UNIQUE\s+)?KEY\s+`([^`]+)`\s+\((.+)\)$/i);
      if (index) {
        const indexColumns = Array.from(index[2].matchAll(/`([^`]+)`/g)).map(col => col[1]);
        indexes.push({
          name: index[1],
          columns: indexColumns,
          line,
        });
      }
      const pk = line.match(/^PRIMARY KEY\s+\((.+)\)$/i);
      if (pk) {
        primaryKey.push(...Array.from(pk[1].matchAll(/`([^`]+)`/g)).map(col => col[1]));
      }
    }
    tables.push({ file: file.name, name, columns, indexes, primaryKey, body });
  }
  return tables;
}

function hasTenantId(tableName, inventory) {
  if (!inventory) return false;
  const table = inventory.tables.find(item => item.name === tableName);
  return table && ['tenant_privado', 'override_tenant'].includes(table.domain);
}

function validate(files, inventory) {
  const issues = [];
  const tables = files.flatMap(parseTables);

  for (const file of files) {
    const badPatterns = [
      { pattern: /datetime\('now'\)|date\('now'\)/i, message: 'default SQLite remanescente' },
      { pattern: /TEXT\s+(?:NOT\s+)?NULL\s+DEFAULT/i, message: 'TEXT com DEFAULT nao e aceito em MySQL/MariaDB' },
      { pattern: /OrÃ|Ã§|Ã£|Ã©|Ã¡|Ã­|Ã³|Ãº/i, message: 'possivel problema de encoding no arquivo SQL' },
    ];
    for (const rule of badPatterns) {
      if (rule.pattern.test(file.content)) {
        issues.push({ severity: 'erro', file: file.name, table: '-', message: rule.message });
      }
    }
  }

  for (const table of tables) {
    if (hasTenantId(table.name, inventory) && !table.columns.has('tenant_id')) {
      issues.push({ severity: 'erro', file: table.file, table: table.name, message: 'tabela privada/override sem tenant_id' });
    }
    if (hasTenantId(table.name, inventory)) {
      const inventoryTable = inventory.tables.find(item => item.name === table.name);
      if (inventoryTable && inventoryTable.domain === 'tenant_privado' && !table.primaryKey.includes('tenant_id')) {
        issues.push({ severity: 'erro', file: table.file, table: table.name, message: 'tabela privada sem tenant_id na chave primaria' });
      }
      if (table.name === 'tenant_referential_overrides' && !table.primaryKey.includes('tenant_id')) {
        issues.push({ severity: 'erro', file: table.file, table: table.name, message: 'tenant_referential_overrides sem tenant_id na chave primaria' });
      }
    }
    for (const index of table.indexes) {
      for (const columnName of index.columns) {
        const column = table.columns.get(columnName);
        if (!column) {
          issues.push({
            severity: 'erro',
            file: table.file,
            table: table.name,
            message: `indice ${index.name} referencia coluna inexistente ${columnName}`,
          });
          continue;
        }
        if (/^(TEXT|LONGBLOB|JSON)\b/i.test(column.type)) {
          issues.push({
            severity: 'erro',
            file: table.file,
            table: table.name,
            message: `indice ${index.name} usa coluna ${columnName} do tipo ${column.type}`,
          });
        }
      }
    }
  }

  return { tables, issues };
}

function writeReport(result) {
  const lines = [
    '# Fase 4 - Validacao do schema MySQL/MariaDB',
    '',
    `Gerado em: ${new Date().toISOString()}`,
    '',
    `Tabelas analisadas: ${result.tables.length}`,
    `Problemas encontrados: ${result.issues.length}`,
    '',
  ];

  if (result.issues.length) {
    lines.push('| Severidade | Arquivo | Tabela | Problema |');
    lines.push('|---|---|---|---|');
    for (const issue of result.issues) {
      lines.push(`| ${issue.severity} | ${issue.file} | ${issue.table} | ${issue.message} |`);
    }
  } else {
    lines.push('Nenhum problema bloqueante encontrado nas validacoes automaticas atuais.');
  }
  lines.push('');
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const files = readFiles();
  const inventory = readInventory();
  const result = validate(files, inventory);
  writeReport(result);
  console.log(JSON.stringify({
    ok: result.issues.length === 0,
    tables: result.tables.length,
    issues: result.issues,
    report: REPORT_PATH,
  }, null, 2));
  if (result.issues.length) process.exitCode = 1;
}

main();
