/* js/router.js — Roteamento SPA, Modal e Toast */

// ─── Router ───────────────────────────────────────────────────────────────────
const Router = {
  routes: {},

  register(page, handler) { this.routes[page] = handler; },

  navigate(page) {
    const handler = this.routes[page];
    if (!handler) { this.navigate('home'); return; }

    // Atualizar nav ativo
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Breadcrumb
    const labels = {
      'reforma-tributaria':     'Reforma Tributária — IVAeq, BDI e Reequilíbrio',
      'home':                  'OrçaSmart',
      'dashboard':            'Dashboard',
      'obras':                'Obras',
      'orcamentos':           'Orçamentos',
      'orcamento-sintetico':  'Orçamento Sintético',
      'producao-horaria':     'Produções Horárias — SICRO',
      'insumos':              'Insumos',
      'encargos':             'Encargos Sociais',
      'composicoes':          'Composições de Custo',
      'bdi':                  'BDI — Bonificação e Despesas Indiretas',
      'equipamentos':         'Custo Horário dos Equipamentos',
      'unidades':             'Unidades de Medida',
      'fontes':               'Fontes Referenciais',
      'datas-base':           'Datas-Base',
      'curva-abc-servicos':    'Curva ABC — Serviços',
      'curva-abc-insumos':     'Curva ABC — Insumos',
      'municipios':            'Municípios — Alíquotas ISS / IBS / CBS',
      'eventograma':           'Eventograma — Tabela de Eventos Geradores de Pagamento',
      'dimensionamento-pavimentos': 'Dimensionamento de Pavimentos',
    };
    document.getElementById('breadcrumb').textContent = labels[page] || page;

    // Render page
    const content = document.getElementById('pageContent');
    content.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
    handler();
  },

  init() {
    // Hash navigation
    window.addEventListener('hashchange', () => {
      const page = location.hash.replace('#','') || 'dashboard';
      this.navigate(page);
    });

    // Nav items
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const page = el.dataset.page;
        location.hash = page;
      });
    });

    // Initial route — 'home' is the splash screen; 'dashboard' is the KPI page
    const page = location.hash.replace('#','') || 'home';
    this.navigate(page);
  },
};

// ─── Modal ────────────────────────────────────────────────────────────────────
const Modal = {
  overlay: null, modal: null,
  _resolve: null,

  init() {
    this.overlay = document.getElementById('modalOverlay');
    this.modal   = document.getElementById('modal');
    document.getElementById('modalClose').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.close(); });
  },

  open({ title, body, footer, size = '' }) {
    document.getElementById('modalTitle').textContent  = title || '';
    document.getElementById('modalBody').innerHTML     = body  || '';
    document.getElementById('modalFooter').innerHTML   = footer || '';
    this.modal.className = `modal ${size}`;
    this.overlay.classList.add('open');
    // Auto-focus primeiro input
    setTimeout(() => {
      const first = this.modal.querySelector('input:not([type=hidden]):not([disabled]),select,textarea');
      if (first) first.focus();
    }, 50);
  },

  close() {
    this.overlay.classList.remove('open');
  },
};

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
const Confirm = {
  _resolve: null,

  init() {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmClose').addEventListener('click',  () => this._close(false));
    document.getElementById('confirmCancel').addEventListener('click', () => this._close(false));
    document.getElementById('confirmOk').addEventListener('click',     () => this._close(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) this._close(false); });
  },

  ask(msg, title = 'Confirmar exclusão', options = {}) {
    if (typeof title === 'object') {
      options = title;
      title = options.title || 'Confirmar exclusão';
    }
    const ok = document.getElementById('confirmOk');
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = msg;
    ok.textContent = options.okText || 'Excluir';
    ok.className = options.okClass || 'btn btn-danger';
    document.getElementById('confirmOverlay').classList.add('open');
    return new Promise(res => { this._resolve = res; });
  },

  _close(val) {
    document.getElementById('confirmOverlay').classList.remove('open');
    if (this._resolve) { this._resolve(val); this._resolve = null; }
  },
};

// ─── Toast ────────────────────────────────────────────────────────────────────
const Toast = {
  container: null,
  icons: {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10b981" stroke-width="2"/><path d="M9 12l2 2 4-4" stroke="#10b981" stroke-width="2" stroke-linecap="round"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#ef4444" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/></svg>`,
  },

  init() { this.container = document.getElementById('toastContainer'); },

  show(msg, type = 'success', duration = 3500) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `${this.icons[type] || ''}<span>${Utils.esc(msg)}</span>`;
    this.container.appendChild(t);
    setTimeout(() => {
      t.classList.add('removing');
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  success: (msg) => Toast.show(msg, 'success'),
  error:   (msg) => Toast.show(msg, 'error', 5000),
  warning: (msg) => Toast.show(msg, 'warning'),
  info:    (msg) => Toast.show(msg, 'info'),
};
