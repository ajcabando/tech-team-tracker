import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { ThemeProvider } from './state/theme';
import { RouterProvider } from './lib/router';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <ThemeProvider>
      <RouterProvider>
        <App />
      </RouterProvider>
    </ThemeProvider>
  </AuthProvider>,
);
