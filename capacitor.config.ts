import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reverie.companion',
  appName: 'Reverie Companion',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    StatusBar: {
      backgroundColor: '#102A43',
      style: 'LIGHT'
    },
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
