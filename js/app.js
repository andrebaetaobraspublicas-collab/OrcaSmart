/* js/app.js — Inicialização da aplicação */

document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('appSplash');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('is-hidden');
      setTimeout(() => splash.remove(), 500);
    }, 4000);
  }

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
    const userEl = document.getElementById('topbar-user');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (userEl) {
      userEl.textContent = me.nome || me.email || 'Usuário';
      userEl.style.display = '';
    }
    if (changePasswordBtn) changePasswordBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = '';
    const badge = document.getElementById('topbar-badge');
    if (isAdmin && badge) {
      badge.textContent = 'Admin';
      badge.style.display = '';
    }
  } catch (_) {
    document.querySelectorAll('.nav-admin-only').forEach(el => { el.style.display = 'none'; });
  }

  const changePasswordBtn = document.getElementById('changePasswordBtn');
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => {
      Modal.open({
        title: 'Alterar senha',
        body: `
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Senha atual</label>
              <input class="form-control" id="userCurrentPassword" type="password" autocomplete="current-password">
            </div>
            <div class="form-group">
              <label class="form-label">Nova senha</label>
              <input class="form-control" id="userNewPassword" type="password" autocomplete="new-password">
            </div>
          </div>`,
        footer: `
          <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
          <button class="btn btn-primary" id="confirmChangePassword">Salvar</button>`,
      });
      setTimeout(() => {
        const confirm = document.getElementById('confirmChangePassword');
        if (!confirm) return;
        confirm.addEventListener('click', async () => {
          try {
            await API.auth.changePassword({
              current_password: document.getElementById('userCurrentPassword').value,
              new_password: document.getElementById('userNewPassword').value,
            });
            Modal.close();
            Toast.success('Senha alterada com sucesso.');
          } catch (err) {
            Toast.error(err.message);
          }
        });
      }, 0);
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await API.auth.logout();
      } finally {
        window.location.href = '/login.html';
      }
    });
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
