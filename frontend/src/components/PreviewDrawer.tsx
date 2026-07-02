import React, { useState } from 'react';
import { X, Play } from 'lucide-react';
import { CodePanel } from './CodePanel';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';

interface Props {
  specId: string;
  defaultTab?: 'json' | 'k6';
  onClose: () => void;
  onRun?: () => void;
}

export const PreviewDrawer: React.FC<Props> = ({ specId, defaultTab = 'json', onClose, onRun }) => {
  const [tab, setTab] = useState<'json' | 'k6'>(defaultTab);

  const { data: jsonSpec, loading: jsonLoading } = useFetch(
    () => api.testSpecs.previewJson(specId) as Promise<unknown>,
    [specId]
  );

  const { data: k6Script, loading: k6Loading } = useFetch(
    () => api.testSpecs.previewK6(specId),
    [specId]
  );

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-2xl bg-gray-950 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('json')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === 'json' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              JSON Spec
            </button>
            <button
              onClick={() => setTab('k6')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === 'k6' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              K6 Script
            </button>
          </div>
          <div className="flex items-center gap-2">
            {onRun && (
              <button
                onClick={onRun}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700"
              >
                <Play size={13} /> Run This Test
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'json' && (
            jsonLoading ? (
              <div className="text-gray-400 text-sm p-4">Loading...</div>
            ) : (
              <CodePanel
                language="json"
                code={JSON.stringify(jsonSpec, null, 2)}
                filename="spec.json"
                maxHeight="calc(100vh - 100px)"
              />
            )
          )}
          {tab === 'k6' && (
            k6Loading ? (
              <div className="text-gray-400 text-sm p-4">Generating K6 script...</div>
            ) : (
              <CodePanel
                language="javascript"
                code={k6Script || '// Loading...'}
                filename="test.k6.js"
                maxHeight="calc(100vh - 100px)"
              />
            )
          )}
        </div>
      </div>
    </div>
  );
};
