/* js/dashboard.js */

Router.register('dashboard', async () => {
  let data = {};
  try { data = await API.dashboard(); } catch(e) { /* ignore */ }

  const {
    totalObras = 0, totalOrcamentos = 0,
    totalInsumos = 0, totalComposicoes = 0,
    totalCompSINAPI = 0, totalCompSICRO = 0, totalCompUsuario = 0,
    totalEventogramas = 0,
    ultimosOrcamentos = []
  } = data;

  const kpi = (valor, label, iconSvg, corClass) => `
    <div class="card">
      <div class="card-stat">
        <div>
          <div class="card-stat-value">${Number(valor).toLocaleString('pt-BR')}</div>
          <div class="card-stat-label">${label}</div>
        </div>
        <div class="card-stat-icon ${corClass}">${iconSvg}</div>
      </div>
    </div>`;

  const ICON_OBRA    = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 21h18M3 7l9-4 9 4M5 7v14M19 7v14M9 21V12h6v9" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const ICON_ORC     = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const ICON_INSUMO  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" stroke="currentColor" stroke-width="1.8"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>`;
  const ICON_COMP    = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M8 11h8M8 15h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const ICON_SINAPI  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const ICON_SICRO   = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const ICON_USER    = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const ICON_EVT     = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 14h4M8 18h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  document.getElementById('pageContent').innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Dashboard</h1>
        <p>Visão geral do sistema de orçamentação</p>
      </div>
    </div>

    <!-- Linha 1: KPIs principais -->
    <div class="cards-grid">
      ${kpi(totalObras,      'Obras Cadastradas',  ICON_OBRA,   'blue')}
      ${kpi(totalOrcamentos, 'Orçamentos',         ICON_ORC,    'green')}
      ${kpi(totalInsumos,    'Insumos',            ICON_INSUMO, 'yellow')}
      ${kpi(totalComposicoes,'Total Composições',  ICON_COMP,   'red')}
    </div>

    <!-- Linha 2: KPIs de composições por fonte -->
    <div class="cards-grid" style="margin-top:0">
      ${kpi(totalCompSINAPI,  'Composições SINAPI',  ICON_SINAPI, 'blue')}
      ${kpi(totalCompSICRO,   'Composições SICRO',   ICON_SICRO,  'green')}
      ${kpi(totalCompUsuario, 'Composições Usuário', ICON_USER,   'yellow')}
      ${kpi(totalEventogramas, 'Eventogramas', ICON_EVT, 'red')}
    </div>

    <!-- Últimos Orçamentos -->
    <div class="section-card">
      <div class="section-card-header">
        <h2>Últimos Orçamentos</h2>
        <a href="#orcamentos" class="btn btn-ghost btn-sm">Ver todos →</a>
      </div>
      ${ultimosOrcamentos.length === 0 ? `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5"/></svg>
          <p>Nenhum orçamento cadastrado ainda.</p>
          <a href="#orcamentos" class="btn btn-primary btn-sm">${Utils.icons.plus} Novo orçamento</a>
        </div>
      ` : `
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th>Orçamento</th><th>Obra</th><th>Status</th>
              <th>Valor Total</th><th>Data</th>
            </tr></thead>
            <tbody>
              ${ultimosOrcamentos.map(o => `
                <tr style="cursor:pointer" onclick="sessionStorage.setItem('osSintId','${o.id_orcamento}');location.hash='orcamento-sintetico'">
                  <td class="fw-500">${Utils.esc(o.nome_orcamento)}</td>
                  <td class="text-2">${Utils.esc(o.nome_obra || '—')}</td>
                  <td>${Utils.statusBadge(o.status)}</td>
                  <td>${Utils.moeda(o.valor_total)}</td>
                  <td class="text-3 text-sm">${Utils.data(o.data_criacao)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">

      <!-- Acesso Rápido -->
      <div class="section-card">
        <div class="section-card-header"><h2>Acesso Rápido</h2></div>
        <div class="section-card-body" style="display:flex;flex-direction:column;gap:8px">
          <a href="#obras"             class="btn btn-ghost w-100" style="justify-content:flex-start">🏗️ &nbsp;Cadastrar nova obra</a>
          <a href="#orcamentos"        class="btn btn-ghost w-100" style="justify-content:flex-start">📄 &nbsp;Criar / consultar orçamentos</a>
          <a href="#orcamento-sintetico" class="btn btn-ghost w-100" style="justify-content:flex-start"
             onclick="sessionStorage.removeItem('osSintId')">📋 &nbsp;Orçamentos Sintéticos</a>
          <a href="#composicoes"       class="btn btn-ghost w-100" style="justify-content:flex-start">🧱 &nbsp;Consultar composições</a>
          <a href="#insumos"           class="btn btn-ghost w-100" style="justify-content:flex-start">🏷️ &nbsp;Consultar insumos e preços</a>
          <a href="#fontes"            class="btn btn-ghost w-100" style="justify-content:flex-start">🔖 &nbsp;Importar SINAPI / SICRO</a>
          <a href="#datas-base"        class="btn btn-ghost w-100" style="justify-content:flex-start">📅 &nbsp;Gerenciar datas-base</a>
        </div>
      </div>

      <!-- Sobre o Sistema -->
      <div class="section-card">
        <div class="section-card-header"><h2>Sobre o Sistema</h2></div>
        <div class="section-card-body">

          <!-- Branding simples no Sobre (logo completo esta na tela inicial) -->
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      background:linear-gradient(135deg,#f7fbff,#e8f1fb);
                      border-radius:var(--radius);border:1px solid #c8d9ed;margin-bottom:16px">
            <img src="/img/orcapro-mark.svg" alt="OrçaPro" style="width:48px;height:48px;border-radius:12px;flex-shrink:0">
            <div>
              <div style="font-size:1.3rem;font-weight:900;letter-spacing:-.5px;line-height:1.1">
                <span style="color:#061f41">Orça</span><span style="color:#2d78d6">PRO</span>
              </div>
              <div style="font-size:.65rem;letter-spacing:2.5px;color:#4b7db5;text-transform:uppercase;margin-top:1px">
                Calculadora de Obras
              </div>
            </div>
          </div>

          <p style="font-size:.82rem;line-height:1.75;color:var(--c-text-2)">
            OrçaPro é um sistema de orçamentação de obras públicas e privadas, baseado nas tabelas referenciais
            <strong>SINAPI</strong> (Caixa Econômica Federal / IBGE) e <strong>SICRO</strong> (DNIT).<br><br>
            <strong style="color:var(--c-text)">Funcionalidades disponíveis:</strong><br>
            ✅ Obras e orçamentos<br>
            ✅ Orçamento Sintético com BDI<br>
            ✅ Curva ABC de Serviços e Insumos<br>
            ✅ Insumos e preços por UF / data-base<br>
            ✅ Encargos Sociais<br>
            ✅ Composições SINAPI (unitário) e SICRO (produção horária)<br>
            ✅ Importação de planilhas SINAPI e SICRO<br>
            ✅ Custo Horário de Equipamentos<br>
            ✅ BDI com Reforma Tributária (ISS/IBS/CBS)<br>
            ✅ Eventogramas<br>
            ✅ Geração de orçamentos por IA
          </p>
        </div>
      </div>

    </div>
  `;
});
