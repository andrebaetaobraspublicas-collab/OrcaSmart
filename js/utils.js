/* js/utils.js — Funções utilitárias globais */

const Utils = {
  // ── Formatação de moeda ─────────────────────────────────────
  moeda(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  // ── Formatação de número ────────────────────────────────────
  num(val, dec = 2) {
    return (parseFloat(val) || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  },

  // ── Formatação de data ──────────────────────────────────────
  data(str) {
    if (!str) return '—';
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
  },

  // ── Meses ───────────────────────────────────────────────────
  nomeMes(m) {
    return ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
            'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][m] || '';
  },

  // ── UFs brasileiras ─────────────────────────────────────────
  ufs: ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS',
        'MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC',
        'SE','SP','TO'],

  ufOptions(selected = '') {
    return `<option value="">Selecione...</option>` +
      Utils.ufs.map(uf =>
        `<option value="${uf}" ${uf === selected ? 'selected' : ''}>${uf}</option>`
      ).join('');
  },

  // ── Tipos de obra ───────────────────────────────────────────
  tiposObra: ['Edificação Residencial','Edificação Comercial','Edificação Industrial',
    'Obra de Arte Especial','Pavimentação','Saneamento','Infraestrutura',
    'Reforma / Requalificação','Outro'],

  // ── Status badge ────────────────────────────────────────────
  statusBadge(status) {
    const map = {
      'Ativa':         'badge-success',
      'Encerrada':     'badge-gray',
      'Suspensa':      'badge-warning',
      'Em elaboração': 'badge-info',
      'Aprovado':      'badge-success',
      'Revisão':       'badge-warning',
      'Cancelado':     'badge-danger',
    };
    return `<span class="badge ${map[status] || 'badge-gray'}">${status || '—'}</span>`;
  },

  // ── Tipo fonte badge ─────────────────────────────────────────
  tipoBadge(tipo) {
    const map = {
      'Oficial':  'badge-info',
      'Interna':  'badge-success',
      'Cotação':  'badge-warning',
      'Outra':    'badge-gray',
    };
    return `<span class="badge ${map[tipo] || 'badge-gray'}">${tipo || '—'}</span>`;
  },

  // ── Escape HTML ──────────────────────────────────────────────
  esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  },

  // ── Truncate ─────────────────────────────────────────────────
  trunc(str, len = 40) {
    if (!str) return '—';
    return str.length > len ? str.substring(0, len) + '…' : str;
  },

  // ── SVG icons ────────────────────────────────────────────────
  icons: {
    edit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    delete: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    copy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>`,
    plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
};
