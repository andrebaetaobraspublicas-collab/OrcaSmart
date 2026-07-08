/**
 * OrçaSmart SaaS - servidor Node/Express para Hostinger.
 *
 * Mantém compatibilidade com as rotas Node existentes e acrescenta:
 * - login/cadastro/sessão;
 * - banco SQLite isolado por usuário/tenant;
 * - integração Stripe Checkout/Portal/webhook;
 * - proteção das APIs e redirecionamento para login.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const { AsyncLocalStorage } = require('async_hooks');

const cors = require('cors');
const { apiNotFound, apiErrorHandler } = require('./middleware/apiErrors');
const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  PHASE2_MODEL_VERSION,
} = require('./utils/dataModelManifest');
const { ensureSharedCatalog } = require('./utils/sharedCatalog');
let sqlite3 = null;
let Stripe = null;
try {
  Stripe = require('stripe');
} catch (_err) {
  Stripe = null;
}

const APP_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DOMAIN = (process.env.PUBLIC_DOMAIN || 'https://calculoobra.com.br').replace(/\/+$/, '');
const APP_NAME = process.env.ORCASMART_APP_NAME || 'OrcaSmart2';
const APP_VERSION = process.env.ORCASMART_APP_VERSION || '2.0.0-alpha.1';
const DB_TEMPLATE_PATH = path.join(APP_DIR, 'database', 'orcamento_obras_template.db');
const DB_TEMPLATE_GZ_PATH = path.join(APP_DIR, 'database', 'orcamento_obras_template.db.gz');
const LEGACY_DB_PATH = path.join(APP_DIR, 'database', 'orcamento_obras.db');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';

const stripe = Stripe && STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const requestDb = new AsyncLocalStorage();
const bootState = {
  databaseReady: false,
  databaseError: null,
  sharedCatalogReady: false,
  sharedCatalogBuilding: false,
  sharedCatalogError: null,
  sharedCatalogStats: null,
};

function ensureDataDir() {
  const requestedDir = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || __dirname;
  try {
    fs.mkdirSync(requestedDir, { recursive: true });
    fs.mkdirSync(path.join(requestedDir, 'tenant_dbs'), { recursive: true });
    return requestedDir;
  } catch (err) {
    const fallbackDir = path.join(os.tmpdir(), 'orcasmart2-data');
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.mkdirSync(path.join(fallbackDir, 'tenant_dbs'), { recursive: true });
    console.error(`Falha ao preparar DATA_DIR ${requestedDir}. Usando fallback ${fallbackDir}:`, err);
    return fallbackDir;
  }
}

const DATA_DIR = ensureDataDir();
const MASTER_DB_PATH = path.join(DATA_DIR, 'saas_master.db');
const TENANT_DB_DIR = path.join(DATA_DIR, 'tenant_dbs');
const SHARED_CATALOG_DB_PATH = path.join(DATA_DIR, 'shared_catalog.db');
const phase2Manifest = {
  modelVersion: PHASE2_MODEL_VERSION,
  catalogTables: CATALOG_TABLES,
  tenantTables: TENANT_TABLES,
  userOverrideDomains: USER_OVERRIDE_DOMAINS,
};

function getSqlite3() {
  if (!sqlite3) sqlite3 = require('sqlite3').verbose();
  return sqlite3;
}

function dbFileTemplate() {
  if (fs.existsSync(DB_TEMPLATE_PATH)) return DB_TEMPLATE_PATH;
  if (fs.existsSync(LEGACY_DB_PATH)) return LEGACY_DB_PATH;
  if (fs.existsSync(DB_TEMPLATE_GZ_PATH)) {
    const extractedTemplate = path.join(DATA_DIR, 'orcamento_obras_template.db');
    if (!fs.existsSync(extractedTemplate)) {
      const tempFile = `${extractedTemplate}.tmp`;
      fs.writeFileSync(tempFile, zlib.gunzipSync(fs.readFileSync(DB_TEMPLATE_GZ_PATH)));
      fs.renameSync(tempFile, extractedTemplate);
    }
    return extractedTemplate;
  }
  return DB_TEMPLATE_PATH;
}

function openSqlite(filePath) {
  const sqlite = getSqlite3();
  const db = new sqlite.Database(filePath);
  db.configure('busyTimeout', 10000);
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 10000');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  return db;
}

function runMaster(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openSqlite(MASTER_DB_PATH);
    db.run(sql, params, function onRun(err) {
      db.close();
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getMaster(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openSqlite(MASTER_DB_PATH);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allMaster(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openSqlite(MASTER_DB_PATH);
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initMasterDb() {
  await runMaster(`
    CREATE TABLE IF NOT EXISTS tenants (
      id_tenant INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      db_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await runMaster(`
    CREATE TABLE IF NOT EXISTS users (
      id_user INTEGER PRIMARY KEY AUTOINCREMENT,
      id_tenant INTEGER NOT NULL,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'ativo',
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
    )`);
  await runMaster(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id_subscription INTEGER PRIMARY KEY AUTOINCREMENT,
      id_user INTEGER NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      stripe_customer_id TEXT,
      status TEXT NOT NULL DEFAULT 'trial',
      current_period_end INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_user) REFERENCES users(id_user)
    )`);
}

function tenantDbPath(idTenant) {
  const name = `tenant_${String(idTenant).padStart(6, '0')}.db`;
  return path.join(TENANT_DB_DIR, name);
}

function createTenantDatabase(idTenant) {
  const target = tenantDbPath(idTenant);
  if (!fs.existsSync(target)) {
    const template = dbFileTemplate();
    if (!fs.existsSync(template)) {
      throw new Error(`Banco-template não encontrado em ${template}`);
    }
    fs.copyFileSync(template, target);
  }
  return target;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 150000, 32, 'sha256').toString('hex');
  return `pbkdf2$150000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}

function encodeSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64url');
  return `${payload}.${signValue(payload)}`;
}

function decodeSession(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || signValue(payload) !== signature) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_err) {
    return {};
  }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
}

function loadCookieSession(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.session = decodeSession(cookies['orcasmart.sid']);
  next();
}

function setSession(res, userId) {
  res.cookie('orcasmart.sid', encodeSession(userId), sessionCookieOptions());
}

function clearSession(res) {
  res.clearCookie('orcasmart.sid', sessionCookieOptions());
}

function slugFromEmail(email) {
  return normalizeEmail(email).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `tenant-${Date.now()}`;
}

async function loadUserById(idUser) {
  if (!idUser) return null;
  return getMaster(`
    SELECT u.*, t.nome AS tenant_nome, t.slug AS tenant_slug, t.db_path AS tenant_db_path,
           s.status AS subscription_status, s.current_period_end
    FROM users u
    JOIN tenants t ON t.id_tenant = u.id_tenant
    LEFT JOIN subscriptions s ON s.id_user = u.id_user
    WHERE u.id_user = ? AND u.status = 'ativo'`, [idUser]);
}

function subscriptionAllowsAccess(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const status = user.subscription_status || 'trial';
  if (['active', 'trialing', 'trial', 'past_due'].includes(status)) return true;
  return false;
}

const tenantDbProxy = {
  get(sql, params, cb) { return runTenantMethod('get', sql, params, cb); },
  all(sql, params, cb) { return runTenantMethod('all', sql, params, cb); },
  run(sql, params, cb) { return runTenantMethod('run', sql, params, cb); },
  async withConnection(task) {
    const store = requestDb.getStore();
    const dbPath = store && store.dbPath;
    if (!dbPath || !path.resolve(dbPath).startsWith(path.resolve(TENANT_DB_DIR))) {
      throw new Error('Tenant nao definido para esta requisicao.');
    }
    const tenantDb = openSqlite(dbPath);
    try {
      return await task(tenantDb);
    } finally {
      await new Promise(resolve => tenantDb.close(resolve));
    }
  },
};

function runTenantMethod(method, sql, params, cb) {
  if (typeof params === 'function') {
    cb = params;
    params = [];
  }
  const store = requestDb.getStore();
  const dbPath = store && store.dbPath;
  if (!dbPath || !path.resolve(dbPath).startsWith(path.resolve(TENANT_DB_DIR))) {
    const err = new Error('Tenant não definido para esta requisição.');
    if (cb) process.nextTick(() => cb(err));
    return undefined;
  }
  const db = openSqlite(dbPath);
  return db[method](sql, params || [], function onDbResult(err, result) {
    const context = this;
    db.close(() => {
      if (cb) requestDb.run({ dbPath }, () => cb.call(context, err, result));
    });
  });
}

async function requireLogin(req, res, next) {
  if (req.path === '/status') return next();
  if (req.path.startsWith('/auth/') || req.path.startsWith('/billing/') || req.path === '/stripe/webhook') return next();
  const user = await loadUserById(req.session.userId).catch(() => null);
  if (!user) return res.status(401).json({ erro: 'Autenticação necessária.' });
  if (!subscriptionAllowsAccess(user)) return res.status(402).json({ erro: 'Assinatura inativa.' });
  req.user = user;
  return requestDb.run({ dbPath: user.tenant_db_path }, next);
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ erro: 'Acesso não autorizado.' });
  }
  return next();
}

const app = express();
app.set('trust proxy', 1);

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(501).json({ erro: 'Stripe não configurado.' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook inválido: ${err.message}`);
  }
  await handleStripeEvent(event);
  return res.json({ received: true });
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(loadCookieSession);

app.use(express.static(APP_DIR, {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.db')) res.status(404);
  },
}));

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  return res.sendFile(path.join(APP_DIR, 'index.html'));
});

app.get('/login.html', (_req, res) => res.sendFile(path.join(APP_DIR, 'login.html')));

app.get('/api/status', (_req, res) => res.json({
  status: 'ok',
  app: APP_NAME,
  version: APP_VERSION,
  build: 'sinapi-importacao-node',
  runtime: 'node',
  domain: PUBLIC_DOMAIN,
  dataDir: DATA_DIR,
  databaseReady: bootState.databaseReady,
  databaseError: bootState.databaseError,
  phase2: {
    modelVersion: PHASE2_MODEL_VERSION,
    sharedCatalogPath: SHARED_CATALOG_DB_PATH,
    sharedCatalogReady: bootState.sharedCatalogReady,
    sharedCatalogBuilding: bootState.sharedCatalogBuilding,
    sharedCatalogError: bootState.sharedCatalogError,
    sharedCatalogStats: bootState.sharedCatalogStats,
    catalogTables: CATALOG_TABLES.length,
    tenantTables: TENANT_TABLES.length,
    userOverrideDomains: USER_OVERRIDE_DOMAINS,
  },
}));

app.post('/api/auth/register', async (req, res) => {
  try {
    const nome = String(req.body.nome || req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const senha = String(req.body.senha || req.body.password || '');
    if (!nome || !email || senha.length < 8) {
      return res.status(400).json({ erro: 'Informe nome, e-mail e senha com pelo menos 8 caracteres.' });
    }
    const exists = await getMaster('SELECT id_user FROM users WHERE email = ?', [email]);
    if (exists) return res.status(409).json({ erro: 'E-mail já cadastrado.' });

    const tenant = await runMaster('INSERT INTO tenants (nome, slug, db_path) VALUES (?, ?, ?)', [nome, `${slugFromEmail(email)}-${Date.now()}`, 'pending']);
    const dbPath = createTenantDatabase(tenant.lastID);
    await runMaster('UPDATE tenants SET db_path = ? WHERE id_tenant = ?', [dbPath, tenant.lastID]);
    const passwordHash = hashPassword(senha);
    const user = await runMaster(
      'INSERT INTO users (id_tenant, nome, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [tenant.lastID, nome, email, passwordHash, 'owner']
    );
    await runMaster('INSERT INTO subscriptions (id_user, status) VALUES (?, ?)', [user.lastID, 'trial']);
    setSession(res, user.lastID);
    return res.status(201).json({ ok: true, user: { id_user: user.lastID, nome, email } });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const senha = String(req.body.senha || req.body.password || '');
    const user = await getMaster('SELECT * FROM users WHERE email = ? AND status = ?', [email, 'ativo']);
    if (!user || !verifyPassword(senha, user.password_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }
    setSession(res, user.id_user);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await loadUserById(req.session.userId).catch(() => null);
  if (!user) return res.status(401).json({ erro: 'Não autenticado.' });
  return res.json({
    id_user: user.id_user,
    nome: user.nome,
    email: user.email,
    role: user.role,
    tenant: user.tenant_nome,
    subscription_status: user.subscription_status || 'trial',
  });
});

app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) return res.status(501).json({ erro: 'Stripe não configurado.' });
    const user = await loadUserById(req.session.userId);
    if (!user) return res.status(401).json({ erro: 'Autenticação necessária.' });
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.nome, metadata: { id_user: String(user.id_user) } });
      customerId = customer.id;
      await runMaster('UPDATE users SET stripe_customer_id = ? WHERE id_user = ?', [customerId, user.id_user]);
    }
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${PUBLIC_DOMAIN}/login.html?checkout=success`,
      cancel_url: `${PUBLIC_DOMAIN}/login.html?checkout=cancel`,
      metadata: { id_user: String(user.id_user) },
      subscription_data: { metadata: { id_user: String(user.id_user) } },
    });
    return res.json({ url: checkout.url });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ erro: 'Stripe não configurado.' });
    const user = await loadUserById(req.session.userId);
    if (!user || !user.stripe_customer_id) return res.status(400).json({ erro: 'Cliente Stripe não encontrado.' });
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${PUBLIC_DOMAIN}/`,
    });
    return res.json({ url: portal.url });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.use('/api', requireLogin);

app.use('/api/obras', require('./routes/obrasRoutes')(tenantDbProxy));
app.use('/api/orcamentos', require('./routes/orcamentosRoutes')(tenantDbProxy));
app.use('/api/unidades', require('./routes/unidadesRoutes')(tenantDbProxy));
app.use('/api/fontes', require('./routes/fontesRoutes')(tenantDbProxy));
app.use('/api/datas-base', require('./routes/datasBaseRoutes')(tenantDbProxy));
app.use('/api/equipamentos', require('./routes/equipamentosRoutes')(tenantDbProxy));
app.use('/api/insumos', require('./routes/insumosRoutes')(tenantDbProxy));
app.use('/api', require('./routes/municipiosRoutes')(tenantDbProxy));
app.use('/api/encargos', require('./routes/encargosRoutes')(tenantDbProxy));
app.use('/api/composicoes', require('./routes/composicoesRoutes')(tenantDbProxy));
app.use('/api/eventogramas', require('./routes/eventogramasRoutes')(tenantDbProxy));
app.use('/api/pem', require('./routes/pemRoutes')(tenantDbProxy));
app.use('/api/dashboard', require('./routes/dashboardRoutes')(tenantDbProxy));
app.use('/api/sinapi', require('./routes/sinapiRoutes')(tenantDbProxy));
app.use('/api/compras-gov', require('./routes/comprasGovRoutes')(tenantDbProxy));
app.use('/api/pesquisa-mercado', require('./routes/pesquisaMercadoRoutes')(tenantDbProxy));
app.use('/api', require('./routes/analiseProjetosRoutes')(tenantDbProxy));
app.use('/api/bdi', require('./routes/bdiRoutes')(tenantDbProxy));
app.use('/api', require('./routes/compatRoutes')(tenantDbProxy));
app.use('/api/admin', requireAdmin, require('./routes/adminRoutes')({ all: allMaster }));

app.use('/api', apiNotFound);

app.use(apiErrorHandler);

app.get('*', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  return res.sendFile(path.join(APP_DIR, 'index.html'));
});

async function handleStripeEvent(event) {
  const object = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const idUser = Number(object.metadata && object.metadata.id_user);
    if (idUser) {
      await runMaster('UPDATE users SET stripe_customer_id = ? WHERE id_user = ?', [object.customer, idUser]);
      await runMaster(`
        UPDATE subscriptions
        SET stripe_subscription_id = ?, stripe_customer_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id_user = ?`, [object.subscription, object.customer, 'active', idUser]);
    }
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = object;
    await runMaster(`
      UPDATE subscriptions
      SET status = ?, current_period_end = ?, updated_at = CURRENT_TIMESTAMP
      WHERE stripe_subscription_id = ? OR stripe_customer_id = ?`,
      [subscription.status, subscription.current_period_end || null, subscription.id, subscription.customer]);
  }
}

function startServer() {
  app.listen(PORT, HOST, () => {
    console.log(`OrçaSmart SaaS Node iniciado em http://${HOST}:${PORT}`);
  });
}

async function initializeSharedCatalog() {
  if (bootState.sharedCatalogBuilding || bootState.sharedCatalogReady) return;
  bootState.sharedCatalogBuilding = true;
  bootState.sharedCatalogError = null;
  try {
    const sqlite = getSqlite3();
    bootState.sharedCatalogStats = await ensureSharedCatalog({
      sqlite3: sqlite,
      paths: {
        dataDir: DATA_DIR,
        sharedCatalogPath: SHARED_CATALOG_DB_PATH,
        templatePath: DB_TEMPLATE_PATH,
        templateGzPath: DB_TEMPLATE_GZ_PATH,
        legacyPath: LEGACY_DB_PATH,
      },
      manifest: phase2Manifest,
    });
    bootState.sharedCatalogReady = true;
  } catch (err) {
    bootState.sharedCatalogError = err && err.message ? err.message : String(err);
    console.error('Falha ao inicializar catalogo compartilhado:', err);
  } finally {
    bootState.sharedCatalogBuilding = false;
  }
}

initMasterDb()
  .then(() => {
    bootState.databaseReady = true;
    startServer();
    initializeSharedCatalog();
  })
  .catch((err) => {
    bootState.databaseError = err && err.message ? err.message : String(err);
    console.error('Falha ao inicializar banco SaaS:', err);
    startServer();
    initializeSharedCatalog();
  });
