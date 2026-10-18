import { Component, type ErrorInfo, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Hamgam render failure', error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main dir="rtl" className="app-shell max-w-xl stack">
          <h1>باز کردن اطلاعات انجام نشد</h1>
          <p>
            اطلاعات را حذف نکنید. همهٔ برگه‌های دیگر همگام را ببندید و دوباره بارگذاری کنید. اگر
            مرورگر در حالت خصوصی است یا فضای دستگاه پر شده، از مرورگر عادی استفاده کنید.
          </p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            تلاش دوباره
          </button>
        </main>
      );
    return this.props.children;
  }
}
