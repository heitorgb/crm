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

## Limitações conhecidas (Fase 1)

- **Notificações:** a aba toca som e mostra badge apenas com o app aberto. Push com o app fechado
  depende da Fase 2 (FCM).
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

1. Push notifications via FCM (`@capacitor/push-notifications`) e registro de tokens por `TenantUser`.
2. Assinatura de release (keystore fora do repositório), AAB e publicação na Play Store.
