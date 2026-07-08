const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  USER_OVERRIDE_TABLES,
  PHASE2_MODEL_VERSION,
} = require('../utils/dataModelManifest');
const { ensureSharedCatalog } = require('../utils/sharedCatalog');

async function main() {
  const appDir = path.resolve(__dirname, '..');
  const dataDir = process.env.ORCASMART_DATA_DIR || appDir;
  const force = process.argv.includes('--force');

  const result = await ensureSharedCatalog({
    sqlite3,
    force,
    paths: {
      dataDir,
      sharedCatalogPath: path.join(dataDir, 'shared_catalog.db'),
      templatePath: path.join(appDir, 'database', 'orcamento_obras_template.db'),
      templateGzPath: path.join(appDir, 'database', 'orcamento_obras_template.db.gz'),
      legacyPath: path.join(appDir, 'database', 'orcamento_obras.db'),
    },
    manifest: {
      modelVersion: PHASE2_MODEL_VERSION,
      catalogTables: CATALOG_TABLES,
      tenantTables: TENANT_TABLES,
      userOverrideDomains: USER_OVERRIDE_DOMAINS,
      userOverrideTables: USER_OVERRIDE_TABLES,
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
