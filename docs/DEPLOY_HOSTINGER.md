# Deploy do OrcaSmart3 no Hostinger

Atualizado em 18/07/2026.

## Fluxo oficial

O deploy é executado pelo workflow `.github/workflows/deploy-hostinger.yml` em
push para `main`.

O workflow:

1. faz checkout;
2. empacota dependências de runtime necessárias;
3. grava `tmp/restart.txt`;
4. publica via FTP no diretório configurado pelos secrets do GitHub.

Arquivos `.env`, bancos SQLite, diretórios de tenant e exports são excluídos do
upload.

## Publicação a partir da branch local

```powershell
Set-Location C:\SistemaOrcamentoObras\saas
git status --short
git diff --check
git add -- <somente arquivos da tarefa>
git commit -m "Descrição objetiva"
git push origin HEAD:main
```

Não adicionar alterações locais alheias à tarefa.

## Servidor

- Aplicação: `/home/u296746636/domains/calculoobra.com.br/nodejs`.
- Dados persistentes: `/home/u296746636/domains/calculoobra.com.br/orcasmart2-data`.
- Produção: `https://calculoobra.com.br/`.
- Node configurado no Hostinger: 22.x.

## Reinício

O deploy sinaliza reinício por `tmp/restart.txt`, mas é necessário confirmar que
o processo foi realmente reciclado. Um arquivo novo no disco não significa que o
Node já recarregou os módulos em memória.

Validação mínima:

1. confirmar o arquivo/commit no servidor;
2. conferir data de início do processo Node;
3. se o processo for anterior ao deploy, reiniciar controladamente;
4. aguardar novo processo e conferir a página de login;
5. consultar `/api/status`.

Evitar reiniciar durante importação SINAPI/SICRO ou job de IA, pois alguns jobs
atuais são mantidos em memória.

## Validação pós-deploy

```text
GET https://calculoobra.com.br/api/status
```

Esperado: `status=ok`, `runtime=node`, MySQL e master MySQL ativos,
`mysqlReady=true`, `cutoverReady=true`.

Também é obrigatório testar o fluxo funcional modificado. O status saudável não
garante que uma regra de negócio específica esteja correta.

## Segurança

- Secrets FTP ficam apenas no GitHub.
- Variáveis de banco/IA ficam apenas no Hostinger.
- Não copiar `.env`, senhas, cookies, tokens ou chaves SSH para commits ou docs.
- Backups e exclusões administrativas devem manter confirmação e auditoria.
