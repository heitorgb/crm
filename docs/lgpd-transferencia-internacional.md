# Transferência Internacional de Dados — OrderUp CRM

> **Rascunho técnico.** A definição contratual/mecanismo final depende de revisão jurídica.

## Contexto

O OrderUp CRM é uma aplicação multi-tenant em que **o tenant é o Controlador** e a OrderUp é a
**Operadora**. Alguns sub-processadores podem tratar dados fora do Brasil, conforme a configuração.

## Sub-processadores que podem tratar dados no exterior

| Componente | Configuração | Onde pode processar | Dados tratados |
| ---------- | ------------ | ------------------- | -------------- |
| Provedor de IA do bot | `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL` | Conforme provedor/região (ex.: provedores globais) | Respostas do Lead, `collectedData`, configuração do perfil |
| Evolution API | `EVOLUTION_API_BASE_URL` | Self-hosted (geralmente no Brasil) ou cloud conforme deploy | Mensagens de WhatsApp, identificadores de contato |
| Storage de mídia | `STORAGE_PROVIDER/ENDPOINT` (MinIO/S3) | Conforme endpoint/região configurada | Metadados e binários de mídia (quando implementado) |
| Infraestrutura de hospedagem | Deploy do cliente | Conforme provedor de nuvem/região | Banco, Redis, logs |

## Mecanismo de transferência

- Preferência por **Cláusulas Contratuais Padrão** aprovadas pela ANPD
  (Resolução CD/ANPD nº 19/2024) nos contratos com sub-processadores.
- Alternativamente, outro mecanismo válido previsto na LGPD (art. 33), como consentimento
  específico destacado ou garantias específicas.
- A OrderUp não habilita tratamento internacional fora de um mecanismo contratual válido; a escolha
  ocorre em contrato (fora do código, nesta etapa).

## Checklist para novo sub-processador internacional

1. Identificar finalidade, categorias de dados e titulares afetados.
2. Mapear país/região de processamento e caminho do dado.
3. Garantir mecanismo de transferência válido (CCP/ANPD ou equivalente).
4. Atualizar este documento e o ROPA (`docs/lgpd-ropa.md`).
5. Avaliar necessidade de RIPD (dados sensíveis, volume, risco).
6. Refletir na Política de Privacidade e no DPA apresentado ao tenant.
7. Registrar a decisão (ADR quando arquitetural; ex.: trocar `AI_PROVIDER`).

## Não implementado nesta etapa

- Bloqueio automático por região/país: **não** implementado. A conformidade é contratual e de
  configuração; o código apenas permite trocar provedor por `AI_PROVIDER`/`AI_BASE_URL`.
