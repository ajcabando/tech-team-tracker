import React from 'react';

/** Recent client-side failures, kept in memory for the Settings diagnostics card. */
export type DiagnosticError = { time: string; kind: string; message: string };

const MAX_ERRORS = 20;
const errors: DiagnosticError[] = [];
const listeners = new Set<() => void>();

export function recordError(kind: string, message: string): void {
  errors.unshift({ time: new Date().toISOString(), kind, message: String(message).slice(0, 500) });
  while (errors.length > MAX_ERRORS) errors.pop();
  for (const listener of listeners) listener();
}

export function recentErrors(): DiagnosticError[] {
  return [...errors];
}

export function onErrorsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Install once at boot: captures uncaught errors and unhandled rejections. */
export function installErrorCollector(): void {
  window.addEventListener('error', (event) => {
    recordError('error', event.message || 'Uncaught error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    recordError('rejection', reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
  });
}
