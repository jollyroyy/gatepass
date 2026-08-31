import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './App';
import { registerServiceWorker } from './lib/registerServiceWorker';
import { captureInstallPrompt } from './lib/installPrompt';
import './index.css';

// BEFORE render, unlike the worker below. Chrome fires `beforeinstallprompt`
// once, as soon as it decides the page qualifies, and routinely does so before
// React has mounted anything that could listen — an unheard event is an install
// button that never appears. See src/lib/installPrompt.ts.
captureInstallPrompt();

const el = document.getElementById('root');
if (!el) throw new Error('#root not found in index.html');

ReactDOM.createRoot(el).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// Last, and after render: an installed home-screen app needs a worker, and a
// worker that fails to register must never be able to stop the app rendering.
registerServiceWorker();
