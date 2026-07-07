import React, { useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle, Terminal, MessageSquarePlus } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';

interface AgentRefinePanelProps {
  script: string;
  onScriptUpdated: (script: string) => void;
}

// Lets the user ask the AI agent to tweak an already-generated script (from
// either the AI-generate or HAR/JSON import flow) and shows a live console of
// the steps the agent takes while applying the change.
export const AgentRefinePanel: React.FC<AgentRefinePanelProps> = ({ script, onScriptUpdated }) => {
  const [refinePrompt, setRefinePrompt]   = useState('');
  const [isRefining, setIsRefining]       = useState(false);
  const [promptHistory, setPromptHistory] = useState<{ id: string; prompt: string; status: 'acknowledged' | 'applied' | 'error' }[]>([]);
  const [consoleTasks, setConsoleTasks]   = useState<{ id: string; message: string; time: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const { toasts, addToast, removeToast } = useToast();

  const logTask = useCallback((message: string) => {
    setConsoleTasks(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      time: new Date().toLocaleTimeString(),
    }]);
  }, []);

  React.useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [consoleTasks]);

  const handleSubmit = async () => {
    const promptText = refinePrompt.trim();
    if (!promptText || isRefining || !script) return;

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPromptHistory(prev => [...prev, { id: entryId, prompt: promptText, status: 'acknowledged' }]);
    setRefinePrompt('');
    setIsRefining(true);
    logTask(`Received tweak request: "${promptText}"`);

    abortRef.current = new AbortController();
    let updatedScript = '';

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/ai-refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentScript: script, prompt: promptText }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'status') {
              logTask(event.message);
            } else if (event.type === 'chunk') {
              updatedScript += event.text;
            } else if (event.type === 'complete') {
              const clean = event.script || updatedScript;
              onScriptUpdated(clean);
              setPromptHistory(prev => prev.map(p => p.id === entryId ? { ...p, status: 'applied' } : p));
              addToast('Script updated with your requested changes.', 'success');
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        logTask('Tweak request cancelled');
      } else {
        logTask(`Error: ${err.message}`);
        setPromptHistory(prev => prev.map(p => p.id === entryId ? { ...p, status: 'error' } : p));
        addToast(err.message || 'Failed to apply changes', 'error');
      }
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="border-t border-gray-200 p-5 space-y-3 bg-gray-50">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <label className="block text-sm font-semibold text-gray-700">
        <span className="inline-flex items-center gap-1.5">
          <MessageSquarePlus size={15} className="text-purple-600" />
          Ask the Agent for Changes
        </span>
      </label>

      <div className="flex items-start gap-2">
        <textarea
          value={refinePrompt}
          onChange={e => setRefinePrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="e.g. Add a check for response body containing 'success', or increase VUs to 50…"
          rows={2}
          disabled={isRefining}
          className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isRefining || !refinePrompt.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 h-fit"
        >
          {isRefining ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />}
          {isRefining ? 'Working…' : 'Send'}
        </button>
      </div>

      {promptHistory.length > 0 && (
        <div className="space-y-1.5">
          {promptHistory.map(p => (
            <div key={p.id} className="flex items-start gap-2 text-xs">
              {p.status === 'applied' && <CheckCircle size={12} className="text-green-500 flex-shrink-0 mt-0.5" />}
              {p.status === 'acknowledged' && <Loader2 size={12} className="animate-spin text-purple-500 flex-shrink-0 mt-0.5" />}
              {p.status === 'error' && <AlertCircle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />}
              <span className="text-gray-500">
                <span className="font-medium text-gray-700">"{p.prompt}"</span>
                {' — '}
                {p.status === 'applied' && <span className="text-green-600">applied to script</span>}
                {p.status === 'acknowledged' && <span className="text-purple-600">acknowledged, processing…</span>}
                {p.status === 'error' && <span className="text-red-600">failed</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {consoleTasks.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-gray-800" style={{ background: '#1e1e2e' }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50" style={{ background: '#181825' }}>
            <Terminal size={13} className="text-gray-400" />
            <span className="text-gray-400 text-xs font-mono">Agent Console</span>
            {isRefining && (
              <span className="flex items-center gap-1 text-xs text-purple-400 font-medium ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                running…
              </span>
            )}
          </div>
          <div className="p-3 max-h-48 overflow-auto text-xs font-mono space-y-1" style={{ color: '#cdd6f4' }}>
            {consoleTasks.map(t => (
              <div key={t.id} className="flex gap-2">
                <span className="text-gray-500 flex-shrink-0">{t.time}</span>
                <span>{t.message}</span>
              </div>
            ))}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};
