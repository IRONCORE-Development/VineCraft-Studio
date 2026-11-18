import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      let readable = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) readable = `${parsed.operationType || 'Database'} error: ${parsed.error}`;
      } catch {
        // plain error string
      }
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Application Error</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 break-words">{readable}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 rounded-lg whitespace-nowrap shrink-0"
            >
              Reload Studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
