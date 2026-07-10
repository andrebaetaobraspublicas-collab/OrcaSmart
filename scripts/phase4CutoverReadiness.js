const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(APP_DIR, 'docs', 'generated');
const OUTPUT_JSON = path.join(GENERATED_DIR, 'fase4-cutover-readiness.json');
const OUTPUT_MD = path.join(GENERATED_DIR, 'fase4-cutover-readiness.md');

const CHECKS = [
  {
    key: 'mysql_connection',
    label: 'Conexao MySQL/MariaDB',
    file: 'fase4-mysql-readiness.json',
    evaluate: report => ({
      ok: Boolean(report.connection && report.connection.ok),
      skipped: Boolean(report.connection && report.connection.skipped),
      detail: report.connection && report.connection.ok
        ? `Conexao OK em ${report.mysql.host}:${report.mysql.port}/${report.mysql.database}.`
        : (report.connection && (report.connection.reason || report.connection.error)) || 'Conexao nao validada.',
    }),
  },
  {
    key: 'master_parity',
    label: 'Paridade master',
    file: 'fase4-master-mysql-validation.json',
    evaluate: report => ({
      ok: Boolean(report.validation && report.validation.ok && !report.validation.skipped),
      skipped: Boolean(report.validation && report.validation.skipped),
      detail: report.validation && report.validation.ok
        ? 'Master SQLite e MySQL com contagens e hashes equivalentes.'
        : ((report.validation && report.validation.issues || []).join(' ') || 'Paridade master nao validada.'),
    }),
  },
  {
    key: 'catalog_parity',
    label: 'Paridade catalogo global',
    file: 'fase4-catalog-mysql-validation.json',
    evaluate: report => ({
      ok: Boolean(report.validation && report.validation.ok && !report.validation.skipped),
      skipped: Boolean(report.validation && report.validation.skipped),
      detail: report.validation && report.validation.ok
        ? 'Catalogo SQLite e MySQL com contagens e hashes equivalentes.'
        : ((report.validation && report.validation.issues || []).join(' ') || 'Paridade do catalogo nao validada.'),
    }),
  },
  {
    key: 'tenant_parity',
    label: 'Paridade tenants',
    file: 'fase4-tenant-mysql-validation.json',
    evaluate: report => ({
      ok: Boolean(report.validation && report.validation.ok && !report.validation.skipped),
      skipped: Boolean(report.validation && report.validation.skipped),
      detail: report.validation && report.validation.ok
        ? 'Tenants SQLite e MySQL com contagens e hashes equivalentes.'
        : ((report.validation && report.validation.issues || []).join(' ') || 'Paridade dos tenants nao validada.'),
    }),
  },
];

function readJson(fileName) {
  const filePath = path.join(GENERATED_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return { exists: false, filePath, report: null };
  }
  try {
    return {
      exists: true,
      filePath,
      report: JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
  } catch (err) {
    return {
      exists: true,
      filePath,
      error: err.message,
      report: null,
    };
  }
}

function runChecks() {
  return CHECKS.map(check => {
    const input = readJson(check.file);
    if (!input.exists) {
      return {
        key: check.key,
        label: check.label,
        file: input.filePath,
        ok: false,
        skipped: false,
        detail: `Relatorio ausente: ${check.file}.`,
      };
    }
    if (input.error) {
      return {
        key: check.key,
        label: check.label,
        file: input.filePath,
        ok: false,
        skipped: false,
        detail: `Relatorio invalido: ${input.error}.`,
      };
    }
    const result = check.evaluate(input.report);
    return {
      key: check.key,
      label: check.label,
      file: input.filePath,
      ok: result.ok,
      skipped: result.skipped,
      detail: result.detail,
    };
  });
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# Fase 4 - Prontidao para virada MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    '',
    '## Resultado',
    '',
    `Pronto para habilitar MySQL no runtime: ${report.ready ? 'sim' : 'nao'}`,
    '',
    '## Checagens',
    '',
    '| Checagem | Status | Detalhe |',
    '|---|---:|---|',
    ...report.checks.map(check => {
      const status = check.ok ? 'OK' : (check.skipped ? 'Pendente' : 'Falha');
      return `| ${check.label} | ${status} | ${check.detail.replace(/\|/g, '/')} |`;
    }),
    '',
    '## Proximo passo seguro',
    '',
    report.ready
      ? 'Com todos os itens OK, o proximo passo e habilitar MySQL primeiro em ambiente de teste, mantendo rollback para SQLite.'
      : 'Nao habilite MySQL em runtime enquanto alguma checagem estiver pendente ou com falha.',
    '',
  ];
  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const checks = runChecks();
  const report = {
    generated_at: new Date().toISOString(),
    ready: checks.every(check => check.ok),
    checks,
  };
  writeReports(report);
  console.log(JSON.stringify({
    ok: true,
    ready: report.ready,
    checks: checks.map(check => ({
      key: check.key,
      ok: check.ok,
      skipped: check.skipped,
    })),
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));
}

main();
