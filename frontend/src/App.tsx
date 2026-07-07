import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { TestAuthor } from './pages/TestAuthor';
import { TestSpecs } from './pages/TestSpecs';
import { Preview } from './pages/Preview';
import { Environments } from './pages/Environments';
import { Secrets } from './pages/Secrets';
import { Pipelines } from './pages/Pipelines';
import { Reports } from './pages/Reports';
import { ReportView } from './pages/ReportView';
import { Admin } from './pages/Admin';
import { Executor } from './pages/Executor';
import { TestSuites } from './pages/TestSuites';
import { Schedules } from './pages/Schedules';
import { Notifications } from './pages/Notifications';
import { Observability } from './pages/Observability';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tests/new" element={<TestAuthor />} />
            <Route path="/tests/:id/edit" element={<TestAuthor />} />
            <Route path="/tests" element={<TestSpecs />} />
            <Route path="/test-suites" element={<TestSuites />} />
            <Route path="/preview/:specId" element={<Preview />} />
            <Route path="/environments" element={<Environments />} />
            <Route path="/secrets" element={<Secrets />} />
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/executor" element={<Executor />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/report/:id" element={<ReportView />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/observability" element={<Observability />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
