# Integrações → Webhooks

> Status: **Implementado**. Integrações externas que enviam mensagens de texto ou imagem para
> grupos do WhatsApp usando uma instância já configurada no CRM.

## Visão geral

O módulo `webhooks` permite que um sistema externo faça `POST` em uma URL estável para enviar uma
mensagem de texto e, opcionalmente, uma imagem a um grupo. A instância remetente e o grupo
destinatário são definidos no cadastro da integração; o chamador externo envia apenas a mensagem e
a URL pública da imagem.

Este módulo é **independente** do webhook de entrada da Evolution API
(`POST /api/webhooks/evolution`), que continua recebendo eventos do WhatsApp sem alterações.

## Modelo de dados

| Tabela                 | Descrição                                                                 |
| ---------------------- | ------------------------------------------------------------------------- |
| `webhook_integrations` | Integração por organização: instância, grupo, credencial (hash), status.  |
| `webhook_executions`   | Histórico de execuções: status, ids externos, erro sanitizado, timestamps. |

A credencial é gerada com 32 bytes aleatórios (`whk_...`) e armazenada somente como hash SHA-256.
O valor completo é exibido **uma única vez**, na criação ou na regeneração. As listagens mostram
apenas os quatro últimos caracteres (`secretHint`).

Exclusão é lógica (`deletedAt` + `active = false`), preservando o histórico de execuções.

## Endpoints autenticados (CRM)

Todos exigem o módulo `webhooks` habilitado para a organização e o token de acesso normal.

| Método | Rota                                                        | Acesso               |
| ------ | ----------------------------------------------------------- | -------------------- |
| GET    | `/api/integrations/webhooks`                                | autenticado          |
| POST   | `/api/integrations/webhooks`                                | OWNER/ADMIN          |
| GET    | `/api/integrations/webhooks/:id`                            | autenticado          |
| PATCH  | `/api/integrations/webhooks/:id`                            | OWNER/ADMIN          |
| DELETE | `/api/integrations/webhooks/:id`                            | OWNER/ADMIN          |
| POST   | `/api/integrations/webhooks/:id/regenerate-secret`          | OWNER/ADMIN          |
| GET    | `/api/integrations/webhooks/:id/executions`                 | autenticado          |
| GET    | `/api/integrations/whatsapp/:instanceId/groups`             | autenticado          |

A rota de grupos usa `GET /group/fetchAllGroups/:instanceName` da Evolution API e exige instância
ativa e conectada.

## Endpoint externo de execução

```http
POST /api/integrations/webhooks/:id/execute
Authorization: Bearer <credencial>
Content-Type: application/json
Idempotency-Key: opcional-ate-200-caracteres
```

Também é aceito `x-webhook-secret: <credencial>` em vez de `Authorization`.

### Payload

```json
{
  "message": "Olá! Mensagem enviada pelo sistema externo.",
  "imageUrl": "https://exemplo.com/card.png"
}
```

- `message` é obrigatório, com 1 a 4096 caracteres.
- `imageUrl` é opcional e deve ser uma URL **HTTPS pública** de imagem, com no máximo 2048
  caracteres.
- Com `imageUrl` e mensagem de até **1024 caracteres**, o texto é enviado como legenda da imagem
  (tipo `IMAGE`). Acima de 1024 caracteres, a imagem é enviada com a legenda curta “Atualização da
  contribuição” e, em seguida, o texto completo é enviado como mensagem separada. Sem `imageUrl`,
  continua sendo texto.
- A imagem é baixada pelo CRM com timeout, limite de tamanho, validação de conteúdo e proteção
  contra SSRF (hosts privados/loopback/link-local são recusados).
- Campos extras são rejeitados (`whitelist`/`forbidNonWhitelisted`).
- A instância e o grupo **nunca** vêm do corpo: são resolvidos pela integração cadastrada.
- Se a integração estiver inativa, a instância desconectada/inativa, o módulo `webhooks` desabilitado
  ou a credencial inválida, a execução é recusada antes de qualquer envio.

Quando `imageUrl` é usada, a imagem é processada/otimizada e armazenada pelo mesmo pipeline de mídia
do Atendimento. A mensagem fica no histórico como `IMAGE` com o texto na legenda, sem depender do
`link preview` da Evolution API.

### Resposta de sucesso

