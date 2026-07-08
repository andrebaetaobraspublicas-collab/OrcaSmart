const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { buildTenantTemplate } = require('../utils/tenantTemplate');
const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  PHASE2_MODEL_VERSION,
} = require('../utils/dataModelManifest');

const appDir = path.resolve(__dirname, '..');
const dataDir = process.env.ORCASMART_DATA_DIR || appDir;

const manifest = {
  modelVersion: PHASE2_MODEL_VERSION,
  catalogTables: CATALOG_TABLES,
  tenantTables: TENANT_TABLES,
  userOverrideDomains: USER_OVERRIDE_DOMAINS,
};

buildTenantTemplate({
  sqlite3,
  force: process.argv.includes('--force'),
  manifest,
  paths: {
    dataDir,
    tenantTemplatePath: path.join(appDir, 'database', 'tenant_private_template.db'),
    templatePath: path.join(appDir, 'database', 'orcamento_obras_template.db'),
    templateGzPath: path.join(appDir, 'database', 'orcamento_obras_template.db.gz'),
    legacyPath: path.join(appDir, 'database', 'orcamento_obras.db'),
  },
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
