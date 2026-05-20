import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './styles.css';
import './reverie-website.css';

document.body.classList.toggle('native-shell', Capacitor.isNativePlatform());
document.body.classList.toggle('browser-shell', !Capacitor.isNativePlatform());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
