import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { useExecution } from '../contexts/ExecutionContext';

// Floating popup shown on every page except /executor while a k6 run is in
// progress, so navigating away from the Executor tab doesn't lose visibility
// into a running execution. Clicking it (or coming back to /executor) shows
// the live run instead of an idle screen, since the execution state lives in
// ExecutionContext above the router and isn't reset by page navigation.
export const ExecutionStatusPopup: React.FC = () => {
  const { status, testName, liveMetrics } = useExecution();
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = status === 'starting' || status === 'running';
  if (!isActive || location.pathname === '/executor') return null;

  return (
    <div
      role="button"
      onClick={() => navigate('/executor')}
      className="fixed bottom-5 right-5 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-shadow overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white">
        {status === 'starting'
          ? <Loader2 size={14} className="animate-spin" />
          : <span className="w-2 h-2 rounded-full bg-white animate-pulse inline-block" />}
        <span className="text-xs font-semibold uppercase tracking-wide">
          {status === 'starting' ? 'Starting Execution' : 'Execution Running'}
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-gray-800 truncate">{testName || 'Ad-hoc Execution'}</p>
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-[10px] text-gray-400 uppercase">VUs</p>
            <p className="text-sm font-bold text-gray-900">{liveMetrics.vus}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">RPS</p>
            <p className="text-sm font-bold text-gray-900">{liveMetrics.rps > 0 ? liveMetrics.rps.toFixed(1) : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">P95</p>
            <p className="text-sm font-bold text-gray-900">{liveMetrics.p95 > 0 ? `${liveMetrics.p95.toFixed(0)}ms` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Errs</p>
            <p className={`text-sm font-bold ${liveMetrics.errorRate > 1 ? 'text-red-600' : 'text-gray-900'}`}>{liveMetrics.errorRate.toFixed(1)}%</p>
          </div>
        </div>
        {liveMetrics.progress > 0 && (
          <div className="mt-3">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${liveMetrics.progress}%` }} />
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600">
          View execution <ArrowRight size={12} />
        </div>
      </div>
    </div>
  );
};
