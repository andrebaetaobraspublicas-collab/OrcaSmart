# Eventograma — arquitetura, IA e operação

Atualizado em 18/07/2026.

## Escopo

O módulo cria tabelas de eventos geradores de pagamento a partir de um orçamento
sintético. Oferece modos manual, semiautomático, automático e assistido por IA.

O nome do eventograma é independente do login e deve ser livremente informado
pelo usuário.

## Arquivos principais

- `js/eventogramas.js`: lista, editor, busca, arraste, gráficos e exportação.
- `routes/eventogramasRoutes.js`: endpoints HTTP.
- `services/eventogramasService.js`: regras, validação e exportações.
- `services/eventogramasAiService.js`: planejamento e refinamento por IA.
- `repositories/eventogramasRepository.js`: persistência.
- `domain/eventogramaKnowledge.js`: conhecimento e heurísticas.

## Dados analisados pela IA

- estrutura do orçamento e plano de contas;
- serviços, unidades, quantitativos, custos, BDI e peso financeiro;
- composições vinculadas;
- projeto, memorial, cronograma e documentos facultativos suportados.

Arquivos enviados para análise não são persistidos; o banco guarda metadados
necessários à rastreabilidade.

## Chaves e modelo

Ordem de uso:

1. chave temporária informada pelo usuário;
2. `ANTHROPIC_API_KEY` do ambiente.

A chave temporária não pode ser gravada em banco, logs ou respostas. O modelo é
configurável por `ANTHROPIC_MODEL`.

## Planejamento

A IA coordena responsabilidades de planejamento, agrupamento, financeiro,
auditoria e explicação. Pode produzir alternativas com poucos eventos, equilíbrio,
maior controle, fluxo de caixa e menor risco para a Administração.

Todos os serviços propostos devem ser reconciliados com IDs reais do orçamento.
O backend calcula diagnósticos sem confiar cegamente na resposta da IA.

## Processamento e progresso

Endpoints principais:

- `GET /api/eventogramas/ia/config`;
- `POST /api/eventogramas/:id/ia/planejar-job`;
- `GET /api/eventogramas/:id/ia/jobs/:jobId`;
- `POST /api/eventogramas/:id/ia/aplicar`;
- `POST /api/eventogramas/:id/ia/refinar`;
- `POST /api/eventogramas/:id/ia/feedback`.

A interface mantém um painel/barra de progresso após fechar o formulário inicial.
Jobs são mantidos em memória, expiram e podem ser interrompidos por reinício do
Node.

## Persistência

- Eventogramas: `eventogramas`.
- Eventos: `ev_eventos`.
- Itens: `ev_evento_itens`.
- Todos são dados privados do tenant.

Ao reabrir, eventos e associações devem permanecer. Não substituir a estrutura
persistida por um resultado vazio da interface.

## Edição

- Busca deve filtrar itens/eventos sem interferência de preenchimento automático
  de login.
- Itens podem ser arrastados entre etapas e subetapas compatíveis.
- O backend persiste a movimentação e recalcula valores/pendências.
- A exclusão do eventograma exige confirmação.

## Auditoria e gráficos

São calculados serviços esquecidos/duplicados, eventos sem critério/dependência,
antecipação, concentração, equilíbrio, risco, complexidade, rastreabilidade e
auditabilidade.

Os gráficos finais têm altura ampliada e eixos identificados. Incluem percentual
acumulado, fluxo financeiro e indicadores diagnósticos.

## Exportações

- JSON completo;
- Excel;
- PDF com cabeçalho, identificação, tabelas organizadas, totais e paginação.

Rotas:

- `GET /api/eventogramas/:id/exportar/json`;
- `GET /api/eventogramas/:id/exportar/excel`;
- `GET /api/eventogramas/:id/exportar/pdf`.

## Teste

```powershell
npm.cmd run test:eventogramas
```

Validar também criação, progresso, reabertura, busca, arraste e as três
exportações em um orçamento real.
