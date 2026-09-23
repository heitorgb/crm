# Mídia no Chat (imagens)

Envio e recebimento de imagens no Chat, com otimização e persistência em disco.

## Visão geral

- **Recebimento** (inbound): o webhook persiste a mensagem e enfileira `media.process`. O worker
  busca o conteúdo na Evolution (`getBase64FromMediaMessage`), otimiza e grava em disco.
- **Envio** (outbound): `POST /conversations/:id/messages/media` (multipart). O arquivo é otimizado,
  gravado e enviado pela Evolution (`sendMedia`).
- **Visualização/download**: `GET /conversations/:id/messages/:messageId/attachments/:attachmentId`
  (autenticado e isolado por tenant).

## Otimização

Feita com **`sharp`**, antes de gravar:

- Redimensiona até `MEDIA_IMAGE_MAX_DIMENSION` (padrão `1600`) no lado maior, mantendo proporção.
- Reencoda para **JPEG** (`MEDIA_IMAGE_QUALITY`, padrão `80`), achatando transparência sobre branco.
- Gera **thumbnail** (`MEDIA_THUMBNAIL_DIMENSION`, padrão `256`) para previews rápidos.
- Remove metadados (EXIF/GPS).
- **O original não é mantido** — somente a versão otimizada e a miniatura.

Não-imagens (documento/áudio/vídeo) são armazenadas como recebidas, respeitando `MEDIA_MAX_BYTES`.

## Armazenamento

Provider padrão **`local`** (disco), atrás de uma abstração `StorageService`:

```text
{STORAGE_LOCAL_DIR}/tenant/{tenantId}/messages/{messageId}/{attachmentId}.jpg
{STORAGE_LOCAL_DIR}/tenant/{tenantId}/messages/{messageId}/{attachmentId}_thumb.jpg
```

`MessageAttachment.storageKey` guarda a chave principal; `metadata` guarda `width`, `height` e
`thumbnailKey`. Não há migration nova (campos já existentes).

## Variáveis de ambiente

```env
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=./storage
MEDIA_MAX_BYTES=26214400            # 25 MB
MEDIA_IMAGE_MAX_DIMENSION=1600
MEDIA_IMAGE_QUALITY=80
MEDIA_THUMBNAIL_DIMENSION=256
```

## Comportamento e limites

- Arquivo bruto acima de `MEDIA_MAX_BYTES`: envio responde `413 MEDIA_TOO_LARGE`; recebimento grava a
  mensagem com `metadata.mediaError = 'too_large'` (sem binário).
- Falha ao buscar mídia na Evolution: mensagem fica com `metadata.mediaError` (`fetch_failed`) e a UI
  mostra “Imagem indisponível”.
- O tipo real é validado pela decodificação (sharp), não apenas pelo `Content-Type`.
- Chaves de armazenamento são geradas (`uuid`), nunca do nome enviado pelo cliente.

## Evolution (endpoints usados)

- `POST /message/sendMedia/{instance}` — envio (base64).
- `POST /chat/getBase64FromMediaMessage/{instance}` — busca da mídia recebida.

## Futuro

- Backends `s3`/`minio` (a interface `StorageService` já prevê).
- Retenção/expurgo de mídia (a rotina de LGPD saiu com o módulo de Compliance).
- Upload de arquivos não-imagem pela UI (hoje a UI envia imagens; documentos continuam recebidos e
  baixáveis).
