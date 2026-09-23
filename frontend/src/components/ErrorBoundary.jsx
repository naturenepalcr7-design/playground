'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[KMC-GIS-SERVER Client Error Caught]', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
          <div className="glass-panel-dark max-w-lg w-full p-6 text-center space-y-4 shadow-2xl border border-red-500/30">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            
            <h2 className="text-xl font-bold text-white tracking-tight">
              Temporary Render Notice
            </h2>
            
            <p className="text-xs text-surface-400 leading-relaxed">
              A vector feature dataset contained an unconventional geometry format.
              The application safely isolated the error to protect your active session.
            </p>

            {this.state.error && (
              <div className="p-3 bg-surface-900/80 rounded-lg text-[11px] font-mono text-red-300 text-left overflow-x-auto max-h-32 border border-surface-800">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="btn-primary flex items-center gap-2 text-xs py-2 px-4"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Workspace
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-secondary flex items-center gap-2 text-xs py-2 px-4"
              >
                <Home className="w-4 h-4" />
                Dashboard Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
