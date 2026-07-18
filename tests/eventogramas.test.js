const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/eventogramasRepository');
const service = require('../services/eventogramasService');
const aiService = require('../services/eventogramasAiService');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function validarInsertCompativelComTenantMysql() {
  const comandos = [];
  const fakeDb = {
    run(sql, params, callback) {
      comandos.push({ sql, params });
      callback.call({ lastID: comandos.length, changes: 1 }, null);
    },
  };
  await repo.insertEventoItens(fakeDb, 7, [{ id_item: 10 }, { id_item: 11 }, { id_item: 11 }]);
  assert.strictEqual(comandos.length, 2, 'cada item deve usar um INSERT tenant-safe');
  assert.ok(comandos.every(row => !/\)\s*,\s*\(/.test(row.sql)), 'nao deve haver VALUES com contagens diferentes por linha');
  assert.deepStrictEqual(comandos.map(row => row.params), [[7, 10], [7, 11]]);
}

async function main() {
  await validarInsertCompativelComTenantMysql();
  const frontendSource = fs.readFileSync(path.resolve(__dirname, '../js/eventograma.js'), 'utf8');
  assert.ok(
    frontendSource.includes("querySelectorAll('.evt-card[data-evid], .subevt-card[data-evid]')"),
    'eventos principais e subeventos devem aceitar itens arrastados'
  );
  assert.ok(frontendSource.includes('height:210px'), 'graficos do diagnostico devem usar escala vertical ampliada');
  assert.ok(frontendSource.includes('Percentual acumulado (%)'), 'Curva S deve identificar o eixo vertical');
  assert.ok(frontendSource.includes('Valor do evento (R$)'), 'fluxo financeiro deve identificar o eixo vertical');
  assert.ok(frontendSource.includes('name="eventograma_filtro_eventos"'), 'busca de eventos deve ser independente do login');
  assert.ok(frontendSource.includes('name="anthropic_api_key_refinamento"'), 'chave de refinamento deve ser isolada do campo de busca');
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE obras (id_obra INTEGER PRIMARY KEY, nome_obra TEXT, descricao TEXT, tipo_obra TEXT, municipio TEXT, uf TEXT);
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY, id_obra INTEGER, nome_orcamento TEXT,
        valor_total REAL, bdi_percentual REAL, descricao TEXT, regime_previdenciario TEXT
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY, id_orcamento INTEGER, item TEXT, codigo TEXT,
        descricao TEXT, unidade TEXT, quantidade REAL, custo_unitario REAL,
        bdi_percentual_linha REAL, tipo_linha TEXT, profundidade INTEGER,
        ordem INTEGER, fonte TEXT
      );
      CREATE TABLE eventogramas (
        id_eventograma INTEGER PRIMARY KEY AUTOINCREMENT, id_orcamento INTEGER,
        nome TEXT, descricao TEXT, modo_geracao TEXT, status TEXT,
        valor_total_ref REAL, observacoes TEXT,
        data_criacao TEXT DEFAULT CURRENT_TIMESTAMP, data_atualizacao TEXT
      );
      CREATE TABLE ev_eventos (
        id_evento INTEGER PRIMARY KEY AUTOINCREMENT, id_eventograma INTEGER,
        id_evento_pai INTEGER, numero_evento TEXT, descricao TEXT, grupo TEXT,
        criterio_medicao TEXT, condicao_pagamento TEXT, prazo_marco TEXT,
        docs_comprobatorios TEXT, observacoes TEXT, valor_calculado REAL, ordem INTEGER
      );
      CREATE TABLE ev_evento_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT, id_evento INTEGER, id_item INTEGER,
        UNIQUE(id_evento, id_item)
      );

      INSERT INTO obras VALUES (1, 'Obra Teste', 'Obra para validar planejamento', 'Edificacao', 'Fortaleza', 'CE');
      INSERT INTO orcamentos VALUES (1, 1, 'teste importacao', 330, 10, 'Orcamento de teste', 'Onerado');
      INSERT INTO orcamento_sintetico VALUES
        (1,1,'1',NULL,'SERVICOS PRELIMINARES',NULL,0,0,NULL,'section',0,1,NULL),
        (2,1,'1.1','A-01','Placa de obra','M2',2,100,NULL,'item',1,2,'SINAPI'),
        (3,1,'1.2','A-02','Mobilizacao','UN',1,100,NULL,'item',1,3,'USUARIO');
    `);
    if (process.env.EVENTOGRAMA_PDF_OUTPUT) {
      const extras = Array.from({ length: 28 }, (_, index) => {
        const id = index + 4;
        const ordem = index + 4;
        return `(${id},1,'1.${index + 3}','A-${String(index + 3).padStart(2, '0')}','Servico complementar de engenharia com descricao detalhada para verificacao da quebra de linha e da paginacao profissional','M2',1,50,NULL,'item',1,${ordem},'SINAPI')`;
      });
      await exec(db, `INSERT INTO orcamento_sintetico VALUES ${extras.join(',')}; UPDATE orcamentos SET valor_total=1870 WHERE id_orcamento=1;`);
    }

    const evg = await service.createEventograma(db, {
      id_orcamento: 1,
      nome: 'Eventograma teste',
      modo_geracao: 'automatico',
    });
    const gerado = await service.gerar(db, evg.id_eventograma, { limpar_existentes: true });
    assert.strictEqual(gerado.status, 'ok');
    assert.strictEqual(gerado.eventos_criados, 1);

    const detalhe = await service.getEventograma(db, evg.id_eventograma);
    const itens = detalhe.itens_orcamento.filter(item => item.tipo_linha === 'item');
    assert.strictEqual(itens.length, process.env.EVENTOGRAMA_PDF_OUTPUT ? 30 : 2);
    assert.ok(itens.every(item => item.alocado));
    assert.ok(itens.every(item => item.id_evento_alocado));
    assert.ok(itens.every(item => item.numero_evento_alocado === '01'));
    assert.deepStrictEqual(detalhe.eventos[0].itens.slice(0, 2).map(item => item.valor), [220, 110]);

    const eventoPai = detalhe.eventos[0];
    const subevento = await service.createEvento(db, evg.id_eventograma, {
      id_evento_pai: eventoPai.id_evento,
      numero_evento: '01.01',
      descricao: 'Mobilizacao e desmobilizacao',
      grupo: 'Servicos preliminares',
    });
    await service.moveItensEvento(db, eventoPai.id_evento, {
      id_evento_destino: subevento.id_evento,
      ids: [2],
    });
    const detalheComSubevento = await service.getEventograma(db, evg.id_eventograma);
    assert.deepStrictEqual(detalheComSubevento.eventos[0].itens.map(item => item.id_item), [3]);
    assert.deepStrictEqual(detalheComSubevento.eventos[0].subeventos[0].itens.map(item => item.id_item), [2]);
    assert.strictEqual(detalheComSubevento.eventos[0].valor_calculado, 330);
    assert.strictEqual(detalheComSubevento.eventos[0].subeventos[0].valor_calculado, 220);

    await service.moveItensEvento(db, subevento.id_evento, {
      id_evento_destino: eventoPai.id_evento,
      ids: [2],
    });
    const detalheRestaurado = await service.getEventograma(db, evg.id_eventograma);
    assert.deepStrictEqual(detalheRestaurado.eventos[0].itens.map(item => item.id_item).sort(), [2, 3]);
    assert.strictEqual(detalheRestaurado.eventos[0].subeventos[0].itens.length, 0);

    const budgetItems = detalhe.itens_orcamento.filter(item => item.tipo_linha === 'item').map(item => ({ ...item, valor: item.valor, secao: 'Servicos preliminares' }));
    const balanced = aiService.normalizePlan({
      nome: 'Modelo B - Equilibrado',
      justificativa: 'Sequencia executiva testada.',
      eventos: [
        { descricao: 'Mobilizacao', grupo: 'Preliminares', item_ids: [2], criterio_medicao: 'Placa instalada e aceita.', documentos_comprobatorios: 'Boletim e foto.', justificativa: 'Precede as frentes.' },
        { descricao: 'Implantacao', grupo: 'Preliminares', item_ids: [3], dependencias: ['01'], criterio_medicao: 'Mobilizacao concluida.', documentos_comprobatorios: 'Boletim de medicao.', justificativa: 'Marco independente.' },
      ],
    }, budgetItems);
    const alternatives = aiService.buildAlternatives({ alternativas: [] }, balanced, budgetItems);
    assert.deepStrictEqual(alternatives.map(alt => alt.codigo), ['A', 'B', 'C', 'D', 'E']);

    await service.aplicarPlanoIA(db, evg.id_eventograma, {
      plano: balanced,
      codigo: 'B',
      model: 'claude-test',
      resumo_engenharia: 'Plano equilibrado de teste.',
      premissas: ['Medicao objetiva'],
      documentos: [{ nome: 'memorial.pdf', categoria: 'memorial', bytes: 100 }],
    });
    const detalheIA = await service.getEventograma(db, evg.id_eventograma);
    assert.strictEqual(detalheIA.modo_geracao, 'automatico_ia');
    assert.strictEqual(detalheIA.ai_metadata.modelo, 'claude-test');
    assert.strictEqual(detalheIA.eventos.length, 2);
    assert.strictEqual(detalheIA.eventos[0].ai_metadata.justificativa, 'Precede as frentes.');
    assert.deepStrictEqual(detalheIA.eventos.map(event => event.valor_calculado), [220, 110]);
    assert.ok(!String(detalheIA.observacoes || '').includes('ORCASMART_EVENTOGRAMA_IA'));

    const quality = await service.validar(db, evg.id_eventograma);
    assert.strictEqual(quality.percentual_alocado, 100);
    assert.ok(quality.indicadores.score_qualidade >= 0);
    assert.strictEqual(quality.indicadores.curva_s.length, 2);

    const jsonExport = await service.exportJson(db, evg.id_eventograma);
    assert.strictEqual(jsonExport.eventograma.ai_metadata.alternativa, 'B');
    assert.ok(jsonExport.validacao.indicadores);

    const pdf = await service.exportPdf(db, evg.id_eventograma);
    assert.match(pdf.filename, /\.pdf$/);
    assert.strictEqual(pdf.buffer.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    assert.ok(pdf.buffer.length > 500);
    if (process.env.EVENTOGRAMA_PDF_OUTPUT) {
      const output = path.resolve(process.env.EVENTOGRAMA_PDF_OUTPUT);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, pdf.buffer);
    }

    const deleted = await service.deleteEventograma(db, evg.id_eventograma);
    assert.strictEqual(deleted.status, 'ok');
    assert.ok(!(await repo.getEventogramaRaw(db, evg.id_eventograma)));
    assert.strictEqual((await new Promise((resolve, reject) => db.get('SELECT COUNT(*) AS total FROM ev_eventos', [], (error, row) => error ? reject(error) : resolve(row)))).total, 0);
    assert.strictEqual((await new Promise((resolve, reject) => db.get('SELECT COUNT(*) AS total FROM ev_evento_itens', [], (error, row) => error ? reject(error) : resolve(row)))).total, 0);

    console.log('eventogramas.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
