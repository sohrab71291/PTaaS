import React, { useState, useCallback, useRef } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import {
  Upload, X, FileText, AlertCircle, CheckCircle,
  Loader2, Send, Copy, ChevronDown, ChevronUp, Globe, RotateCcw,
} from 'lucide-react';
import { StreamingCodeDisplay } from './AIGeneratePanel';

interface ParsedRequest {
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
}

interface HarGenerateResult {
  script: string;
  testCases: ParsedRequest[];
  warnings: string[];
  skipped: number;
  filesProcessed: number;
}

interface LoadProfileConfig {
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
}

const MAX_HAR_FILE_SIZE_MB = 200;

interface HarToScriptPanelProps {
  loadProfile?: LoadProfileConfig;
  onScriptGenerated?: (script: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  embedded?: boolean;
}

export const HarToScriptPanel: React.FC<HarToScriptPanelProps> = ({
  loadProfile,
  onScriptGenerated,
  disabled,
  disabledReason,
  embedded,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingScript, setStreamingScript] = useState('');
  const [finalScript, setFinalScript] = useState('');
  const [result, setResult] = useState<HarGenerateResult | null>(null);
  const [error, setError] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const fresh = accepted.filter(f => !existing.has(f.name));
      return [...prev, ...fresh];
    });
    setResult(null);
    setError('');
    setStatus('idle');
  }, []);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const tooLarge = rejections.find(r => r.errors.some(e => e.code === 'file-too-large'));
    if (tooLarge) {
      setError(`${tooLarge.file.name} is too large (max ${MAX_HAR_FILE_SIZE_MB}MB per file).`);
    } else {
      setError(rejections[0]?.errors[0]?.message || 'File rejected.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'application/json': ['.json', '.har'],
      'application/har+json': ['.har'],
    },
    maxFiles: 20,
    maxSize: MAX_HAR_FILE_SIZE_MB * 1024 * 1024,
  });

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name));
    setResult(null);
    setStatus('idle');
  };

  const handleGenerate = async () => {
    if (disabled) { setError(disabledReason || 'Complete the required fields first'); return; }
    if (files.length === 0) { setError('Add at least one HAR or JSON file.'); return; }

    setStatus('generating');
    setStreamingScript('');
    setFinalScript('');
    setError('');
    setResult(null);
    setStatusMessage('Uploading captured requests…');

    abortRef.current = new AbortController();

    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    if (loadProfile) formData.append('loadProfile', JSON.stringify(loadProfile));

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/har-generate', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

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
              setStatusMessage(event.message);
            } else if (event.type === 'chunk') {
              accumulated += event.text;
              setStreamingScript(accumulated);
            } else if (event.type === 'complete') {
              const clean = event.script || accumulated;
              setFinalScript(clean);
              setStreamingScript(clean);
              setStatus('complete');
              setStatusMessage('Script generated successfully');
              setResult({
                script: clean,
                testCases: event.testCases || [],
                warnings: event.warnings || [],
                skipped: event.skipped || 0,
                filesProcessed: event.filesProcessed || files.length,
              });
              if (onScriptGenerated) onScriptGenerated(clean);
              sessionStorage.setItem('generatedK6Script', clean);
              sessionStorage.setItem('generatedK6ScriptMeta', JSON.stringify({
                source: `${files.length} HAR/JSON file${files.length !== 1 ? 's' : ''}`,
                generatedAt: new Date().toISOString(),
              }));
              // Persist the profile this script was generated/tuned for so the
              // Executor page defaults to it instead of falling back to its own
              // hardcoded default (a much heavier staged ramp) — without this,
              // the Agent would silently override the script's own scenario/VUs
              // with a mismatched, heavier load profile at run time.
              if (loadProfile) {
                sessionStorage.setItem('generatedK6ScriptProfile', JSON.stringify(loadProfile));
              }
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') { setStatus('idle'); setStatusMessage(''); return; }
      setStatus('error');
      setError(err.message);
      setStatusMessage('');
    }
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setStatus('idle');
    setStatusMessage('Generation cancelled');
  };

  const handleReset = () => {
    setFiles([]);
    setStreamingScript('');
    setFinalScript('');
    setResult(null);
    setStatus('idle');
    setStatusMessage('');
    setError('');
  };

  const handleCopy = () => {
    const script = finalScript || streamingScript;
    if (!script) return;
    navigator.clipboard.writeText(script).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 1500);
    });
  };

  const methodColor = (m: string) => {
    switch (m) {
      case 'GET':    return 'text-green-700 bg-green-50 border-green-200';
      case 'POST':   return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'PUT':    return 'text-orange-700 bg-orange-50 border-orange-200';
      case 'PATCH':  return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      case 'DELETE': return 'text-red-700 bg-red-50 border-red-200';
      default:       return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  const inner = (
    <div className="space-y-4">

      {/* Drop zone */}
      <div>
        {files.length === 0 ? (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragActive
                ? 'border-teal-400 bg-teal-50'
                : 'border-gray-200 hover:border-teal-300 hover:bg-teal-50/30'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center">
                <Globe size={22} className="text-teal-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  {isDragActive ? 'Drop HAR / JSON files here' : 'Drag & drop HAR or JSON files'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Claude captures every request, detects the login call, and reuses its session
                  token as a Cookie header on every other call
                </p>
              </div>
              <div className="flex gap-2 mt-1">
                {['.har', '.json'].map(ext => (
                  <span key={ext} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded font-mono">{ext}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map(f => (
              <div key={f.name} className="flex items-center gap-3 p-2.5 bg-teal-50 border border-teal-200 rounded-lg">
                <FileText size={15} className="text-teal-600 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-800 truncate font-mono">{f.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="p-1 text-gray-400 hover:text-red-500 rounded flex-shrink-0">
                  <X size={13} />
                </button>
              </div>
            ))}
            <div
              {...getRootProps()}
              className="flex items-center gap-2 p-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-teal-300 hover:bg-teal-50/20 transition-all"
            >
              <input {...getInputProps()} />
              <Upload size={13} className="text-gray-400" />
              <span className="text-xs text-gray-500">Add more files…</span>
            </div>
          </div>
        )}
      </div>

      {/* Validation warning */}
      {disabled && disabledReason && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">{disabledReason}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Generate button */}
      <div className="flex items-center gap-3">
        {status !== 'generating' ? (
          <button
            onClick={handleGenerate}
            disabled={disabled || files.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Upload size={15} />
            Convert to k6 Script with AI
          </button>
        ) : (
          <button
            onClick={handleAbort}
            className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all"
          >
            <X size={15} />
            Cancel Generation
          </button>
        )}

        {statusMessage && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {status === 'generating' && <Loader2 size={14} className="animate-spin text-teal-600" />}
            {status === 'complete' && <CheckCircle size={14} className="text-green-500" />}
            {statusMessage}
          </div>
        )}
      </div>

      {/* Result summary */}
      {result && status === 'complete' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
            <CheckCircle size={15} className="text-teal-600 flex-shrink-0" />
            <span className="text-sm font-medium text-teal-800">
              {result.testCases.length} API call{result.testCases.length !== 1 ? 's' : ''} captured
              {result.filesProcessed > 1 ? ` from ${result.filesProcessed} files` : ''}
            </span>
            {result.skipped > 0 && (
              <span className="text-xs text-gray-500">
                ({result.skipped} static/tracking entries filtered out)
              </span>
            )}
          </div>

          {result.warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
              <ul className="space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <span className="flex-shrink-0 mt-0.5">•</span>{w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRequests(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700 transition-colors"
            >
              <span>Captured Requests ({result.testCases.length})</span>
              {showRequests ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showRequests && (
              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {result.testCases.map((tc, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded font-mono flex-shrink-0 ${methodColor(tc.method)}`}>
                      {tc.method}
                    </span>
                    <span className="text-xs text-gray-700 font-mono truncate" title={tc.url}>
                      {(() => { try { return new URL(tc.url).pathname; } catch { return tc.url; } })()}
                    </span>
                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{tc.expectedStatus}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Script output */}
      {(streamingScript || finalScript) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">Generated K6 Script</h3>
              {status === 'generating' && (
                <span className="flex items-center gap-1 text-xs text-teal-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                  Streaming…
                </span>
              )}
              {status === 'complete' && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle size={12} />
                  Complete ({(finalScript || streamingScript).split('\n').length} lines)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300"
              >
                <Copy size={12} /> {scriptCopied ? 'Copied!' : 'Copy'}
              </button>
              {status === 'complete' && (
                <a
                  href="/executor"
                  onClick={() => sessionStorage.setItem('generatedK6Script', finalScript || streamingScript)}
                  className="flex items-center gap-1.5 text-xs text-white bg-teal-600 hover:bg-teal-700 px-3 py-1 rounded font-medium"
                >
                  <Send size={12} /> Send to Executor
                </a>
              )}
            </div>
          </div>

          <div className="relative rounded-xl overflow-hidden border border-gray-800" style={{ background: '#1e1e2e' }}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/50" style={{ background: '#181825' }}>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <span className="text-gray-400 text-xs font-mono ml-2">har-import.k6.js</span>
              </div>
              {status === 'generating' && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
            <StreamingCodeDisplay code={streamingScript || finalScript} isStreaming={status === 'generating'} />
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return inner;

  return (
    <div className="bg-white rounded-xl border border-teal-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Globe size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">Import HAR / JSON</h2>
              <p className="text-teal-100 text-xs">Captured session → Claude analyzes → K6 script generated</p>
            </div>
          </div>
          {status !== 'idle' && (
            <button onClick={handleReset} className="text-white/70 hover:text-white p-1 rounded">
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="p-6">{inner}</div>
    </div>
  );
};
