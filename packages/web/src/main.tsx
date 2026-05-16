import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <main>
      <h1>Agent Village</h1>
      <p>Harness ready. Product code lands in Phase 1.</p>
    </main>
  </StrictMode>,
);
