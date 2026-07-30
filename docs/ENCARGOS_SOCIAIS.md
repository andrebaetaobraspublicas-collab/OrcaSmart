# Módulo de Encargos Sociais

## Estado funcional

- A listagem separa mês-base do período de vigência.
- O filtro `Criados pelo usuário` reúne perfis privados criados no tenant, sem
  misturá-los com revisões privadas de referências oficiais.
- Novos perfis manuais usam a fonte `USUARIO` por padrão e podem ser vinculados
  a uma data-base cadastrada.
- Percentuais são armazenados e calculados em unidades percentuais, por exemplo
  `37.8` representa `37,8%`.
- Valores `DECIMAL(20,8)` retornados pelo MariaDB usam ponto decimal e não podem
  ser interpretados como números formatados no padrão brasileiro.
- As tabelas analíticas SICRO e GOINFRA oferecem cinco ações por profissional:
  consultar, editar, aplicar ao orçamento, duplicar como perfil do usuário e
  excluir.
- Ao aplicar um encargo profissional, o sistema escolhe o registro onerado ou
  desonerado conforme o regime previdenciário do orçamento selecionado.

## Desempenho

- Escritas do módulo reutilizam uma única conexão MySQL por requisição.
- O cálculo dos grupos A-D usa uma única agregação.
- Grupos e parcelas são carregados em duas consultas, sem uma consulta
  adicional para cada grupo.
- Releituras independentes do perfil e dos grupos são paralelizadas na
  interface.

## Testes

```powershell
npm.cmd run test:encargos
```

O teste cobre a conversão de percentuais MariaDB, filtros, importação SICRO,
comparações MySQL e as rotas profissionais SICRO/GOINFRA.
