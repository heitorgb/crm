# Mídia no Chat (imagens, áudio e figurinhas)

Envio e recebimento de mídia no Chat, com otimização e persistência em disco.

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

Não-imagens (áudio/vídeo/documento) são armazenadas como recebidas, respeitando `MEDIA_MAX_BYTES`.

### Áudio

- **Receber:** `audioMessage` (notas de voz PTT em OGG/Opus) é armazenado como está e exibido com um
  player próprio dentro do balão, com reproduzir/pausar, posição, tempo e velocidades 1×/1,5×/2×.
  O elemento `<audio>` fornece a reprodução; os controles são responsivos e acessíveis por teclado.
- **Player:** reprodução e barra ficam alinhadas na primeira linha; tempo, velocidade e download
  ficam na segunda. A barra ocupa toda a largura disponível e permite buscar até o fim do áudio.
- **Baixar áudio:** o botão usa o arquivo já carregado pela rota autenticada, preservando o nome
  do anexo, sem uma nova requisição ou conversão.
- **Enviar:** o botão de **microfone grava a voz do operador** no navegador (`MediaRecorder`). Ao
  concluir, o áudio é enviado como **nota de voz** via `sendWhatsAppAudio` (a Evolution converte para
  o formato do WhatsApp por padrão). Durante a gravação há timer e opção de cancelar (descarta).
- MIME com parâmetros (ex.: `audio/ogg; codecs=opus`) é normalizado para definir a extensão.

### Figurinhas

- **Receber:** `stickerMessage` vira `MessageType.STICKER`. O WebP é **preservado sem conversão**
  (mantém transparência e animação) e exibido sem balão, com tamanho reduzido.
- Não é gerado thumbnail para figurinhas.
- Envio de figurinhas não é suportado (apenas recebimento/visualização).

## Armazenamento

Provider padrão **`local`** (disco), atrás de uma abstração `StorageService`:

```text
{STORAGE_LOCAL_DIR}/tenant/{tenantId}/messages/{messageId}/{attachmentId}.jpg
{STORAGE_LOCAL_DIR}/tenant/{tenantId}/messages/{messageId}/{attachmentId}_thumb.jpg
```

`MessageAttachment.storageKey` guarda a chave principal; `metadata` guarda `width`, `height` e
`thumbnailKey`. Não há migration nova (campos já existentes).

### Fotos de perfil

Avatares de usuário usam o mesmo `StorageService`, com chave global por usuário (a pessoa pode
pertencer a vários tenants):

```text
{STORAGE_LOCAL_DIR}/users/{userId}/avatar/{uuid}.jpg
```

`User.avatarStorageKey` guarda a referência e `User.avatarUpdatedAt` versiona a URL. A imagem é
recortada em quadrado (`AVATAR_DIMENSION`, padrão 512 px), reencodada em JPEG e limitada a
`AVATAR_MAX_BYTES` (padrão 5 MB). O acesso é feito por `GET /api/members/:membershipId/avatar`,
autenticado e validado contra o tenant atual; a remoção/substituição apaga o arquivo anterior.

## Variáveis de ambiente

```env
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=./storage
MEDIA_MAX_BYTES=26214400            # 25 MB
MEDIA_IMAGE_MAX_DIMENSION=1600
MEDIA_IMAGE_QUALITY=80
MEDIA_THUMBNAIL_DIMENSION=256
AVATAR_MAX_BYTES=5242880          # 5 MB
AVATAR_DIMENSION=512
```

## Comportamento e limites

- Arquivo bruto acima de `MEDIA_MAX_BYTES`: o **envio** responde `413 MEDIA_TOO_LARGE` com a mensagem
  “Arquivo maior que o permitido.” (exibida no composer); o **recebimento** grava a mensagem com
  `metadata.mediaError = 'too_large'` (sem binário) e a UI mostra “Arquivo maior que o permitido”.
- Falha ao buscar mídia na Evolution: mensagem fica com `metadata.mediaError` (`fetch_failed`) e a UI
  mostra “Mídia indisponível”.
- O tipo real é validado pela decodificação (sharp), não apenas pelo `Content-Type`.
- Chaves de armazenamento são geradas (`uuid`), nunca do nome enviado pelo cliente.

## Evolution (endpoints usados)

- `POST /message/sendMedia/{instance}` — envio (base64).
- `POST /chat/getBase64FromMediaMessage/{instance}` — busca da mídia recebida.

## Envio de foto pela câmera (em massa)

O cabeçalho do atendimento no mobile expõe um botão de câmera. O fluxo usa
`<input type="file" accept="image/*" capture="environment">` (com fallback para a galeria), comprime
a imagem no navegador (canvas, lado maior de 1600 px, JPEG) e mostra a prévia com legenda. Em
seguida o operador seleciona conversas (contatos/grupos) e dispara o batch.

- `POST /api/conversations/bulk-media` (multipart: `file`, `caption?`, `conversationIds` JSON,
  `idempotencyKey`) cria `BulkMediaBatch` + `BulkMediaRecipient` e enfileira `bulk-media.send`.
- A imagem é otimizada/armazenada **uma vez** em `tenant/{tenantId}/bulk-media/{batchId}/...` e
  reutilizada pelos destinatários; o backend revalida com `sharp`.
- O worker envia em sequência com intervalo (`BULK_MEDIA_INTERVAL_MS`, padrão 1,5 s), marca
  `SENT/FAILED` por destinatário e publica os eventos normalmente na conversa.
- `GET /api/conversations/bulk-media/:id` devolve o progresso; `POST .../retry` reenvia apenas as
  falhas. O botão de envio fica desabilitado durante a operação e a chave de idempotência evita
  duplicidade.
- Limites: `BULK_MEDIA_MAX_RECIPIENTS` (100) e `MEDIA_MAX_BYTES`.

## Futuro

- Backends `s3`/`minio` (a interface `StorageService` já prevê).
- Retenção/expurgo de mídia (a rotina de LGPD saiu com o módulo de Compliance).
- Upload de vídeo/documento pela UI (hoje a UI envia imagens e áudio; documentos/vídeos continuam
  recebidos e baixáveis).
