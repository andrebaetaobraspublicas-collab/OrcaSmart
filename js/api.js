/* js/api.js — Wrapper para chamadas à API REST */

const API = {
  BASE: '/api',

  async _req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.BASE + path, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      const resumo = text ? text.replace(/\s+/g, ' ').slice(0, 240) : 'sem corpo de resposta';
      throw new Error(`Resposta inválida do servidor (${res.status}). ${resumo}`);
    }
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error(data.erro || 'Autenticação necessária.');
    }
    if (res.status === 402) {
      window.location.href = '/login.html?subscription=required';
      throw new Error(data.erro || 'Assinatura inativa.');
    }
    if (!res.ok) throw new Error(data.erro || data.error || data.message || `Erro HTTP ${res.status}`);
    return data;
  },

  get:    (path)       => API._req('GET',    path),
  post:   (path, body) => API._req('POST',   path, body),
  put:    (path, body) => API._req('PUT',    path, body),
  delete: (path)       => API._req('DELETE', path),
  del:    (path)       => API._req('DELETE', path),

  // Dashboard
  dashboard: () => API.get('/dashboard'),
  status:    () => API.get('/status'),
  auth: {
    me: () => API.get('/auth/me'),
    logout: () => API.post('/auth/logout', {}),
    changePassword: (data) => API.post('/auth/change-password', data),
  },
  admin: {
    overview: () => API.get('/admin/overview'),
    health: () => API.get('/admin/health'),
    users: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/admin/users${q ? '?' + q : ''}`);
    },
    updateUser: (id, data) => API._req('PATCH', `/admin/users/${id}`, data),
    createUser: (data) => API.post('/admin/users', data),
    updateUserPassword: (id, data) => API._req('PATCH', `/admin/users/${id}/password`, data),
    startUserPasswordReset: (id) => API.post(`/admin/users/${id}/password-reset`, {}),
    subscriptions: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/admin/subscriptions${q ? '?' + q : ''}`);
    },
    updateSubscription: (id, data) => API._req('PATCH', `/admin/users/${id}/subscription`, data),
    tenants: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/admin/tenants${q ? '?' + q : ''}`);
    },
    tenantDiagnostics: (id) => API.get(`/admin/tenants/${id}/diagnostics`),
    updateTenant: (id, data) => API._req('PATCH', `/admin/tenants/${id}`, data),
    backups: () => API.get('/admin/backups'),
    createBackup: () => API.post('/admin/backups', {}),
    backupManifest: (id) => API.get(`/admin/backups/${id}/manifest`),
    backupDownload: (id) => `${API.BASE}/admin/backups/${encodeURIComponent(id)}/download`,
    auditLog: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/admin/audit-log${q ? '?' + q : ''}`);
    },
    auditTenants: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/admin/phase2/tenants/audit${q ? '?' + q : ''}`);
    },
    runPhase4MysqlReadiness: () => API.post('/admin/phase4/mysql-readiness', {}),
    runPhase4MysqlMigration: (data = {}) => API.post('/admin/phase4/mysql-migration', data),
    runPhase4CutoverReadiness: () => API.post('/admin/phase4/cutover-readiness', {}),
    runPhase4Rehearsal: () => API.post('/admin/phase4/rehearsal', {}),
    phase4ReportDownload: (name) => `${API.BASE}/admin/phase4/reports/${encodeURIComponent(name)}/download`,
  },

  // Estados e Municípios
  estados: {
    list: () => API.get('/estados'),
  },
  municipios: {
    listByUF:  (uf, busca, ano)  => API.get(`/municipios?uf=${encodeURIComponent(uf||'')}&busca=${encodeURIComponent(busca||'')}&ano=${encodeURIComponent(ano||'')}`),
    get:       (id)         => API.get(`/municipios/${id}`),
    update:    (id, data)   => API.put(`/municipios/${id}`, data),
    estados:   ()           => API.get('/municipios/estados'),
    importarAliquotas: (formData) => {
      return fetch(`${API.BASE}/municipios/importar-aliquotas`, {
        method: 'POST', body: formData
      }).then(r => r.json());
    },
  },

  eventogramas: {
    list:        (id_orcamento) => API.get(`/eventogramas${id_orcamento ? '?id_orcamento='+id_orcamento : ''}`),
    get:         (id)           => API.get(`/eventogramas/${id}`),
    create:      (data)         => API.post('/eventogramas', data),
    update:      (id, data)     => API.put(`/eventogramas/${id}`, data),
    delete:      (id)           => API.delete(`/eventogramas/${id}`),
    gerar:       (id, data)     => API.post(`/eventogramas/${id}/gerar`, data),
    validar:     (id)           => API.get(`/eventogramas/${id}/validar`),
    iaConfig:    ()             => API.get('/eventogramas/ia/config'),
    planejarIA: async (id, formData) => {
      const response = await fetch(`${API.BASE}/eventogramas/${id}/ia/planejar-job`, { method: 'POST', body: formData });
      formData.delete('anthropic_api_key');
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) window.location.href = '/login.html';
      if (!response.ok) throw new Error(data.erro || data.message || `Erro HTTP ${response.status}`);
      const jobId = data.job_id;
      if (!jobId) throw new Error('O servidor não retornou o identificador da análise.');
      const started = Date.now();
      while (Date.now() - started < 8 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const job = await API.get(`/eventogramas/${id}/ia/jobs/${encodeURIComponent(jobId)}`);
        window.dispatchEvent(new CustomEvent('eventograma-ai-progress', { detail: job }));
        if (job.status === 'concluido') return job.resultado;
        if (job.status === 'erro') throw new Error(job.erro || 'A análise inteligente falhou.');
      }
      throw new Error('A análise inteligente excedeu oito minutos. Tente novamente com menos documentos.');
    },
    aplicarPlanoIA: (id, data) => API.post(`/eventogramas/${id}/ia/aplicar`, data),
    refinarIA:      (id, data) => API.post(`/eventogramas/${id}/ia/refinar`, data),
    feedbackIA:     (id, data) => API.post(`/eventogramas/${id}/ia/feedback`, data),
    reordenar:   (id, ordens)   => API.post(`/eventogramas/${id}/reordenar`, ordens),
    exportarJson:  (id) => `${API.BASE}/eventogramas/${id}/exportar/json`,
    exportarExcel: (id) => `${API.BASE}/eventogramas/${id}/exportar/excel`,
    exportarPdf:   (id) => `${API.BASE}/eventogramas/${id}/exportar/pdf`,
    eventos: {
      list:   (evgId)           => API.get(`/eventogramas/${evgId}/eventos`),
      create: (evgId, data)     => API.post(`/eventogramas/${evgId}/eventos`, data),
      update: (evgId, id, data) => API.put(`/eventogramas/${evgId}/eventos/${id}`, data),
      delete: (evgId, id)       => API.delete(`/eventogramas/${evgId}/eventos/${id}`),
      addItens:    (evgId, id, ids)  => API.post(`/eventogramas/${evgId}/eventos/${id}/itens`, {ids}),
      removeItem:  (evgId, id, iid) => API.delete(`/eventogramas/${evgId}/eventos/${id}/itens/${iid}`),
      moverItens:  (evgId, id, destino, ids) => API.post(`/eventogramas/${evgId}/eventos/${id}/itens/mover`, {id_evento_destino: destino, ids}),
    },
  },

  // Obras
  obras: {
    list:      (q, situacao) => API.get(`/obras?q=${encodeURIComponent(q||'')}&situacao=${situacao||''}`),
    get:       (id)          => API.get(`/obras/${id}`),
    create:    (data)        => API.post('/obras', data),
    update:    (id, data)    => API.put(`/obras/${id}`, data),
    delete:    (id)          => API.delete(`/obras/${id}`),
    duplicate: (id)          => API.post(`/obras/${id}/duplicar`),
    orcamentos:(id)          => API.get(`/obras/${id}/orcamentos`),
  },

  // Orçamentos
  orcamentos: {
    list:      (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/orcamentos?${q}`);
    },
    get:       (id)          => API.get(`/orcamentos/${id}`),
    create:    (data)        => API.post('/orcamentos', data),
    update:    (id, data)    => API.put(`/orcamentos/${id}`, data),
    delete:    (id)          => API.delete(`/orcamentos/${id}`),
    duplicate: (id)          => API.post(`/orcamentos/${id}/duplicar`),
  },

  riscosContingencia: {
    analises: () => API.get('/riscos-contingencia/analises'),
    get: id => API.get(`/riscos-contingencia/analises/${id}`),
    create: data => API.post('/riscos-contingencia/analises', data),
    update: (id, data) => API.put(`/riscos-contingencia/analises/${id}`, data),
    delete: id => API.delete(`/riscos-contingencia/analises/${id}`),
    updateServico: (id, data) => API.put(`/riscos-contingencia/servicos/${id}`, data),
    createEvento: (id, data) => API.post(`/riscos-contingencia/analises/${id}/eventos`, data),
    updateEvento: (id, data) => API.put(`/riscos-contingencia/eventos/${id}`, data),
    deleteEvento: id => API.delete(`/riscos-contingencia/eventos/${id}`),
    valorEsperado: id => API.get(`/riscos-contingencia/analises/${id}/valor-esperado`),
    tornado: id => API.get(`/riscos-contingencia/analises/${id}/tornado`),
    saveSimulation: (id, data) => API.post(`/riscos-contingencia/analises/${id}/simulacoes`, data),
    aplicarBdi: (id, data) => API.post(`/riscos-contingencia/analises/${id}/aplicar-bdi`, data),
    exportUrl: (id, formato) => `${API.BASE}/riscos-contingencia/analises/${id}/exportar/${formato}`,
  },

  // Unidades
  unidades: {
    list:   ()          => API.get('/unidades'),
    get:    (id)        => API.get(`/unidades/${id}`),
    create: (data)      => API.post('/unidades', data),
    update: (id, data)  => API.put(`/unidades/${id}`, data),
    delete: (id)        => API.delete(`/unidades/${id}`),
  },

  // Fontes
  fontes: {
    list:   ()          => API.get('/fontes'),
    get:    (id)        => API.get(`/fontes/${id}`),
    create: (data)      => API.post('/fontes', data),
    update: (id, data)  => API.put(`/fontes/${id}`, data),
    delete: (id)        => API.delete(`/fontes/${id}`),
  },

  // Datas-base
  datasBase: {
    list:   ()          => API.get('/datas-base'),
    get:    (id)        => API.get(`/datas-base/${id}`),
    create: (data)      => API.post('/datas-base', data),
    update: (id, data)  => API.put(`/datas-base/${id}`, data),
    delete: (id)        => API.delete(`/datas-base/${id}`),
  },

  pavimentos: {
    gerarOrcamento: (data) => API.post('/pavimentos/gerar-orcamento', data),
  },

  estrutural: {
    gerarOrcamento: (data) => API.post('/estrutural/gerar-orcamento', data),
  },

  adminCanteiro: {
    criarComposicoes: (data) => API.post('/admin-canteiro/criar-composicoes', data),
  },
};
