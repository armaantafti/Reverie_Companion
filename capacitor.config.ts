import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reveriecompanion.myapp',
  appName: 'Reverie Companion',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      backgroundColor: '#102A43',
      style: 'LIGHT'
    },
    Keyboard: {
      resize: 'body'
    },
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#020817',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_reverie_notification',
      iconColor: '#8CCBFF'
    }
  }
};

export default config;
