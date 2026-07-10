const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(APP_DIR, 'docs', 'generated');
const OUTPUT_JSON = path.join(GENERATED_DIR, 'fase4-migration-rehearsal.json');
const OUTPUT_MD = path.join(GENERATED_DIR, 'fase4-migration-rehearsal.md');

const STEPS = [
  {
    key: 'audit_model',
    label: 'Auditoria do modelo SQLite',
    script: 'phase4DataModelAudit.js',
    args: [],
  },
  {
    key: 'generate_schema',
    label: 'Geracao do schema MySQL',
    script: 'phase4GenerateMysqlSchema.js',
    args: [],
  },
  {
    key: 'validate_schema',
    label: 'Validacao do schema MySQL',
    script: 'phase4ValidateMysqlSchema.js',
    args: [],
  },
  {
    key: 'mysql_readiness',
    label: 'Prontidao de conexao MySQL',
    script: 'phase4MysqlReadiness.js',
    args: [],
  },
  {
    key: 'master_dry_run',
    label: 'Plano de migracao do master',
    script: 'phase4MigrateMasterToMysql.js',
    args: [],
  },
  {
    key: 'catalog_dry_run',
    label: 'Plano de migracao do catalogo global',
    script: 'phase4MigrateCatalogToMysql.js',
    args: [],
  },
  {
    key: 'tenant_dry_run',
    label: 'Plano de migracao dos tenants',
    script: 'phase4MigrateTenantToMysql.js',
    args: ['--all'],
  },
  {
    key: 'master_parity',
    label: 'Validacao de paridade do master',
    script: 'phase4ValidateMasterMysql.js',
    args: [],
  },
  {
    key: 'catalog_parity',
    label: 'Validacao de paridade do catalogo',
    script: 'phase4ValidateCatalogMysql.js',
    args: [],
  },
  {
    key: 'tenant_parity',
    label: 'Validacao de paridade dos tenants',
    script: 'phase4ValidateTenantMysql.js',
    args: ['--all'],
  },
  {
    key: 'cutover_readiness',
    label: 'Gate consolidado de virada',
    script: 'phase4CutoverReadiness.js',
    args: [],
  },
];

function tail(text, maxChars = 5000) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function runStep(step) {
  const startedAt = Date.now();
  const scriptPath = path.join(__dirname, step.script);
  const commandArgs = [scriptPath, ...step.args];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: APP_DIR,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = tail(result.stdout);
  const stderr = tail(result.stderr);
  return {
    key: step.key,
    label: step.label,
    command: `node scripts/${step.script}${step.args.length ? ` ${step.args.join(' ')}` : ''}`,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    ok: result.status === 0,
    duration_ms: durationMs,
    stdout,
    stderr,
    error: result.error ? result.error.message : null,
  };
}

function writeReports(report) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Fase 4 - Ensaio completo da migracao MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    '',
    '## Resultado',
    '',
    `Ensaio sem falhas de comando: ${report.ok ? 'sim' : 'nao'}`,
    `Pronto para virada MySQL: ${report.cutover_ready ? 'sim' : 'nao'}`,
    '',
    '## Etapas',
    '',
    '| Etapa | Status | Duracao | Comando |',
    '|---|---:|---:|---|',
    ...report.steps.map((step) => {
      const status = step.ok ? 'OK' : 'Falha';
      return `| ${step.label} | ${status} | ${step.duration_ms} ms | \`${step.command.replace(/\|/g, '/')}\` |`;
    }),
    '',
    '## Observacoes',
    '',
    '- Este ensaio nao habilita MySQL no runtime.',
    '- As etapas de migracao sao executadas em modo plano/dry-run, sem a flag `--execute`.',
    '- A virada so deve ocorrer quando o gate consolidado indicar pronto para MySQL.',
    '',
  ];

  const failedSteps = report.steps.filter(step => !step.ok);
  if (failedSteps.length) {
    lines.push('## Falhas');
    lines.push('');
    for (const step of failedSteps) {
      lines.push(`### ${step.label}`);
      lines.push('');
      lines.push(`Comando: \`${step.command}\``);
      lines.push('');
      if (step.stderr) {
        lines.push('```text');
        lines.push(step.stderr);
        lines.push('```');
        lines.push('');
      }
      if (step.stdout) {
        lines.push('```text');
        lines.push(step.stdout);
        lines.push('```');
        lines.push('');
      }
    }
  }

  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

function readCutoverReady() {
  const cutoverPath = path.join(GENERATED_DIR, 'fase4-cutover-readiness.json');
  if (!fs.existsSync(cutoverPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(cutoverPath, 'utf8'));
    return Boolean(report.ready);
  } catch (_err) {
    return false;
  }
}

function main() {
  const steps = STEPS.map(runStep);
  const report = {
    generated_at: new Date().toISOString(),
    ok: steps.every(step => step.ok),
    cutover_ready: readCutoverReady(),
    steps,
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  };
  writeReports(report);
  console.log(JSON.stringify({
    ok: report.ok,
    cutover_ready: report.cutover_ready,
    failed_steps: steps.filter(step => !step.ok).map(step => step.key),
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
