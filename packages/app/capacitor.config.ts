import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ionicupdatepoc.app',
  appName: 'Ionic Update POC',
  webDir: 'www',
  // Live updates serve from the local Fastify server (plain HTTP localhost).
  // iosScheme defaults to capacitor://; web assets come from the bundled www/.
  server: {
    // Allow the iOS WebView to talk to the localhost Fastify server over HTTP.
    cleartext: true,
  },
};

export default config;
