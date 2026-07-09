/* js/admin.js - Painel administrativo do SaaS */

const AdminPage = {
  state: {
    tab: 'usuarios',
    users: [],
    tenants: [],
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
    const [overview, users, tenants] = await Promise.all([
      API.admin.overview(),
      API.admin.users(),
      API.admin.tenants(),
    ]);
    this.state.overview = overview || {};
    this.state.users = Array.isArray(users) ? users : [];
    this.state.tenants = tenants && Array.isArray(tenants.tenants) ? tenants.tenants : [];
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
        ${btn('auditoria', 'Auditoria Fase 2')}
        <button class="btn btn-ghost btn-sm" id="adminRefresh" style="margin-left:auto">${Utils.icons.refresh} Atualizar</button>
      </div>`;
  },

  renderUsers() {
    const rows = this.state.users.map(user => `
      <tr>
        <td class="fw-500">${Utils.esc(user.nome)}</td>
        <td>${Utils.esc(user.email)}</td>
        <td>${this.roleBadge(user.role)}</td>
        <td>${this.statusBadge(user.status)}</td>
        <td>${this.statusBadge(user.subscription_status || 'sem_assinatura')}</td>
        <td>${Utils.esc(user.tenant || '-')}</td>
        <td class="text-3 text-sm">${Utils.esc(user.created_at || '-')}</td>
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
              <th>Assinatura</th><th>Tenant</th><th>Criado em</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="text-center text-3">Nenhum usuario encontrado.</td></tr>`}</tbody>
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
              <th>Composicoes proprias</th><th>Criado em</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="11" class="text-center text-3">Nenhum tenant encontrado.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
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
            <div class="text-3 text-sm">Acoes destrutivas e troca de papeis ficam fora desta primeira entrega da Fase 3.</div>
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
