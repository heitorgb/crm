# Resposta a Incidente de Segurança — Runbook

> **Rascunho técnico.** Prazos e critérios de notificação devem ser validados juridicamente.
> Aproveita os logs estruturados (`requestId`, `tenantId`, `userId`) já existentes.

## 1. Identificação

Sinais possíveis:

- alertas de erro 5xx, taxa anormal de 401/403/429 (ver filtro e rate limit);
- acesso a dados entre tenants (violação de isolamento — **crítico**);
- exposição de segredo/credencial em log ou resposta;
- acesso indevido a instância WhatsApp/Evolution;
- alteração não autorizada de configuração/dados.

Fontes: logs estruturados (Pino) com `requestId`, `tenantId`, `userId`; `Activity`; `WebhookEvent`;
tickets; métricas de fila.

## 2. Acionamento interno

1. **Plantão de engenharia** — contenção técnica imediata.
2. **Encarregado (DPO) da OrderUp** — `ORDERUP_DPO_EMAIL` (fallback configurado no sistema).
3. **Responsável do tenant afetado** (quando o incidente envolver dados dele).
4. **Jurídico** — avaliação de notificação à ANPD e aos titulares.

## 3. Prazo interno para avaliação

- **Contenção:** imediata (objetivo < 1h após detecção).
- **Triagem de gravidade:** até **24h**.
- **Decisão sobre notificação à ANPD/titulares:** até **72h**, salvo exigência contratual/legal
  distinta.

## 4. Critério de notificação

Notificar ANPD e titulares quando houver risco ou dano relevante, considerando:

- natureza e categoria dos dados (sensíveis elevam o risco);
- número de titulares afetados;
- possibilidade de reidentificação;
- medidas de mitigação já aplicadas.

Registrar sempre a decisão (notificar ou não) com justificativa.

## 5. Containment técnico (ações rápidas)

- Revogar tokens/segredos comprometidos; rotacionar chaves (`JWT_ACCESS_SECRET`,
  `CREDENTIALS_ENCRYPTION_KEY`, chaves Evolution/IA conforme o caso).
- Bloquear origem/IP no rate limit ou no proxy (quando aplicável).
- Suspender instância/token afetado; desativar integração comprometida.
- Preservar evidências (logs, `WebhookEvent`, `Activity`) antes de qualquer limpeza.

## 6. Modelo de comunicado (rascunho)

```text
Assunto: Comunicação de incidente de segurança envolvendo dados pessoais

Prezado(a) titular / Autoridade Nacional de Proteção de Dados (ANPD),

1. Identificação: [Organização/tenant], Encarregado [nome], contato [e-mail].
2. Descrição do incidente: [o que ocorreu, quando foi detectado].
3. Dados e titulares afetados: [categorias, volume estimado].
4. Riscos: [avaliação objetiva].
5. Medidas adotadas: [contenção, mitigação, correção].
6. Recomendações ao titular: [ações de proteção].
7. Contato para dúvidas: [canal do Encarregado].

Atenciosamente,
[Encarregado]
```

## 7. Registro pós-incidente

- Registrar timeline, causa raiz, impacto, ações e responsáveis.
- Criar ADR se houver decisão arquitetural decorrente.
- Atualizar testes de regressão e, se aplicável, o ROPA/RIPD.
- Guardar o registro para auditoria futura.

## Tooling

Não há SIEM externo nesta etapa. O processo usa logs estruturados e trilhas de auditoria existentes.
