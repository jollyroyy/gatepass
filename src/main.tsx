import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './App';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './index.css';

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
