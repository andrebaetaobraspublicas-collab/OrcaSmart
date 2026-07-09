const fs = require('fs');
const path = require('path');
const Module = require('module');

function injectAfter(source, marker, snippet) {
  if (source.includes(snippet.trim())) return source;
  const index = source.indexOf(marker);
  if (index < 0) return source;
  return source.slice(0, index + marker.length) + snippet + source.slice(index + marker.length);
}

function replaceOnce(source, from, to) {
  if (!source.includes(from) || source.includes(to.trim())) return source;
  return source.replace(from, to);
}

function patchServer(source) {
  let patched = source;

  patched = injectAfter(
    patched,
    "const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';",
    `
const ADMIN_EMAILS = new Set(
  String(process.env.ORCASMART_ADMIN_EMAILS || 'andrebaeta@hotmail.com,admin@hotmail.com')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean),
);
`
  );

  patched = injectAfter(
    patched,
    `      FOREIGN KEY (id_user) REFERENCES users(id_user)
    )\`);`,
    `
  if (ADMIN_EMAILS.size) {
    const placeholders = [...ADMIN_EMAILS].map(() => '?').join(',');
    await runMaster(\`UPDATE users SET role = 'admin' WHERE lower(email) IN (\${placeholders})\`, [...ADMIN_EMAILS]);
  }
`
  );

  patched = injectAfter(
    patched,
    `function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
`,
    `
function isConfiguredAdminEmail(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}
`
  );

  patched = replaceOnce(
    patched,
    `    const passwordHash = hashPassword(senha);
    const user = await runMaster(
      'INSERT INTO users (id_tenant, nome, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [tenant.lastID, nome, email, passwordHash, 'owner']
    );`,
    `    const passwordHash = hashPassword(senha);
    const role = isConfiguredAdminEmail(email) ? 'admin' : 'owner';
    const user = await runMaster(
      'INSERT INTO users (id_tenant, nome, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [tenant.lastID, nome, email, passwordHash, role]
    );`
  );

  patched = patched
    .replace("app.use('/api/dashboard', require('./routes/dashboardRoutes')(tenantDbProxy));", "app.use('/api/dashboard', require('./routes/dashboardRoutes')(tenantDbProxy, { readDb: sharedCatalogReadProxy }));")
    .replace("app.use('/api/compras-gov', require('./routes/comprasGovRoutes')(tenantDbProxy));", "app.use('/api/compras-gov', require('./routes/comprasGovRoutes')(tenantDbProxy, { readDb: sharedCatalogReadProxy }));")
    .replace("app.use('/api/pesquisa-mercado', require('./routes/pesquisaMercadoRoutes')(tenantDbProxy));", "app.use('/api/pesquisa-mercado', require('./routes/pesquisaMercadoRoutes')(tenantDbProxy, { readDb: sharedCatalogReadProxy }));")
    .replace("app.use('/api', require('./routes/compatRoutes')(tenantDbProxy));", "app.use('/api', require('./routes/compatRoutes')(tenantDbProxy, { readDb: sharedCatalogReadProxy }));");

  return patched;
}

const serverPath = path.join(__dirname, 'server.js');
const runtimeFilename = path.join(__dirname, '.runtime-server.js');
const serverSource = patchServer(fs.readFileSync(serverPath, 'utf8'));
const runtimeModule = new Module(runtimeFilename, module);
runtimeModule.filename = runtimeFilename;
runtimeModule.paths = Module._nodeModulePaths(__dirname);
runtimeModule._compile(serverSource, runtimeFilename);
