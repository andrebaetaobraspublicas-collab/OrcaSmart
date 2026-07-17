# Eventograma Inteligente - arquitetura e operacao

## Escopo

O modo `automatico` do Eventograma utiliza a API Anthropic para interpretar o orcamento sintetico, as composicoes vinculadas e documentos facultativos da obra. Os modos `manual` e `semiautomatico` continuam usando seus fluxos anteriores.

## Fontes analisadas

- estrutura e plano de contas do orcamento sintetico;
- servicos, unidades, quantitativos, custos, BDI e peso financeiro;
- itens das composicoes vinculadas, quando disponiveis;
- projeto em PDF ou imagem;
- memorial em PDF, DOCX, TXT ou Markdown;
- cronograma em PDF, XLSX, XLSM ou CSV;
- outros documentos nos formatos suportados pela tela.

Arquivos enviados para a analise nao sao gravados no banco. O banco conserva apenas nome, categoria e tamanho dos documentos utilizados, para rastreabilidade da decisao.

## Chaves Anthropic

A ordem de uso e:

1. chave temporaria informada pelo usuario;
2. `ANTHROPIC_API_KEY` do ambiente do servidor.

A chave temporaria permanece apenas na memoria durante a requisicao e o processamento do job. Ela nao e gravada em banco, metadados, logs ou respostas da API. A tela direciona o usuario ao console oficial da Anthropic para criar sua chave.

O modelo pode ser configurado por `ANTHROPIC_MODEL`; o padrao atual e `claude-sonnet-4-6`.

## Agentes logicos

A implementacao em `services/eventogramasAiService.js` coordena cinco responsabilidades sobre um contexto comum:

- Planejador: sequencia executiva, CPM e Linha de Balanco;
- Agrupamento: eventos mensuraveis e rastreaveis;
- Financeiro: valores, pesos e concentracao;
- Auditoria: omissoes, sobreposicoes, antecipacao e criterios insuficientes;
- Explicador/Aprendizado: justificativas e feedback do usuario.

As regras de conhecimento ficam em `domain/eventogramaKnowledge.js`.

## Alternativas

A analise produz cinco modelos:

- A - Poucos eventos;
- B - Equilibrado;
- C - Maior controle;
- D - Maior fluxo de caixa, sem antecipacao indevida;
- E - Menor risco para a Administracao.

Todo servico e validado contra os IDs reais do orcamento e materializado uma unica vez. Itens eventualmente omitidos pela resposta da IA sao reconciliados localmente por secao e afinidade semantica.

## Processamento assincrono

A geracao pode levar alguns minutos. A tela inicia um job em memoria e consulta seu progresso, evitando manter uma requisicao HTTP aberta durante toda a chamada Anthropic. Jobs expiram em 30 minutos; apenas um job pode executar por eventograma e o servidor aceita ate quatro analises concorrentes.

Endpoints principais:

- `GET /api/eventogramas/ia/config`;
- `POST /api/eventogramas/:id/ia/planejar-job`;
- `GET /api/eventogramas/:id/ia/jobs/:jobId`;
- `POST /api/eventogramas/:id/ia/aplicar`;
- `POST /api/eventogramas/:id/ia/refinar`;
- `POST /api/eventogramas/:id/ia/feedback`.

## Persistencia e compatibilidade

Nao foram criadas tabelas novas. Os eventos continuam em `ev_eventos` e seus itens em `ev_evento_itens`. Metadados explicativos versionados usam o campo `observacoes`, sem remover o texto livre do usuario. A edicao posterior de observacoes preserva esses metadados.

## Auditoria e indicadores

O backend calcula, sem depender da resposta da IA:

- servicos esquecidos ou duplicados;
- eventos sem servico, criterio, dependencia ou documento;
- suspeita de pagamento antecipado;
- eventos pequenos ou excessivamente grandes;
- numero de eventos, media, desvio padrao e concentracao;
- equilibrio, risco, complexidade, rastreabilidade e auditabilidade;
- score de qualidade, Curva S, fluxo financeiro e histograma.

As exportacoes JSON, Excel e PDF permanecem disponiveis. O JSON inclui a estrutura completa e o diagnostico calculado.
