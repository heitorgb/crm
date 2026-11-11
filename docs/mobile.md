# App Android (Capacitor)

O app Android do OrderUp CRM é um container nativo feito com [Capacitor](https://capacitorjs.com/)
que carrega o frontend publicado em `https://crm.orderup.com.br`. O código fica em `mobile/`.

## Decisão

- **Capacitor com `server.url` remoto.** O WebView abre o próprio domínio do CRM. Assim, o login
  por cookie de refresh (`credentials: 'include'`) e o socket.io funcionam como no navegador, e
  cada deploy do frontend chega ao app sem publicar nova versão na Play Store.
- **Sem mudanças no frontend ou no backend nesta fase.**
- Empacotar o build do Vite dentro do APK fica para depois. Isso mudaria a origem para
  `https://localhost`, os cookies passariam a ser de outro site e a autenticação teria de ser
  revista.

## Estrutura

```text
mobile/
  capacitor.config.ts        # appId, URL remota, página de erro, barras do sistema
  www/offline.html           # tela "Sem conexão" (logo embutido, funciona offline)
  www/index.html             # fallback exigido pelo Capacitor (redireciona para offline.html)
  assets/logo.png            # fonte do ícone e do splash
  android/                   # projeto Android gerado (versionado)
```

## Comportamento nativo

| Item | Como funciona |
|---|---|
| Microfone (gravação de áudio no atendimento) | Permissões `RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` no manifest; o Capacitor pede a permissão em tempo de execução. |
| Upload de arquivos | Seletor nativo do Capacitor (`onShowFileChooser`). |
| Botão voltar | `MainActivity` volta no histórico do WebView; na raiz, minimiza o app. |
| Links externos (`wa.me`, `tel:`, `mailto:`, outros domínios) | Abertos fora do app pelo Capacitor (qualquer host diferente de `crm.orderup.com.br`). |
| Sem internet | `server.errorPath` mostra `offline.html`, que tenta de novo pelo botão ou quando a conexão volta. |
| Backup do Android | Desativado (`allowBackup="false"`) para não copiar cookies de sessão. |
| Depuração remota | Desativada (`webContentsDebuggingEnabled: false`). |

## Notificações push (Fase 2)

Mensagens recebidas no WhatsApp geram push no celular, inclusive com o app fechado.

Fluxo:

1. O webhook da Evolution grava uma mensagem `INBOUND` nova (não histórico) e enfileira o job
   `push.message.notify` com `tenantId` e `messageId` (`jobId` por mensagem, sem duplicar).
2. `MessagePushService` reabre o `TenantContext`, ignora conversas arquivadas/excluídas e envia para
   todos os dispositivos de memberships **ativas** do tenant (mesmo público do som/badge da web).
3. `FcmClient` (`src/infrastructure/push/`) chama a API HTTP v1 do FCM assinando a conta de serviço
   com `node:crypto` (sem `firebase-admin`). Tokens `UNREGISTERED`/`SENDER_ID_MISMATCH` são
   removidos; falhas temporárias são apenas logadas (sem retry, para não duplicar notificações).
4. Título: nome do contato (ou `remetente @ grupo`); corpo: prévia de até 120 caracteres ou o tipo de
   mídia. `tag` = id da conversa, então várias mensagens da mesma conversa se substituem.
5. Ao tocar, o app abre `/atendimento/conversas?conversation=<id>` (só caminhos internos são aceitos).

Registro do dispositivo:

- `POST /api/push-devices` `{ token, platform: 'android' }` — vincula o token à membership do
  access token (o `tenantId` nunca vem do cliente). Um token re-registrado passa para a membership
  que entrou por último no aparelho, inclusive na troca de organização.
- `DELETE /api/push-devices` `{ token }` — chamado no logout; só remove dispositivos da própria
  membership.
- O frontend só usa o plugin quando `Capacitor.isPluginAvailable('PushNotifications')`; no navegador
  e em builds antigas do app nada muda.

Com o app aberto, o Android não exibe o push (o som/badge via socket continua cuidando disso).

### Configurar o Firebase

1. No [console do Firebase](https://console.firebase.google.com/), crie um projeto e adicione um app
   Android com o pacote `br.com.orderup.crm`.
2. Baixe o `google-services.json` e coloque em `mobile/android/app/google-services.json`
   (ignorado pelo git). Sem ele o app compila, mas não recebe push.
3. Em **Configurações do projeto → Contas de serviço → Gerar nova chave privada**, baixe o JSON e
   preencha no `.env` do backend:
   - `FCM_PROJECT_ID` ← `project_id`
   - `FCM_CLIENT_EMAIL` ← `client_email`
   - `FCM_PRIVATE_KEY` ← `private_key` (pode manter os `\n` literais)
   As três são obrigatórias juntas; sem nenhuma, o backend sobe e apenas não envia push.
4. Rode a migration (`npm run prisma:deploy`), publique backend e frontend e gere um novo APK
   (`npm run sync` + Run no Android Studio).

## Limitações conhecidas

- **Download de mídias:** downloads feitos com `blob:` + `<a download>` (ex.: salvar áudio ou
  arquivo no atendimento) não são suportados pelo WebView do Android. Visualizar e reproduzir
  funcionam.
- **Ícone:** gerado a partir de `logo-orderup.png` (350 px). Para a Play Store, substitua
  `mobile/assets/logo.png` por uma arte de 1024×1024 e rode `npm run assets`.

## Como executar

Pré-requisitos: Node 22+, Android Studio (SDK 36) e JDK 21 (o JDK que vem com o Android Studio
serve).

```bash
cd mobile
npm install
npm run sync          # copia config e www/ para o projeto Android
npm run open          # abre no Android Studio (Run ▶ em um aparelho ou emulador)
```

APK de teste pela linha de comando (precisa de `ANDROID_HOME` e `JAVA_HOME` configurados):

```bash
cd mobile
npm run build:debug   # gera android/app/build/outputs/apk/debug/app-debug.apk
```

Para testar contra outro ambiente, defina `ORDERUP_APP_URL` antes do `sync`
(ex.: `ORDERUP_APP_URL=https://staging.orderup.com.br npm run sync`). O botão "Tentar novamente"
de `offline.html` aponta sempre para produção.

Depois de mudar `capacitor.config.ts`, `www/` ou plugins, rode `npm run sync` novamente.

## Próximas fases

1. Assinatura de release (keystore fora do repositório), AAB e publicação na Play Store.
