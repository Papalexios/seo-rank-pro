
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import App, { SotaErrorBoundary } from './App';

// SOTA FIX: Polyfill the global Buffer object.
// @ts-ignore - This is a polyfill for browser environments.
(window as any).Buffer = Buffer;

// Application's entry point.
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <SotaErrorBoundary>
            <App />
        </SotaErrorBoundary>
    );
}
