import type { CapacitorConfig } from '@capacitor/cli';

const appUrl = process.env.ORDERUP_APP_URL ?? 'https://crm.orderup.com.br';

const config: CapacitorConfig = {
  appId: 'br.com.orderup.crm',
  appName: 'OrderUp CRM',
  webDir: 'www',
  backgroundColor: '#070A12',
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith('http://'),
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      style: 'DARK',
    },
  },
};

export default config;
