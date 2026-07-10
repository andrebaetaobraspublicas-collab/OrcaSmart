const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(APP_DIR, 'docs', 'generated');
const OUTPUT_JSON = path.join(GENERATED_DIR, 'fase4-mysql-execution.json');
const OUTPUT_MD = path.join(GENERATED_DIR, 'fase4-mysql-execution.md');
const REQUIRED_CONFIRM = 'MIGRAR_MYSQL_ORCASMART2';

const STEPS = [
  {
    key: 'mysql_readiness',
    label: 'Validar conexao MySQL',
    script: 'phase4MysqlReadiness.js',
    args: [],
    required: true,
  },
  {
    key: 'master_migration',
    label: 'Migrar master SaaS',
    script: 'phase4MigrateMasterToMysql.js',
    args: ['--execute', '--confirm=orcasmart2-master'],
    resettable: true,
    required: true,
  },
  {
    key: 'master_validation',
    label: 'Validar master SaaS',
    script: 'phase4ValidateMasterMysql.js',
    args: [],
    required: true,
  },
  {
    key: 'catalog_migration',
    label: 'Migrar catalogo global',
    script: 'phase4MigrateCatalogToMysql.js',
    args: ['--execute', '--confirm=orcasmart2-catalog'],
    resettable: true,
    required: true,
  },
  {
    key: 'catalog_validation',
    label: 'Validar catalogo global',
    script: 'phase4ValidateCatalogMysql.js',
    args: [],
    required: true,
  },
  {
    key: 'tenant_migration',
    label: 'Migrar tenants',
    script: 'phase4MigrateTenantToMysql.js',
    args: ['--all', '--execute', '--reset', '--confirm=orcasmart2-tenant'],
    required: true,
  },
  {
    key: 'tenant_validation',
    label: 'Validar tenants',
    script: 'phase4ValidateTenantMysql.js',
    args: ['--all'],
    required: true,
  },
  {
    key: 'cutover_readiness',
    label: 'Validar prontidao consolidada',
    script: 'phase4CutoverReadiness.js',
    args: [],
    required: false,
  },
];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function mysqlEnvMissing() {
  return ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']
    .filter(name => !(process.env[name] || process.env[`ORCASMART_${name}`]));
}

function tail(text, maxChars = 6000) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function runStep(step, options) {
  const startedAt = Date.now();
  const scriptPath = path.join(__dirname, step.script);
  const args = [...step.args];
  if (step.resettable && options.reset && !args.includes('--reset')) args.splice(1, 0, '--reset');
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: APP_DIR,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(process.env.ORCASMART_PHASE4_EXECUTE_STEP_TIMEOUT_MS || 600000),
    maxBuffer: 1024 * 1024 * 10,
  });
  return {
    key: step.key,
    label: step.label,
    command: `node scripts/${step.script}${args.length ? ` ${args.join(' ')}` : ''}`,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    ok: result.status === 0,
    duration_ms: Date.now() - startedAt,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    error: result.error ? result.error.message : null,
  };
}

function readCutoverReady() {
  const filePath = path.join(GENERATED_DIR, 'fase4-cutover-readiness.json');
  if (!fs.existsSync(filePath)) return false;
  try {
    return Boolean(JSON.parse(fs.readFileSync(filePath, 'utf8')).ready);
  } catch (_err) {
    return false;
  }
}

function writeReports(report) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Fase 4 - Execucao da migracao MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    '',
    '## Resultado',
    '',
    `Confirmacao aceita: ${report.confirmed ? 'sim' : 'nao'}`,
    `Reset MySQL solicitado: ${report.reset ? 'sim' : 'nao'}`,
    `Execucao concluida sem falhas: ${report.ok ? 'sim' : 'nao'}`,
    `Gate de virada pronto: ${report.cutover_ready ? 'sim' : 'nao'}`,
    '',
    '## Etapas',
    '',
    '| Etapa | Status | Duracao | Comando |',
    '|---|---:|---:|---|',
    ...report.steps.map((step) => {
      const status = step.ok ? 'OK' : (step.skipped ? 'Ignorada' : 'Falha');
      return `| ${step.label} | ${status} | ${step.duration_ms || 0} ms | \`${String(step.command || '').replace(/\|/g, '/')}\` |`;
    }),
    '',
  ];

  if (report.blocked_reasons.length) {
    lines.push('## Bloqueios');
    lines.push('');
    report.blocked_reasons.forEach(reason => lines.push(`- ${reason}`));
    lines.push('');
  }

  const failedSteps = report.steps.filter(step => !step.ok && !step.skipped);
  if (failedSteps.length) {
    lines.push('## Falhas');
    lines.push('');
    for (const step of failedSteps) {
      lines.push(`### ${step.label}`);
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

function main() {
  const confirm = argValue('confirm');
  const reset = hasFlag('reset');
  const missing = mysqlEnvMissing();
  const blockedReasons = [];
  if (confirm !== REQUIRED_CONFIRM) {
    blockedReasons.push(`Confirmacao obrigatoria ausente. Use --confirm=${REQUIRED_CONFIRM}.`);
  }
  if (missing.length) {
    blockedReasons.push(`Variaveis MySQL ausentes: ${missing.join(', ')}.`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    confirmed: confirm === REQUIRED_CONFIRM,
    reset,
    ok: false,
    cutover_ready: false,
    blocked_reasons: blockedReasons,
    steps: [],
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  };

  if (!blockedReasons.length) {
    for (const step of STEPS) {
      const result = runStep(step, { reset });
      report.steps.push(result);
      if (!result.ok && step.required) break;
    }
    report.ok = report.steps.length > 0 && report.steps.every(step => step.ok);
    report.cutover_ready = readCutoverReady();
  } else {
    report.steps = STEPS.map(step => ({
      key: step.key,
      label: step.label,
      command: `node scripts/${step.script}`,
      ok: false,
      skipped: true,
      duration_ms: 0,
    }));
  }

  writeReports(report);
  console.log(JSON.stringify({
    ok: report.ok,
    cutover_ready: report.cutover_ready,
    blocked_reasons: report.blocked_reasons,
    failed_steps: report.steps.filter(step => !step.ok && !step.skipped).map(step => step.key),
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