```json
{
  "ok": true,
  "executionId": "0e6a0a1c-...",
  "status": "SUCCESS",
  "externalMessageId": "BAE5...",
  "messageId": "f4a1...",
  "conversationId": "bb02..."
}
```

O sucesso só é retornado depois que a Evolution API confirma o envio. A mensagem é persistida na
conversa do grupo usando as mesmas rotinas do Atendimento, com status `SENT` e eventos realtime.
Quando o evento `messages.upsert` da Evolution chegar depois, a mensagem é reconciliada pelo
`externalMessageId`, sem duplicidade.

### Códigos de erro

| HTTP | Código                          | Situação                                            |
| ---- | ------------------------------- | --------------------------------------------------- |
| 400  | validação / `WEBHOOK_*`         | payload inválido, grupo armazenado inválido         |
| 400  | `WEBHOOK_IMAGE_URL_INVALID`     | `imageUrl` não é HTTPS ou aponta para host privado  |
| 400  | `WEBHOOK_IMAGE_INVALID`         | conteúdo baixado não é uma imagem válida            |
| 413  | `WEBHOOK_IMAGE_TOO_LARGE`       | imagem acima do limite permitido                    |
| 502  | `WEBHOOK_IMAGE_FETCH_FAILED`    | não foi possível baixar a imagem                    |
| 401  | `WEBHOOK_UNAUTHORIZED`          | credencial ausente ou incorreta                     |
| 403  | `MODULE_DISABLED`               | módulo `webhooks` desabilitado para a organização   |
| 404  | `WEBHOOK_INTEGRATION_NOT_FOUND` | integração inexistente ou excluída                  |
| 409  | `WEBHOOK_INTEGRATION_INACTIVE`  | integração desativada                               |
| 409  | `WEBHOOK_INSTANCE_UNAVAILABLE`  | instância inativa/desconectada (ou não pertence)    |
| 429  | `RATE_LIMITED`                  | limite de 60 execuções/min por integração + IP      |
| 502  | `WEBHOOK_PROVIDER_ERROR`        | a Evolution API recusou/falhou o envio              |
| 503  | `WEBHOOK_PROVIDER_UNAVAILABLE`  | Evolution API não configurada/indisponível          |

### Exemplo cURL com imagem

```bash
curl -X POST 'https://crm.exemplo.com/api/integrations/webhooks/0e6a0a1c-1111-2222-3333-444455556666/execute' \
  -H 'Authorization: Bearer whk_SUA_CREDENCIAL' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pedido-123' \
  -d '{
    "message": "Olá! Segue o resumo atualizado.",
    "imageUrl": "https://contribua.exemplo.com/card.png"
  }'
```

### Exemplo cURL somente texto

```bash
curl -X POST 'https://crm.exemplo.com/api/integrations/webhooks/0e6a0a1c-1111-2222-3333-444455556666/execute' \
  -H 'Authorization: Bearer whk_SUA_CREDENCIAL' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pedido-123' \
  -d '{"message":"Olá! Seu pedido foi atualizado."}'
```

Sem `Idempotency-Key`, cada chamada gera um novo envio. Com a chave, uma segunda chamada com o mesmo
valor reutiliza a execução já registrada e não reenvia a mensagem.

## Rate limit e abuso

- Guard global: 120 requisições/min por IP no endpoint de execução.
- Limite por integração + IP: 60 execuções/min.
- Corpo limitado pelo adapter Fastify (1 MB) e `message` limitada a 4096 caracteres.
- O histórico guarda apenas código e mensagem sanitizada; credenciais nunca são logadas.

## Módulo controlável

O catálogo passa a conter `webhooks` (categoria **Integrações**). A migration
`20261018120000_webhook_integrations` insere o registro de forma idempotente. Quando o módulo está
desabilitado para uma organização:

- o item **Integrações → Webhooks** some da navegação;
- as rotas autenticadas retornam `403 MODULE_DISABLED`;
- o endpoint externo também retorna `403 MODULE_DISABLED`, nunca envia mensagem;
- os dados existentes são preservados e voltam a funcionar na reativação.

## Testes

- `test/unit/integrations/webhook-execution.service.spec.ts`
- `test/unit/integrations/webhook-integrations.service.spec.ts`
- `test/integration/webhook-integrations.integration-spec.ts`

Os testes usam uma implementação fake da Evolution API; nenhuma mensagem real é enviada.
