import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Zap, LayoutDashboard, PenSquare,
  BarChart3, Settings, User, Terminal, LogOut, Layers, Calendar, Bell, Activity
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  // Test Authoring is active for /tests/new AND /tests/:id/edit (handled via useLocation below)
  { to: '/tests/new', icon: PenSquare, label: 'Test Authoring', end: false, matchEditRoute: true },
  { to: '/test-suites', icon: Layers, label: 'Test Suites', end: true },
  { to: '/executor', icon: Terminal, label: 'K6 Executor', end: false },
  { to: '/reports', icon: BarChart3, label: 'Reports', end: false },
  { to: '/schedules', icon: Calendar, label: 'Schedules', end: false },
  { to: '/notifications', icon: Bell, label: 'Notifications', end: false },
  { to: '/observability', icon: Activity, label: 'Observability', end: false },
  { to: '/admin', icon: Settings, label: 'Admin', end: false },
];

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  // /tests/:id/edit should highlight "Test Authoring", not "Test Specs"
  const isEditingTestSpec = /^\/tests\/[^/]+\/edit$/.test(pathname);

  return (
    <aside className="w-64 flex-shrink-0 bg-sidebar flex flex-col h-screen fixed left-0 top-0 z-30">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">PerfOps</div>
            <div className="text-slate-400 text-xs">Control Plane</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, end, matchEditRoute }) => {
            // Force-active Test Authoring when on an edit route
            const forceActive = matchEditRoute && isEditingTestSpec;
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    (isActive || forceActive)
                      ? 'bg-brand-500 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
            <User size={14} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-200 truncate">{user?.name ?? '—'}</div>
            <div className="text-xs text-slate-400 truncate">{user?.role ?? ''}</div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
};
