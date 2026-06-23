/* js/datasBase.js */

Router.register('datas-base', async () => {
  let lista = [];

  async function carregar() {
    try { lista = await API.datasBase.list(); renderTabela(); }
    catch(e) { Toast.error(e.message); }
  }

  function renderTabela() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Datas-Base</h1>
          <p>${lista.length} data(s)-base cadastrada(s)</p>
        </div>
        <button class="btn btn-primary" id="btnNovaDB">${Utils.icons.plus} Nova Data-Base</button>
      </div>
      <div class="section-card">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Referência</th><th>Mês</th><th>Ano</th><th>Descrição</th><th>Ações</th></tr></thead>
            <tbody>
              ${lista.length === 0 ? `<tr><td colspan="5"><div class="empty-state"><p>Nenhuma data-base cadastrada.</p></div></td></tr>` :
              lista.map(d => `
                <tr>
                  <td><span class="badge badge-gray">${String(d.mes).padStart(2,'0')}/${d.ano}</span></td>
                  <td class="text-sm">${Utils.nomeMes(d.mes)}</td>
                  <td class="text-sm">${d.ano}</td>
                  <td class="text-2">${Utils.esc(d.descricao)||'—'}</td>
                  <td>
                    <div class="td-actions">
                      <button class="btn-icon edit"   data-id="${d.id_data_base}" data-action="edit">${Utils.icons.edit}</button>
                      <button class="btn-icon delete" data-id="${d.id_data_base}" data-action="del">${Utils.icons.delete}</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-info">${lista.length} registro(s)</div>
      </div>`;

    document.getElementById('btnNovaDB').addEventListener('click', () => abrirForm());
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'edit') abrirForm(btn.dataset.id);
        else excluir(btn.dataset.id);
      });
    });
  }

  function abrirForm(id = null) {
    const d = lista.find(x => x.id_data_base == id) || {};
    const now = new Date();
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    Modal.open({
      title: id ? 'Editar Data-Base' : 'Nova Data-Base',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">Mês <span class="req">*</span></label>
            <select class="form-control" id="f_mes">
              <option value="">Selecione...</option>
              ${meses.map((m, i) =>
                `<option value="${i+1}" ${d.mes==(i+1)?'selected':''}>${String(i+1).padStart(2,'0')} — ${m}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Ano <span class="req">*</span></label>
            <input class="form-control" id="f_ano" type="number" min="2000" max="2099"
              value="${d.ano || now.getFullYear()}" placeholder="${now.getFullYear()}">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição</label>
            <input class="form-control" id="f_desc" type="text" value="${Utils.esc(d.descricao||'')}" placeholder="Ex: Fev/2025 — SINAPI">
          </div>
        </div>
        <p class="form-hint mt-1">⚠️ Não é permitido cadastrar duplicidade de mês e ano.</p>`,
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnSalvarDB">${id ? 'Salvar' : 'Criar'}</button>`
    });
    document.getElementById('btnSalvarDB').addEventListener('click', async () => {
      const payload = {
        mes:      parseInt(document.getElementById('f_mes').value),
        ano:      parseInt(document.getElementById('f_ano').value),
        descricao: document.getElementById('f_desc').value.trim(),
      };
      if (!payload.mes || payload.mes < 1 || payload.mes > 12) { Toast.warning('Selecione um mês válido.'); return; }
      if (!payload.ano || payload.ano.toString().length !== 4)  { Toast.warning('Informe um ano com 4 dígitos.'); return; }
      try {
        if (id) { await API.datasBase.update(id, payload); Toast.success('Data-base atualizada!'); }
        else     { await API.datasBase.create(payload);    Toast.success('Data-base criada!'); }
        Modal.close(); carregar();
      } catch(e) { Toast.error(e.message); }
    });
  }

  async function excluir(id) {
    const d = lista.find(x => x.id_data_base == id);
    if (!await Confirm.ask(`Excluir data-base ${String(d?.mes).padStart(2,'0')}/${d?.ano}?`)) return;
    try { await API.datasBase.delete(id); Toast.success('Excluída.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  carregar();
});
