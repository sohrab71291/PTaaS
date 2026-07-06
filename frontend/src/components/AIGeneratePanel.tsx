import React, { useState, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Sparkles, Upload, FileText, X,
  Copy, Send, Loader2, AlertCircle, CheckCircle,
  FileSpreadsheet, File, RotateCcw,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';

interface LoadProfileConfig {
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
}

export interface SpecContext {
  name: string;
  description?: string;
  tags: string[];
  request: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    payload: string | null;
    auth: { type: string; tokenSecret?: string; headerName?: string };
  };
  checks: string[];
  thresholds: Record<string, { condition: string; abortOnFail?: boolean }[]>;
  slos: any[];
}

interface AIGeneratePanelProps {
  onScriptGenerated?: (script: string) => void;
  testType: string;
  complexity: string;
  loadProfile: LoadProfileConfig;
  envVarKeys: string[];
  specContext: SpecContext;
  disabled?: boolean;
  disabledReason?: string;
  embedded?: boolean;
}

export const AIGeneratePanel: React.FC<AIGeneratePanelProps> = ({
  onScriptGenerated, testType, complexity, loadProfile, envVarKeys,
  specContext, disabled, disabledReason, embedded,
}) => {
  const [file, setFile]                       = useState<File | null>(null);
  const [pastedContent, setPastedContent]     = useState('');
  const [inputMode, setInputMode]             = useState<'file' | 'paste'>('file');
  const [status, setStatus]                   = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
  const [statusMessage, setStatusMessage]     = useState('');
  const [streamingScript, setStreamingScript] = useState('');
  const [finalScript, setFinalScript]         = useState('');
  const [error, setError]                     = useState('');
  const [showScript, setShowScript]           = useState(false);
  const [scriptCopied, setScriptCopied]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) { setFile(accepted[0]); setError(''); }
  }, []);

  const ALLOWED_EXTS = ['.csv', '.xls', '.xlsx', '.yaml', '.yml', '.txt'];
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    validator: (file) => {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
      if (!ALLOWED_EXTS.includes(ext)) {
        return {
          code: 'file-invalid-type',
          message: `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}`,
        };
      }
      if (file.size > MAX_FILE_BYTES) {
        return {
          code: 'file-too-large',
          message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum allowed is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
        };
      }
      return null;
    },
    maxFiles: 1,
    maxSize: MAX_FILE_BYTES,
    onDropRejected: (rejections) => {
      const msg = rejections[0]?.errors[0]?.message ?? 'File rejected';
      setError(msg);
    },
  });

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['xls', 'xlsx'].includes(ext ?? '')) return <FileSpreadsheet size={16} className="text-green-400" />;
    if (ext === 'csv') return <FileText size={16} className="text-blue-400" />;
    return <File size={16} className="text-gray-400" />;
  };

  const handleGenerateAI = async () => {
    setStatus('generating');
    setStreamingScript('');
    setFinalScript('');
    setError('');
    setShowScript(true);
    setStatusMessage('Connecting to Claude…');

    abortRef.current = new AbortController();

    const formData = new FormData();
    if (inputMode === 'file' && file) formData.append('file', file);
    if (inputMode === 'paste')        formData.append('pastedContent', pastedContent);
    formData.append('testType',    testType);
    formData.append('complexity',  complexity);
    formData.append('loadProfile', JSON.stringify(loadProfile));
    if (envVarKeys.length) formData.append('envVarKeys', JSON.stringify(envVarKeys));
    formData.append('specContext', JSON.stringify(specContext));

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer      = '';
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
              if (onScriptGenerated) onScriptGenerated(clean);
              sessionStorage.setItem('generatedK6Script', clean);
              sessionStorage.setItem('generatedK6ScriptMeta', JSON.stringify({
                testType, complexity,
                source: file?.name || 'pasted content',
                generatedAt: new Date().toISOString(),
              }));
              const srcLabel = file ? file.name : 'pasted content';
              setStatusMessage('Script generated successfully');
              addToast(`K6 script generated from ${srcLabel}! You can now run it in the Executor.`, 'success');
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

  const handleGenerate = () => {
    if (disabled) { setError(disabledReason || 'Complete the required test configuration fields first'); return; }
    if (inputMode === 'file') {
      if (!file) { setError('Please upload a file first'); return; }
    } else {
      if (!pastedContent.trim()) { setError('Please paste some content first'); return; }
    }
    handleGenerateAI();
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setStatus('idle');
    setStatusMessage('Generation cancelled');
  };

  const handleReset = () => {
    setFile(null);
    setPastedContent('');
    setStreamingScript('');
    setFinalScript('');
    setStatus('idle');
    setStatusMessage('');
    setError('');
    setShowScript(false);
  };

  const canGenerate = inputMode === 'file' ? !!file : !!pastedContent.trim();

  const inner = (
    <div className="space-y-6">

      {/* Step 1 — Input Mode */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">1</span>
            Upload Test Cases
          </span>
        </label>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-4">
          <button
            onClick={() => setInputMode('file')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              inputMode === 'file' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Upload File
          </button>
          <button
            onClick={() => setInputMode('paste')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              inputMode === 'paste' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Paste Content
          </button>
        </div>

        {inputMode === 'file' ? (
          <div>
            {!file ? (
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragActive
                    ? 'border-purple-400 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/30'
                }`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
                    <Upload size={22} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700">
                      {isDragActive ? 'Drop your file here' : 'Drag & drop or click to upload'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Supports CSV, XLS, XLSX, YAML, TXT — up to 50MB
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 mt-1">
                    {ALLOWED_EXTS.map(ext => (
                      <span key={ext} className="text-xs px-2 py-0.5 rounded font-mono bg-gray-100 text-gray-500">
                        {ext}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-50 border-green-200">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-100">
                  {getFileIcon(file.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button onClick={() => setFile(null)} className="p-1.5 text-gray-400 hover:text-red-500 rounded">
                  <X size={14} />
                </button>
              </div>
            )}

            <a
              href="/sample-test-cases.csv"
              download
              className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 mt-2 font-medium"
            >
              <FileText size={12} />
              Download sample CSV template
            </a>
          </div>
        ) : (
          <div>
            <textarea
              value={pastedContent}
              onChange={e => setPastedContent(e.target.value)}
              placeholder={`Paste your test cases here in any format:\n\n• API endpoint list (one per line)\n• CSV data\n• JSON array of test scenarios\n• Swagger/OpenAPI snippet\n• Plain text description of what to test\n• Postman collection JSON\n• Any structured test data\n\nClaude will analyze the content and generate the appropriate K6 script.`}
              rows={10}
              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{pastedContent.length} characters</p>
          </div>
        )}
      </div>

      {/* Mandatory-fields notice */}
      {disabled && disabledReason && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">{disabledReason}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700">Generation Failed</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            {(error.includes('ANTHROPIC_API_KEY') || error.includes('credentials') || error.includes('API key')) && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold text-red-700">Quick Setup:</p>
                <ol className="text-xs text-red-600 list-decimal list-inside space-y-1.5">
                  <li>Get your API key from <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noreferrer" className="underline font-medium">console.anthropic.com</a></li>
                  <li>Open <code className="bg-red-100 px-1 rounded font-mono">PTaaS/backend/.env</code></li>
                  <li>Add: <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono text-red-700">ANTHROPIC_API_KEY=sk-ant-api03-...</code></li>
                  <li>Restart the backend: <code className="bg-red-100 px-1 rounded font-mono">npm run dev:backend</code></li>
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generate button */}
      <div className="flex items-center gap-3">
        {status !== 'generating' ? (
          <button
            onClick={handleGenerate}
            disabled={disabled || !canGenerate}
            className="flex items-center gap-2 px-6 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
          >
            <Sparkles size={16} />
            Generate K6 Script with AI
          </button>
        ) : (
          <button
            onClick={handleAbort}
            className="flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all"
          >
            <X size={16} />
            Cancel Generation
          </button>
        )}

        {statusMessage && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {status === 'generating' && <Loader2 size={14} className="animate-spin text-purple-500" />}
            {status === 'complete' && <CheckCircle size={14} className="text-green-500" />}
            {statusMessage}
          </div>
        )}
      </div>

      {/* Script output */}
      {showScript && (streamingScript || finalScript) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">Generated K6 Script</h3>
              {status === 'generating' && (
                <span className="flex items-center gap-1 text-xs text-purple-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
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
                onClick={() => {
                  navigator.clipboard.writeText(finalScript || streamingScript).then(() => {
                    setScriptCopied(true);
                    setTimeout(() => setScriptCopied(false), 1500);
                  });
                }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300"
              >
                <Copy size={12} /> {scriptCopied ? 'Copied!' : 'Copy'}
              </button>
              {status === 'complete' && (
                <a
                  href="/executor"
                  onClick={() => sessionStorage.setItem('generatedK6Script', finalScript || streamingScript)}
                  className="flex items-center gap-1.5 text-xs text-white bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded font-medium"
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
                <span className="text-gray-400 text-xs font-mono ml-2">
                  {`generated-${testType.toLowerCase().replace(' ', '-')}.k6.js`}
                </span>
              </div>
              {status === 'generating' && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
            <StreamingCodeDisplay code={streamingScript || finalScript} isStreaming={status === 'generating'} />
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {inner}
      </>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-purple-200 shadow-sm overflow-hidden">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">AI-Powered Test Generation</h2>
              <p className="text-purple-200 text-xs">Upload test cases → Claude analyzes → K6 script generated</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-xs px-2 py-1 rounded-full font-medium">
              Powered by Claude
            </span>
            {status !== 'idle' && (
              <button onClick={handleReset} className="text-white/70 hover:text-white p-1 rounded">
                <RotateCcw size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {inner}
      </div>
    </div>
  );
};

export const StreamingCodeDisplay: React.FC<{ code: string; isStreaming: boolean }> = ({ code, isStreaming }) => {
  const ref = useRef<HTMLPreElement>(null);

  React.useEffect(() => {
    if (isStreaming && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [code, isStreaming]);

  const lines = code.split('\n');

  return (
    <pre
      ref={ref}
      className="overflow-auto text-xs leading-relaxed p-4 max-h-96"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: '#cdd6f4' }}
    >
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="select-none w-8 flex-shrink-0 text-right pr-3 text-gray-600 text-xs">{i + 1}</span>
          <span style={{ color: colorizeK6Line(line) }}>{line || ' '}</span>
        </div>
      ))}
      {isStreaming && (
        <div className="flex">
          <span className="select-none w-8 flex-shrink-0" />
          <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5" />
        </div>
      )}
    </pre>
  );
};

export function colorizeK6Line(line: string): string {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*'))                                              return '#6c7086';
  if (t.startsWith('import ') || t.startsWith('export '))                                   return '#cba6f7';
  if (t.startsWith('const ') || t.startsWith('let ') || t.startsWith('var '))               return '#89dceb';
  if (t.startsWith('function ') || t.includes('=>'))                                         return '#89b4fa';
  if (t.startsWith('check(') || t.startsWith('group(') || t.startsWith('sleep('))           return '#a6e3a1';
  if (t.includes('http.get') || t.includes('http.post') || t.includes('http.put') || t.includes('http.del')) return '#fab387';
  if (t.startsWith("'") || t.startsWith('"') || t.startsWith('`'))                          return '#a6e3a1';
  return '#cdd6f4';
}
