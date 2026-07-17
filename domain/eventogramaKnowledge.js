const EXECUTION_RULES = [
  'Mobilizacao e servicos preliminares antecedem as frentes produtivas.',
  'Infraestrutura, fundacoes e redes enterradas antecedem superestrutura, pavimentacao e acabamentos.',
  'Estrutura antecede cobertura, vedacoes, instalacoes embutidas e revestimentos.',
  'Instalacoes embutidas e testes precedem fechamento, pintura e entrega.',
  'Eventos devem representar entregas fisicamente verificaveis, sem pagamento meramente antecipado.',
  'Cada servico deve pertencer a um unico evento e todo evento deve possuir criterio de medicao.',
  'Eventos grandes devem ser divididos quando houver marcos independentes; eventos pequenos devem ser agrupados quando nao forem auditaveis isoladamente.',
];

const PLANNING_METHODS = {
  cpm: 'Use dependencias logicas do Metodo do Caminho Critico para impedir sucessores antes de predecessores.',
  lineOfBalance: 'Quando houver pavimentos, blocos, trechos ou unidades repetitivas, considere Linha de Balanco e continuidade das equipes.',
  publicProcurement: 'Privilegie rastreabilidade, medicao objetiva, evidencia documental e ausencia de antecipacao de pagamento.',
};

const ALTERNATIVE_PROFILES = [
  { codigo: 'A', nome: 'Poucos eventos', objetivo: 'Sintese contratual e menor carga administrativa.' },
  { codigo: 'B', nome: 'Equilibrado', objetivo: 'Equilibrio entre controle, auditabilidade e operacao.' },
  { codigo: 'C', nome: 'Maior controle', objetivo: 'Mais marcos fisicos independentes e rastreaveis.' },
  { codigo: 'D', nome: 'Maior fluxo de caixa', objetivo: 'Marcos executaveis mais frequentes, sem antecipacao indevida.' },
  { codigo: 'E', nome: 'Menor risco para a Administracao', objetivo: 'Eventos menores, evidencias fortes e dependencia conservadora.' },
];

function buildPlanningPrompt(context) {
  return `Voce integra uma equipe de agentes de IA especializados em planejamento de obras publicas brasileiras.

Papeis que devem compartilhar o mesmo contexto:
- Agente Planejador: infere a sequencia executiva e dependencias.
- Agente de Agrupamento: transforma servicos em eventos contratuais mensuraveis.
- Agente Financeiro: evita concentracao, calcula pesos e verifica compatibilidade dos valores.
- Agente de Auditoria: procura omissoes, sobreposicoes, antecipacao e criterios fracos.
- Agente Explicador: justifica tecnicamente cada decisao.

Regras de conhecimento:
${EXECUTION_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

Metodos:
- CPM: ${PLANNING_METHODS.cpm}
- Linha de Balanco: ${PLANNING_METHODS.lineOfBalance}
- Contratacao publica: ${PLANNING_METHODS.publicProcurement}

Contexto da obra e do orcamento:
${JSON.stringify(context)}

Analise tambem todos os documentos anexados a esta mensagem. O projeto e o memorial podem alterar a sequencia sugerida; o cronograma deve ser confrontado com a proposta.

Responda SOMENTE com JSON valido, sem markdown, neste formato:
{
  "resumo_engenharia": "diagnostico conciso",
  "premissas": ["premissa"],
  "plano_equilibrado": {
    "nome": "Modelo B - Equilibrado",
    "justificativa": "justificativa global",
    "eventos": [{
      "descricao": "nome objetivo",
      "grupo": "etapa construtiva",
      "item_ids": [1, 2],
      "dependencias": ["01"],
      "criterio_medicao": "entrega fisica verificavel",
      "condicao_pagamento": "condicao sem antecipacao",
      "documentos_comprobatorios": "boletim, ensaio, registro ou aceite",
      "prazo_marco": "marco ou sequencia",
      "justificativa": "por que os servicos foram agrupados",
      "riscos": ["risco de medicao"],
      "prioridade_fluxo": 0
    }]
  },
  "alternativas": [
    {"codigo":"A","nome":"Poucos eventos","estrategia":"...","vantagens":["..."],"riscos":["..."]},
    {"codigo":"C","nome":"Maior controle","estrategia":"...","vantagens":["..."],"riscos":["..."]},
    {"codigo":"D","nome":"Maior fluxo de caixa","estrategia":"...","vantagens":["..."],"riscos":["..."]},
    {"codigo":"E","nome":"Menor risco para a Administracao","estrategia":"...","vantagens":["..."],"riscos":["..."]}
  ],
  "alertas_documentais": ["inconsistencia ou ausencia relevante"]
}

Obrigatorio: use exclusivamente os id_item informados no contexto; nao invente IDs; associe cada item uma unica vez; preserve a ordem executiva; nao inclua percentuais ou valores inventados.`;
}

function buildRefinementPrompt(context, instruction) {
  return `Atue como engenheiro de planejamento e revise integralmente o eventograma abaixo conforme a instrucao do usuario.
Mantenha todos os itens associados exatamente uma vez e respeite as regras de sequencia executiva, medicao objetiva e nao antecipacao.

Instrucao: ${instruction}

Contexto atual:
${JSON.stringify(context)}

Responda SOMENTE com JSON valido no formato:
{"mensagem":"explicacao da alteracao","plano":{"nome":"Plano revisado","justificativa":"...","eventos":[{"descricao":"...","grupo":"...","item_ids":[1],"dependencias":[],"criterio_medicao":"...","condicao_pagamento":"...","documentos_comprobatorios":"...","prazo_marco":"...","justificativa":"...","riscos":[]}]}}`;
}

module.exports = {
  EXECUTION_RULES,
  PLANNING_METHODS,
  ALTERNATIVE_PROFILES,
  buildPlanningPrompt,
  buildRefinementPrompt,
};
