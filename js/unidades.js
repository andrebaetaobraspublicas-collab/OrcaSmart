/* js/unidades.js */

Router.register('unidades', async () => {
  let lista = [];

  async function carregar() {
    try { lista = await API.unidades.list(); renderTabela(); }
    catch(e) { Toast.error(e.message); }
  }

  function renderTabela() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Unidades de Medida</h1>
          <p>${lista.length} unidade(s) cadastrada(s)</p>
        </div>
        <button class="btn btn-primary" id="btnNovaUn">${Utils.icons.plus} Nova Unidade</button>
      </div>
      <div class="section-card">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>#</th><th>Sigla</th><th>Descrição</th><th>Tipo</th><th>Ações</th></tr></thead>
            <tbody>
              ${lista.length === 0 ? `<tr><td colspan="5"><div class="empty-state"><p>Nenhuma unidade cadastrada.</p></div></td></tr>` :
              lista.map(u => `
                <tr>
                  <td class="text-xs text-3">${u.id_unidade}</td>
                  <td><span class="badge badge-info">${Utils.esc(u.sigla)}</span></td>
                  <td>${Utils.esc(u.descricao)||'—'}</td>
                  <td class="text-sm text-2">${Utils.esc(u.tipo_unidade)||'—'}</td>
                  <td>
                    <div class="td-actions">
                      <button class="btn-icon edit"   data-id="${u.id_unidade}" data-action="edit">${Utils.icons.edit}</button>
                      <button class="btn-icon delete" data-id="${u.id_unidade}" data-action="del">${Utils.icons.delete}</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-info">${lista.length} registro(s)</div>
      </div>`;

    document.getElementById('btnNovaUn').addEventListener('click', () => abrirForm());
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'edit') abrirForm(btn.dataset.id);
        else excluir(btn.dataset.id);
      });
    });
  }

  function abrirForm(id = null) {
    const u = lista.find(x => x.id_unidade == id) || {};
    const tipos = ['Comprimento','Área','Volume','Massa','Tempo','Quantidade','Outro'];
    Modal.open({
      title: id ? 'Editar Unidade' : 'Nova Unidade de Medida',
      body: `
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Sigla <span class="req">*</span></label>
            <input class="form-control" id="f_sigla" type="text" value="${Utils.esc(u.sigla||'')}" placeholder="Ex: m², kg, un">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-control" id="f_tipo">
              <option value="">Selecione...</option>
              ${tipos.map(t => `<option ${u.tipo_unidade===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input class="form-control" id="f_desc" type="text" value="${Utils.esc(u.descricao||'')}" placeholder="Ex: Metro quadrado">
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnSalvarUn">${id ? 'Salvar' : 'Criar'}</button>`
    });
    document.getElementById('btnSalvarUn').addEventListener('click', async () => {
      const payload = {
        sigla:        document.getElementById('f_sigla').value.trim(),
        tipo_unidade: document.getElementById('f_tipo').value,
        descricao:    document.getElementById('f_desc').value.trim(),
      };
      if (!payload.sigla) { Toast.warning('Sigla obrigatória.'); return; }
      try {
        if (id) { await API.unidades.update(id, payload); Toast.success('Unidade atualizada!'); }
        else     { await API.unidades.create(payload);    Toast.success('Unidade criada!'); }
        Modal.close(); carregar();
      } catch(e) { Toast.error(e.message); }
    });
  }

  async function excluir(id) {
    const u = lista.find(x => x.id_unidade == id);
    if (!await Confirm.ask(`Excluir unidade "${u?.sigla}"?`)) return;
    try { await API.unidades.delete(id); Toast.success('Excluída.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  carregar();
});
