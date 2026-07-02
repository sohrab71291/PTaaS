import React from 'react';
import { X, Play, AlertTriangle } from 'lucide-react';
import { TestSpec, Environment } from '../types';

interface Props {
  spec: TestSpec;
  env: Environment | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export const RunConfirmModal: React.FC<Props> = ({ spec, env, onConfirm, onCancel, loading }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Run Test</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <div className="text-sm font-medium text-gray-900 mb-2">{spec.name}</div>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div>Environment: <span className="font-medium">{env?.name || 'Unknown'}</span></div>
            <div>Max VUs: <span className="font-medium">{spec.loadProfile.stages.reduce((max, s) => Math.max(max, s.target), 0)}</span></div>
            <div>Method: <span className="font-medium">{spec.request.method}</span></div>
            <div>Stages: <span className="font-medium">{spec.loadProfile.stages.length}</span></div>
          </div>
        </div>

        {env?.requiresApproval && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-700">
              <strong>Approval Required:</strong> Running tests in PROD environment requires approval from an authorized user.
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {loading ? 'Starting...' : 'Run Now'}
          </button>
        </div>
      </div>
    </div>
  );
};
