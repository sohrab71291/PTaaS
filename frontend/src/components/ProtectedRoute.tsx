import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ExecutionProvider } from '../contexts/ExecutionContext';
import { Sidebar } from './Sidebar';
import { ExecutionStatusPopup } from './ExecutionStatusPopup';

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <ExecutionProvider>
      <div className="flex bg-gray-50 min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-64 overflow-auto min-h-screen">
          <Outlet />
        </main>
        <ExecutionStatusPopup />
      </div>
    </ExecutionProvider>
  );
}
