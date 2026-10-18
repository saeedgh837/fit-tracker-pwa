import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initializeDB } from './db';
import { registerPwa } from './hooks/usePwa';
import './styles.css';
registerPwa();
const root = createRoot(document.getElementById('root')!);
initializeDB()
  .then(() =>
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    ),
  )
  .catch(() =>
    root.render(
      <main dir="rtl" className="app-shell stack max-w-xl">
        <h1>دسترسی به حافظهٔ مرورگر ممکن نیست</h1>
        <p>
          همگام برای ذخیرهٔ محلی به IndexedDB نیاز دارد. از مرورگر عادی، خارج از حالت خصوصی استفاده
          کنید و فضای دستگاه را بررسی کنید. اطلاعات قبلی را پاک نکنید.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          تلاش دوباره
        </button>
      </main>,
    ),
  );
