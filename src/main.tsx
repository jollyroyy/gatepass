import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './App';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found in index.html');

ReactDOM.createRoot(el).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
