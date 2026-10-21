# Painel de Leads — OrderUp CRM

> Status: **Implementado**. Funil Kanban multi-tenant baseado em contatos, com pipelines e etapas configuráveis.

## Decisão de domínio

`Contact` continua sendo a identidade central da pessoa no WhatsApp e no CRM. `Lead` representa uma
oportunidade comercial vinculada a um contato. Isso permite que o mesmo contato tenha oportunidades
distintas sem duplicar telefone, nome, histórico ou conversa.

## Entidades

- `LeadPipeline`: funil do tenant, com nome, descrição e estado ativo.
- `LeadStage`: etapa ordenada do pipeline. `kind` define se a etapa mantém a oportunidade aberta
  (`OPEN`) ou a encerra como ganha (`WON`) ou perdida (`LOST`).
- `Lead`: oportunidade com `contactId`, pipeline, etapa, responsável (`TenantUser`), título,
  origem, valor em centavos, observações, próximo follow-up e datas de fechamento.
- `LeadTag`: vínculo N:N com o catálogo compartilhado de etiquetas do tenant.

Todas as entidades possuem `tenantId`. Contato, responsável, pipeline e etapa são validados no
tenant atual. Identificadores de outro tenant retornam `404`.

## Pipeline padrão

Organizações existentes recebem, via migration, as etapas:

1. Novo lead
2. Entrou em contato
3. Qualificado
4. Proposta enviada
5. Pagamento
6. Venda ganha
7. Perdido

Novas organizações recebem a mesma configuração durante o provisionamento. `Pagamento` é uma
etapa comercial; cobranças e confirmação real de pagamento continuam pertencendo ao módulo
Financeiro.

## API

Todas as rotas exigem autenticação, membership ativa e o módulo `crm` habilitado.

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/leads/pipelines` | Lista pipelines e etapas |
| POST | `/api/leads/pipelines` | Cria pipeline (`OWNER`/`ADMIN`) |
| PATCH | `/api/leads/pipelines/:id` | Atualiza pipeline (`OWNER`/`ADMIN`) |
| POST | `/api/leads/pipelines/:id/stages` | Cria etapa (`OWNER`/`ADMIN`) |
| PATCH | `/api/leads/pipelines/:id/stages/:stageId` | Atualiza etapa (`OWNER`/`ADMIN`) |
| DELETE | `/api/leads/pipelines/:id/stages/:stageId` | Exclui etapa vazia (`OWNER`/`ADMIN`) |
| GET | `/api/leads/board` | Retorna Kanban agregado por etapa |
| POST | `/api/leads` | Cria lead |
| PATCH | `/api/leads/:id` | Edita lead |
| PATCH | `/api/leads/:id/stage` | Move lead e deriva o status |
| DELETE | `/api/leads/:id` | Exclui lead (`OWNER`/`ADMIN`) |

O board aceita `pipelineId`, `search`, `ownerId` e `limitPerStage`. Cada coluna inclui contagem e
valor total calculados no banco, além dos cards limitados para proteger a consulta.

## Frontend

`/leads` apresenta indicadores do funil, busca, filtro por responsável, colunas horizontais,
drag-and-drop persistido, cadastro/edição de oportunidade, seleção incremental de contato por nome
ou telefone e gestão de etapas para administradores.
O card exibe contato, telefone/e-mail, origem, valor, responsável, etiquetas e follow-up vencido.
Ao abrir um card, o painel detalhado destaca a etapa atual, apresenta a sequência do pipeline e carrega as
conversas reais do contato, incluindo mensagens, mídias, respostas e envio pelo WhatsApp. As
mensagens continuam armazenadas exclusivamente no domínio de Atendimento; o lead mantém apenas o
vínculo pelo `contactId`.

O detalhe também integra o **Copiloto comercial** ([`ai.md`](./ai.md)): o painel recupera o contexto
comercial salvo, recomenda a próxima melhor ação, prepara follow-ups e sugere atualizações do lead
com evidência. O usuário pode aceitar, rejeitar ou editar as sugestões; a IA nunca envia mensagens,
move etapas ou altera dados sem confirmação explícita. A etapa só é alterada após validação contra
as etapas reais do pipeline.

