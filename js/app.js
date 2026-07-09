/* js/app.js — Inicialização da aplicação */

document.addEventListener('DOMContentLoaded', async () => {
  // ─── Inicializar componentes ────────────────────────────────
  Modal.init();
  Confirm.init();
  Toast.init();
  Router.init();

  try {
    const me = await API.auth.me();
    const isAdmin = me && me.role === 'admin';
    document.querySelectorAll('.nav-admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
    const badge = document.getElementById('topbar-badge');
    if (isAdmin && badge) {
      badge.textContent = 'Admin';
      badge.style.display = '';
    }
  } catch (_) {
    document.querySelectorAll('.nav-admin-only').forEach(el => { el.style.display = 'none'; });
  }

  // ─── Toggle da sidebar ──────────────────────────────────────
  const sidebar  = document.getElementById('sidebar');
  const wrapper  = document.querySelector('.main-wrapper');
  const toggle   = document.getElementById('sidebarToggle');
  let collapsed  = localStorage.getItem('sidebar_collapsed') === 'true';

  function applySidebar() {
    sidebar.classList.toggle('collapsed', collapsed);
    if (collapsed) wrapper.style.marginLeft = '60px';
    else           wrapper.style.marginLeft = 'var(--sidebar-w)';
  }

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    localStorage.setItem('sidebar_collapsed', collapsed);
    applySidebar();
  });

  applySidebar();

  // ─── Mobile sidebar overlay ─────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:199;display:none';
  document.body.appendChild(overlay);

  function isMobile() { return window.innerWidth < 769; }

  if (isMobile()) {
    sidebar.classList.remove('collapsed');
    wrapper.style.marginLeft = '0';
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('mobile-open');
      overlay.style.display = open ? 'block' : 'none';
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.style.display = 'none';
    });
  }

  // ─── Verificar status do servidor ───────────────────────────
  try {
    await API.status();
    document.getElementById('footer-status').className = 'status-dot online';
  } catch(e) {
    document.getElementById('footer-status').className = 'status-dot offline';
    Toast.error('Não foi possível conectar ao servidor. Verifique se o Node.js está rodando.');
  }
});
