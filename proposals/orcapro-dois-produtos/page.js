(function () {
  'use strict';
  const dialog = document.getElementById('accessDialog');
  const message = document.getElementById('destinationMessage');
  const names = {
    login_pro: 'Acesso ao OrçaPro', login_infra: 'Acesso ao OrçaPro Infraestrutura',
    checkout_pro_monthly: 'OrçaPro · mensal · R$ 499/mês',
    checkout_pro_annual: 'OrçaPro · anual · R$ 4.990/ano',
    checkout_infra_monthly: 'OrçaPro Infraestrutura · mensal · R$ 599/mês',
    checkout_infra_annual: 'OrçaPro Infraestrutura · anual · R$ 5.990/ano'
  };
  function openAccess() {
    message.textContent = '';
    if (!dialog.open) dialog.showModal();
  }
  function navigate(key) {
    const raw = (window.ORCAPRO_COMMERCIAL_LINKS || {})[key];
    let url;
    try { url = new URL(raw); } catch (_) { /* Destino ainda não confirmado. */ }
    if (!Object.hasOwn(names, key) || !url || url.protocol !== 'https:' || url.username || url.password) {
      openAccess();
      message.textContent = (names[key] || 'Destino') + ': o endereço ainda precisa ser confirmado para disponibilização nesta página.';
      return;
    }
    window.location.assign(url.href);
  }
  document.querySelectorAll('[data-open-login]').forEach(function (button) {
    button.addEventListener('click', openAccess);
  });
  document.querySelectorAll('[data-destination]').forEach(function (button) {
    button.addEventListener('click', function () { navigate(button.dataset.destination); });
  });
  document.getElementById('closeAccess').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  } });
})();
