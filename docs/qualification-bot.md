# Bot de qualificação — OrderUp CRM

> Status: **Fundação**. Nenhuma parte do fluxo conversacional foi implementada. Este documento
> define responsabilidades e limites desta etapa. O desenho completo está em
> [`mvp-bot-qualificador.md`](./mvp-bot-qualificador.md).

## Papel do bot

O bot é o primeiro atendimento e o principal mecanismo de qualificação de leads:

```text
Lead → WhatsApp → Bot de qualificação
  → perguntas e coleta de contexto
  → qualificação concluída
  → resumo para o responsável humano em lote (digest)
```

## Responsabilidades desta fase

- Expor a configuração de IA necessária ao futuro motor (ver [`ai.md`](./ai.md)).
- Registrar as regras obrigatórias do projeto que o bot deverá respeitar.

## Regras obrigatórias (para as fases seguintes)

1. **Por tenant:** contexto, critérios, dados necessários, tom e regras de conclusão serão dados
   editáveis do tenant — nunca variáveis de ambiente nem estado global.
2. **Sem contexto compartilhado** entre tenants; toda leitura/escrita escopada por `tenantId`.
3. **Derivação de tenant segura:** no webhook (endpoint público) o tenant é resolvido por
   mapeamento de canal/instância + validação de assinatura, nunca por `tenantId` do payload.
4. **Assíncrono:** processamento pesado (IA, envio) usará Redis/BullMQ, com `tenantId` explícito e
   reestabelecimento de contexto (`TenantContextService.run(...)`) no início do job.
5. **Entrega em lote:** leads qualificados viram digest no horário/timezone do usuário/membership.
   Sem notificação individual no fluxo normal.
6. **Handoff antecipado** apenas como exceção: pedido explícito de humano, falha persistente ou
   exceção configurada.

## Limites / não implementado

- Sem WhatsApp, sem Evolution API, sem webhook, sem filas, sem LLM.
- Sem entidades de CRM (Lead, Conversation, Message) nem sessões de qualificação.
- Sem scheduler de digest.
- Nenhuma chamada externa é feita nesta etapa.

## Próximo passo (não implementar agora)

O fluxo depende de auth/membership e das entidades de CRM; a ordem sugerida está em
[`mvp-bot-qualificador.md`](./mvp-bot-qualificador.md) §8.
