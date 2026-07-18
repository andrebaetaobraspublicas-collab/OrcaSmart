# Leia antes — OrcaSmart3 SaaS/MySQL

Atualizado em 18/07/2026.

Antes de continuar o desenvolvimento em outro chat, leia nesta ordem:

```text
docs/README.md
docs/ESTADO_ATUAL_ORCASMART_2026-07-18.md
docs/HANDOFF_NOVO_CHAT_2026-07-18.md
docs/MODULOS_E_ARQUITETURA.md
```

Depois, leia o documento específico do módulo.

## Resumo obrigatório

- Produção oficial: `https://calculoobra.com.br/`.
- Código SaaS: `C:\SistemaOrcamentoObras\saas`.
- Backend oficial: Node.js/Express, não Python.
- Banco de produção: MariaDB/MySQL.
- Branch local de trabalho: `orcasmart2`.
- Deploy: push intencional para `main` + GitHub Actions/FTP.
- Último commit funcional deste handoff: `5dccb3d`.
- Desktop: `C:\SistemaOrcamentoObras`, Flask/SQLite, separado e protegido.

## Regras

- Não descartar alterações locais não relacionadas.
- Não sobrescrever referência oficial em ações de usuário comum.
- Toda leitura/escrita privada deve respeitar `tenant_id`.
- Usar jobs com progresso para importações e cálculos longos.
- Validar com arquivos e dados reais.
- Após deploy, conferir `/api/status`, reinício do Node e o fluxo afetado.
- `docs/generated/*` é histórico/diagnóstico local, não fonte absoluta da
  produção.
