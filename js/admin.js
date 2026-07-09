/* js/admin.js - Painel administrativo do SaaS */

const AdminPage = {
  state: {
    tab: 'usuarios',
    users: [],
    tenants: [],
    logs: [],
    health: null,
    backups: null,
    me: null,
    overview: {},
    audit: null,
  },

  fmtInt(value) {
    return Number(value || 0).toLocaleString('pt-BR');
  },

  fmtBytes(value) {
    const n = Number(value || 0);
    if (!n) return '-';
    if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
    return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  },

  badge(text, tone = 'gray') {
    const cls = {
      green: 'badge-success',
      blue: 'badge-info',
      yellow: 'badge-warning',
      red: 'badge-danger',
      gray: 'badge-gray',
    }[tone] || 'badge-gray';
    return `<span class="badge ${cls}">${Utils.esc(text || '-')}</span>`;
  },

  roleBadge(role) {
    if (role === 'admin') return this.badge('Admin', 'red');
    if (role === 'owner') return this.badge('Owner', 'blue');
    return this.badge(role || '-', 'gray');
  },

  statusBadge(status) {
    const value = status || '-';
    if (String(value).toLowerCase() === 'ativo') return this.badge(value, 'green');
    if (String(value).toLowerCase().includes('trial')) return this.badge(value, 'yellow');
    if (String(value).toLowerCase().includes('active')) return this.badge(value, 'green');
    return this.badge(value, 'gray');
  },

  subscriptionText(items = []) {
    if (!items.length) return 'Sem assinaturas registradas';
    return items.map(item => `${Utils.esc(item.status)}: ${this.fmtInt(item.total)}`).join(' | ');
  },

  async loadAll() {
    const [me, overview, users, tenants, logs, health, backups] = await Promise.all([
      API.auth.me(),
      API.admin.overview(),
      API.admin.users(),
      API.admin.tenants(),
      API.admin.auditLog({ limit: 80 }),
      API.admin.health(),
      API.admin.backups(),
    ]);
    this.state.me = me || null;
    this.state.overview = overview || {};
    this.state.users = Array.isArray(users) ? users : [];
    this.state.tenants = tenants && Array.isArray(tenants.tenants) ? tenants.tenants : [];
    this.state.logs = Array.isArray(logs) ? logs : [];
    this.state.health = health || null;
    this.state.backups = backups || null;
  },

  card(value, label, tone = 'blue') {
    return `
      <div class="card">
        <div class="card-stat">
          <div>
            <div class="card-stat-value">${this.fmtInt(value)}</div>
            <div class="card-stat-label">${Utils.esc(label)}</div>
          </div>
          <div class="card-stat-icon ${tone}">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 20V4h16v16H4zM8 9h8M8 13h5M8 17h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>`;
  },

  renderTabs() {
    const active = this.state.tab;
    const btn = (id, label) => `
      <button class="btn ${active === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-admin-tab="${id}">
        ${label}
      </button>`;
    return `
      <div class="toolbar" style="padding:12px 20px">
        ${btn('usuarios', 'Usuarios')}
        ${btn('tenants', 'Tenants')}
        ${btn('saude', 'Saude')}
        ${btn('backups', 'Backups')}
        ${btn('logs', 'Auditoria admin')}
        ${btn('auditoria', 'Auditoria Fase 2')}
        <button class="btn btn-ghost btn-sm" id="adminRefresh" style="margin-left:auto">${Utils.icons.refresh} Atualizar</button>
      </div>`;
  },

  roleOptions(role) {
    return ['owner', 'admin'].map(value =>
      `<option value="${value}" ${value === role ? 'selected' : ''}>${value === 'admin' ? 'Admin' : 'Owner'}</option>`
    ).join('');
  },

  statusOptions(status) {
    return ['ativo', 'suspenso', 'inativo'].map(value =>
      `<option value="${value}" ${value === status ? 'selected' : ''}>${value}</option>`
    ).join('');
  },

  renderUsers() {
    const rows = this.state.users.map(user => `
      <tr>
        <td class="fw-500">${Utils.esc(user.nome)}${this.state.me && this.state.me.id_user === user.id_user ? ' <span class="badge badge-info">voce</span>' : ''}</td>
        <td>${Utils.esc(user.email)}</td>
        <td><select class="filter-select" data-admin-user-role="${user.id_user}" ${this.state.me && this.state.me.id_user === user.id_user ? 'disabled' : ''}>${this.roleOptions(user.role)}</select></td>
        <td><select class="filter-select" data-admin-user-status="${user.id_user}" ${this.state.me && this.state.me.id_user === user.id_user ? 'disabled' : ''}>${this.statusOptions(user.status || 'ativo')}</select></td>
        <td>${this.statusBadge(user.subscription_status || 'sem_assinatura')}</td>
        <td>${Utils.esc(user.tenant || '-')}</td>
        <td class="text-3 text-sm">${Utils.esc(user.created_at || '-')}</td>
        <td>
          <button class="btn btn-primary btn-sm" data-admin-user-save="${user.id_user}" ${this.state.me && this.state.me.id_user === user.id_user ? 'disabled' : ''}>Salvar</button>
        </td>
      </tr>`).join('');
    return `
      <div class="section-card">
        <div class="section-card-header">
          <h2>Usuarios cadastrados</h2>
          <span class="text-3 text-sm">${this.fmtInt(this.state.users.length)} registro(s)</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th>
              <th>Assinatura</th><th>Tenant</th><th>Criado em</th><th>Acoes</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="8" class="text-center text-3">Nenhum usuario encontrado.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  },

  renderTenants() {
    const rows = this.state.tenants.map(tenant => {
      const stats = tenant.stats || {};
      const dbStatus = stats.db_exists ? this.badge('OK', 'green') : this.badge('Sem arquivo', 'red');
      return `
        <tr>
          <td class="fw-500">#${tenant.id_tenant}</td>
          <td>${Utils.esc(tenant.nome)}</td>
          <td>${this.statusBadge(tenant.status)}</td>
          <td>${this.fmtInt(tenant.users_count)}</td>
          <td>${dbStatus}</td>
          <td>${this.fmtBytes(stats.db_size_bytes)}</td>
          <td>${this.fmtInt(stats.obras)}</td>
          <td>${this.fmtInt(stats.orcamentos)}</td>
          <td>${this.fmtInt(stats.insumos_usuario)}</td>
          <td>${this.fmtInt(stats.composicoes_usuario)}</td>
          <td class="text-3 text-sm">${Utils.esc(tenant.created_at || '-')}</td>
          <td>
            <select class="filter-select" data-admin-tenant-status="${tenant.id_tenant}">${this.statusOptions(tenant.status || 'ativo')}</select>
            <button class="btn btn-primary btn-sm" data-admin-tenant-save="${tenant.id_tenant}" style="margin-left:6px">Salvar</button>
            <button class="btn btn-ghost btn-sm" data-admin-tenant-diagnostics="${tenant.id_tenant}" style="margin-left:6px">Diagnostico</button>
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="section-card">
        <div class="section-card-header">
          <h2>Tenants e bancos privados</h2>
          <span class="text-3 text-sm">${this.fmtInt(this.state.tenants.length)} tenant(s)</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th>ID</th><th>Tenant</th><th>Status</th><th>Usuarios</th><th>Banco</th>
              <th>Tamanho</th><th>Obras</th><th>Orc.</th><th>Insumos proprios</th>
              <th>Composicoes proprias</th><th>Criado em</th><th>Acoes</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="12" class="text-center text-3">Nenhum tenant encontrado.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  },

  logSummary(log) {
    const before = log.antes || {};
    const after = log.depois || {};
    if (log.entidade_tipo === 'user') {
      const bits = [];
      if (before.role !== after.role) bits.push(`papel: ${before.role || '-'} -> ${after.role || '-'}`);
      if (before.status !== after.status) bits.push(`status: ${before.status || '-'} -> ${after.status || '-'}`);
      return bits.join(' | ') || 'Sem mudanca detectada';
    }
    if (log.entidade_tipo === 'tenant') {
      return before.status !== after.status
        ? `status: ${before.status || '-'} -> ${after.status || '-'}`
        : 'Sem mudanca detectada';
    }
    return log.acao || '-';
  },

  renderLogs() {
    const rows = this.state.logs.map(log => `
      <tr>
        <td class="text-3 text-sm">${Utils.esc(log.created_at || '-')}</td>
        <td>${Utils.esc(log.admin_email || '-')}</td>
        <td>${this.badge(log.entidade_tipo, log.entidade_tipo === 'user' ? 'blue' : 'green')}</td>
        <td>#${Utils.esc(log.entidade_id)}</td>
        <td>${Utils.esc(log.acao)}</td>
        <td>${Utils.esc(this.logSummary(log))}</td>
      </tr>`).join('');
    return `
      <div class="section-card">
        <div class="section-card-header">
          <h2>Trilha de auditoria administrativa</h2>
          <span class="text-3 text-sm">${this.fmtInt(this.state.logs.length)} evento(s)</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Data</th><th>Admin</th><th>Tipo</th><th>ID</th><th>Acao</th><th>Resumo</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="6" class="text-center text-3">Nenhum evento administrativo registrado.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  },

  fileStatusCard(title, info, tone = 'blue') {
    const file = info || {};
    return `
      <div class="card">
        <div class="card-stat">
          <div>
            <div class="card-stat-value" style="font-size:1.35rem">${file.exists ? 'OK' : 'Ausente'}</div>
            <div class="card-stat-label">${Utils.esc(title)}</div>
            <div class="text-3 text-sm" style="margin-top:8px">${this.fmtBytes(file.size_bytes)}</div>
          </div>
          <div class="card-stat-icon ${file.exists ? tone : 'red'}">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3zM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>`;
  },

  renderHealth() {
    const health = this.state.health || {};
    const catalog = health.shared_catalog || {};
    const tables = Array.isArray(catalog.tables) ? catalog.tables : [];
    const missing = health.tenant_files ? health.tenant_files.missing : 0;
    const rows = tables.map(item => `
      <tr>
        <td class="fw-500">${Utils.esc(item.table)}</td>
        <td>${item.error ? this.badge('Erro', 'red') : this.badge('OK', 'green')}</td>
        <td>${item.rows === null || item.rows === undefined ? '-' : this.fmtInt(item.rows)}</td>
        <td class="text-3 text-sm">${Utils.esc(item.error || '')}</td>
      </tr>`).join('');

    return `
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
        ${this.fileStatusCard('Master SaaS', health.master_db, 'blue')}
        ${this.fileStatusCard('Catalogo compartilhado', catalog, 'green')}
        ${this.fileStatusCard('Template dos tenants', health.tenant_template, 'yellow')}
        ${this.card(missing, 'Bancos de tenants ausentes', missing ? 'red' : 'green')}
      </div>

      <div class="section-card" style="margin-bottom:16px">
        <div class="section-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <div class="text-3 text-sm">Build</div>
            <div class="fw-500">${Utils.esc(health.build || '-')}</div>
          </div>
          <div>
            <div class="text-3 text-sm">Diretorio persistente</div>
            <div class="fw-500" style="word-break:break-all">${Utils.esc(health.data_dir || '-')}</div>
          </div>
          <div>
            <div class="text-3 text-sm">Versao</div>
            <div class="fw-500">${Utils.esc(health.version || '-')}</div>
          </div>
          <div>
            <div class="text-3 text-sm">Tenants monitorados</div>
            <div class="fw-500">${this.fmtInt(health.tenant_files && health.tenant_files.total)}</div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">
          <h2>Catalogo comum - contagem por tabela</h2>
          <span class="text-3 text-sm">${this.fmtInt(tables.length)} tabela(s)</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Tabela</th><th>Status</th><th>Registros</th><th>Detalhe</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="text-center text-3">Nenhuma tabela de catalogo informada.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  },

  renderBackups() {
    const data = this.state.backups || {};
    const rows = (data.backups || []).map(item => `
      <tr>
        <td class="fw-500">${Utils.esc(item.id)}</td>
        <td>${Utils.esc(item.created_at || '-')}</td>
        <td>${Utils.esc(item.build || '-')}</td>
        <td>${this.fmtInt(item.tenants)}</td>
        <td>${this.fmtInt(item.files)}</td>
        <td class="text-3 text-sm" style="word-break:break-all">${Utils.esc(item.path || '-')}</td>
      </tr>`).join('');

    return `
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <h2>Snapshots administrativos</h2>
            <p class="text-3 text-sm">Copia fisica do master, catalogo compartilhado, template e bancos dos tenants.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="adminCreateBackup">${Utils.icons.plus} Gerar snapshot</button>
        </div>
        <div class="section-card-body">
          <div class="text-3 text-sm" style="margin-bottom:12px">Diretorio: ${Utils.esc(data.root || '-')}</div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Snapshot</th><th>Criado em</th><th>Build</th><th>Tenants</th><th>Arquivos</th><th>Caminho</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="6" class="text-center text-3">Nenhum snapshot administrativo criado.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  },

  tableRows(items = []) {
    return items.map(item => `
      <tr>
        <td class="fw-500">${Utils.esc(item.table)}</td>
        <td>${item.error ? this.badge('Erro', 'red') : item.rows === null || item.rows === undefined ? this.badge('Ausente', 'yellow') : this.badge('OK', 'green')}</td>
        <td>${item.rows === null || item.rows === undefined ? '-' : this.fmtInt(item.rows)}</td>
        <td class="text-3 text-sm">${Utils.esc(item.error || '')}</td>
      </tr>`).join('');
  },

  async openTenantDiagnostics(idTenant) {
    try {
      const data = await API.admin.tenantDiagnostics(idTenant);
      const tenant = data.tenant || {};
      const users = data.users || [];
      const privateTables = data.tables && data.tables.private ? data.tables.private : [];
      const overrideTables = data.tables && data.tables.overrides ? data.tables.overrides : [];
      const logs = data.audit_log || [];
      const userRows = users.map(user => `
        <tr>
          <td>${Utils.esc(user.nome)}</td>
          <td>${Utils.esc(user.email)}</td>
          <td>${this.roleBadge(user.role)}</td>
          <td>${this.statusBadge(user.status)}</td>
          <td>${this.statusBadge(user.subscription_status || 'sem_assinatura')}</td>
        </tr>`).join('');
      const logRows = logs.map(log => `
        <tr>
          <td class="text-3 text-sm">${Utils.esc(log.created_at || '-')}</td>
          <td>${Utils.esc(log.admin_email || '-')}</td>
          <td>${Utils.esc(log.acao || '-')}</td>
          <td>${Utils.esc(this.logSummary(log))}</td>
        </tr>`).join('');

      Modal.open({
        title: `Diagnostico do tenant #${tenant.id_tenant || idTenant}`,
        body: `
          <div class="section-card-body">
            <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
              ${this.card(tenant.users_count, 'Usuarios', 'blue')}
              ${this.card(tenant.stats && tenant.stats.obras, 'Obras', 'green')}
              ${this.card(tenant.stats && tenant.stats.orcamentos, 'Orcamentos', 'yellow')}
              ${this.fileStatusCard('Banco privado', tenant.db, 'blue')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
              <div>
                <div class="text-3 text-sm">Tenant</div>
                <div class="fw-500">${Utils.esc(tenant.nome || '-')}</div>
              </div>
              <div>
                <div class="text-3 text-sm">Status</div>
                <div>${this.statusBadge(tenant.status)}</div>
              </div>
              <div style="grid-column:1 / -1">
                <div class="text-3 text-sm">Banco</div>
                <div class="fw-500" style="word-break:break-all">${Utils.esc(tenant.db && tenant.db.path || '-')}</div>
              </div>
            </div>

            <h3 style="margin:12px 0">Usuarios do tenant</h3>
            <div class="table-wrapper" style="margin-bottom:16px">
              <table>
                <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Assinatura</th></tr></thead>
                <tbody>${userRows || `<tr><td colspan="5" class="text-center text-3">Nenhum usuario.</td></tr>`}</tbody>
              </table>
            </div>

            <h3 style="margin:12px 0">Tabelas privadas</h3>
            <div class="table-wrapper" style="margin-bottom:16px">
              <table>
                <thead><tr><th>Tabela</th><th>Status</th><th>Registros</th><th>Detalhe</th></tr></thead>
                <tbody>${this.tableRows(privateTables) || `<tr><td colspan="4" class="text-center text-3">Sem tabelas privadas informadas.</td></tr>`}</tbody>
              </table>
            </div>

            <h3 style="margin:12px 0">Tabelas de personalizacao do usuario</h3>
            <div class="table-wrapper" style="margin-bottom:16px">
              <table>
                <thead><tr><th>Tabela</th><th>Status</th><th>Registros</th><th>Detalhe</th></tr></thead>
                <tbody>${this.tableRows(overrideTables) || `<tr><td colspan="4" class="text-center text-3">Sem tabelas de override informadas.</td></tr>`}</tbody>
              </table>
            </div>

            <h3 style="margin:12px 0">Auditoria recente deste tenant</h3>
            <div class="table-wrapper">
              <table>
                <thead><tr><th>Data</th><th>Admin</th><th>Acao</th><th>Resumo</th></tr></thead>
                <tbody>${logRows || `<tr><td colspan="4" class="text-center text-3">Sem eventos administrativos recentes.</td></tr>`}</tbody>
              </table>
            </div>
          </div>`,
        footer: `<button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>`,
        size: 'xl',
      });
    } catch (err) {
      Toast.error(err.message || 'Falha ao carregar diagnostico.');
    }
  },

  renderAudit() {
    const audit = this.state.audit;
    const body = !audit ? `
      <div class="empty-state">
        <p>Clique em "Executar auditoria" para verificar a aderencia dos tenants ao modelo de dados da Fase 2.</p>
        <button class="btn btn-primary" id="adminRunAudit">Executar auditoria</button>
      </div>` : `
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin:0 0 16px">
        ${this.card(audit.total, 'Tenants auditados', 'blue')}
        ${this.card(audit.ok, 'Sem pendencia', 'green')}
        ${this.card(audit.pendentes, 'Pendentes', 'yellow')}
        ${this.card(audit.com_erro, 'Com erro', 'red')}
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Tenant</th><th>Status</th><th>Migracao</th><th>Detalhe</th></tr></thead>
          <tbody>
            ${(audit.tenants || []).map(item => `
              <tr>
                <td>#${item.id_tenant} - ${Utils.esc(item.nome || '')}</td>
                <td>${item.error ? this.badge('Erro', 'red') : item.needs_migration ? this.badge('Pendente', 'yellow') : this.badge('OK', 'green')}</td>
                <td>${item.needs_migration ? 'Necessaria' : 'Nao necessaria'}</td>
                <td class="text-3 text-sm">${Utils.esc(item.error || item.reason || '-')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    return `
      <div class="section-card">
        <div class="section-card-header">
          <h2>Auditoria do modelo de dados</h2>
          <button class="btn btn-ghost btn-sm" id="adminRunAudit">${Utils.icons.refresh} Executar auditoria</button>
        </div>
        <div class="section-card-body">${body}</div>
      </div>`;
  },

  renderContent() {
    if (this.state.tab === 'tenants') return this.renderTenants();
    if (this.state.tab === 'saude') return this.renderHealth();
    if (this.state.tab === 'backups') return this.renderBackups();
    if (this.state.tab === 'logs') return this.renderLogs();
    if (this.state.tab === 'auditoria') return this.renderAudit();
    return this.renderUsers();
  },

  async render() {
    document.getElementById('pageContent').innerHTML = `
      <div class="loading-screen"><div class="spinner"></div></div>`;
    try {
      await this.loadAll();
      const ov = this.state.overview || {};
      document.getElementById('pageContent').innerHTML = `
        <div class="page-header">
          <div class="page-header-left">
            <h1>Administracao SaaS</h1>
            <p>Visao administrativa de usuarios, tenants e saude da separacao entre catalogo comum e dados privados.</p>
          </div>
        </div>

        <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
          ${this.card(ov.users_total, 'Usuarios', 'blue')}
          ${this.card(ov.users_admin, 'Administradores', 'red')}
          ${this.card(ov.tenants_total, 'Tenants', 'green')}
          ${this.card(ov.tenants_active, 'Tenants ativos', 'yellow')}
        </div>

        <div class="section-card" style="margin-bottom:16px">
          <div class="section-card-body" style="display:flex;justify-content:space-between;gap:16px;align-items:center">
            <div>
              <div class="text-3 text-sm">Assinaturas</div>
              <div class="fw-500">${this.subscriptionText(ov.subscriptions || [])}</div>
            </div>
            <div class="text-3 text-sm">Mudancas administrativas sao registradas em trilha de auditoria.</div>
          </div>
        </div>

        <div class="section-card">
          ${this.renderTabs()}
          <div id="adminPanelBody" style="padding:16px">${this.renderContent()}</div>
        </div>`;
      this.bind();
    } catch (err) {
      const denied = String(err.message || '').includes('403') || String(err.message || '').includes('Acesso');
      document.getElementById('pageContent').innerHTML = `
        <div class="section-card" style="max-width:720px;margin:40px auto;padding:28px">
          <h2>${denied ? 'Acesso administrativo restrito' : 'Falha ao carregar administracao'}</h2>
          <p class="text-2" style="margin-top:8px">${Utils.esc(err.message || 'Erro inesperado.')}</p>
        </div>`;
    }
  },

  bind() {
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.tab = btn.dataset.adminTab;
        document.getElementById('adminPanelBody').innerHTML = this.renderContent();
        this.bind();
      });
    });
    const refresh = document.getElementById('adminRefresh');
    if (refresh) refresh.addEventListener('click', () => this.render());
    document.querySelectorAll('[data-admin-user-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.adminUserSave;
        const role = document.querySelector(`[data-admin-user-role="${id}"]`).value;
        const status = document.querySelector(`[data-admin-user-status="${id}"]`).value;
        const user = this.state.users.find(item => String(item.id_user) === String(id));
        const ok = await Confirm.ask(
          `Alterar o usuario ${user ? user.email : '#' + id} para papel "${role}" e status "${status}"?`,
          { title: 'Confirmar alteracao de usuario', okText: 'Salvar', okClass: 'btn btn-primary' }
        );
        if (!ok) return;
        btn.disabled = true;
        try {
          await API.admin.updateUser(id, { role, status });
          Toast.success('Usuario atualizado.');
          await this.render();
        } catch (err) {
          Toast.error(err.message || 'Falha ao atualizar usuario.');
          btn.disabled = false;
        }
      });
    });
    document.querySelectorAll('[data-admin-tenant-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.adminTenantSave;
        const status = document.querySelector(`[data-admin-tenant-status="${id}"]`).value;
        const tenant = this.state.tenants.find(item => String(item.id_tenant) === String(id));
        const ok = await Confirm.ask(
          `Alterar o tenant ${tenant ? tenant.nome : '#' + id} para status "${status}"?`,
          { title: 'Confirmar alteracao de tenant', okText: 'Salvar', okClass: 'btn btn-primary' }
        );
        if (!ok) return;
        btn.disabled = true;
        try {
          await API.admin.updateTenant(id, { status });
          Toast.success('Tenant atualizado.');
          await this.render();
        } catch (err) {
          Toast.error(err.message || 'Falha ao atualizar tenant.');
          btn.disabled = false;
        }
      });
    });
    document.querySelectorAll('[data-admin-tenant-diagnostics]').forEach(btn => {
      btn.addEventListener('click', () => this.openTenantDiagnostics(btn.dataset.adminTenantDiagnostics));
    });
    const backupBtn = document.getElementById('adminCreateBackup');
    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        const ok = await Confirm.ask(
          'Gerar um snapshot administrativo agora? A operacao copia os bancos para o diretorio persistente de backups.',
          { title: 'Gerar snapshot', okText: 'Gerar', okClass: 'btn btn-primary' }
        );
        if (!ok) return;
        backupBtn.disabled = true;
        backupBtn.textContent = 'Gerando...';
        try {
          await API.admin.createBackup();
          Toast.success('Snapshot administrativo criado.');
          await this.render();
          this.state.tab = 'backups';
          document.getElementById('adminPanelBody').innerHTML = this.renderBackups();
          this.bind();
        } catch (err) {
          Toast.error(err.message || 'Falha ao gerar snapshot.');
          backupBtn.disabled = false;
        }
      });
    }
    document.querySelectorAll('#adminRunAudit').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Auditando...';
        try {
          this.state.audit = await API.admin.auditTenants();
          document.getElementById('adminPanelBody').innerHTML = this.renderAudit();
          this.bind();
        } catch (err) {
          Toast.error(err.message || 'Falha na auditoria.');
          btn.disabled = false;
        }
      });
    });
  },
};

Router.register('admin', () => AdminPage.render());
