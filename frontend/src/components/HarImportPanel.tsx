import React, { useState, useCallback } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import {
  Upload, X, FileText, AlertCircle, CheckCircle,
  Loader2, Send, Copy, ChevronDown, ChevronUp, Globe,
} from 'lucide-react';

interface ParsedRequest {
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
}

interface HarImportResult {
  script: string;
  testCases: ParsedRequest[];
  warnings: string[];
  skipped: number;
  filesProcessed: number;
}

const MAX_HAR_FILE_SIZE_MB = 200;

interface HarImportPanelProps {
  loadProfile?: {
    profileType: 'staged' | 'constant';
    stages?: { target: number; duration: string }[];
    constantVus?: number;
    constantDuration?: string;
  };
  onScriptGenerated?: (script: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export const HarImportPanel: React.FC<HarImportPanelProps> = ({
  loadProfile,
  onScriptGenerated,
  disabled,
  disabledReason,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<HarImportResult | null>(null);
  const [error, setError] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (files.length === 0) { setError('Add at least one HAR or JSON file.'); return; }

    setStatus('processing');
    setError('');
    setResult(null);

    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (loadProfile) form.append('loadProfile', JSON.stringify(loadProfile));

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/upload/har', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setResult(data as HarImportResult);
      setStatus('done');

      if (onScriptGenerated) onScriptGenerated(data.script);
      sessionStorage.setItem('generatedK6Script', data.script);
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  const handleCopy = () => {
    if (!result?.script) return;
    navigator.clipboard.writeText(result.script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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

  return (
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
                  Multiple files supported — all requests combined into one k6 script
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
        {status !== 'processing' ? (
          <button
            onClick={handleGenerate}
            disabled={disabled || files.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Upload size={15} />
            Generate k6 Script from HAR
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={15} className="animate-spin text-teal-600" />
            Parsing requests and generating script…
          </div>
        )}
      </div>

      {/* Result summary */}
      {result && status === 'done' && (
        <div className="space-y-3">

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
            <CheckCircle size={15} className="text-teal-600 flex-shrink-0" />
            <span className="text-sm font-medium text-teal-800">
              {result.testCases.length} API request{result.testCases.length !== 1 ? 's' : ''} extracted
              {result.filesProcessed > 1 ? ` from ${result.filesProcessed} files` : ''}
            </span>
            {result.skipped > 0 && (
              <span className="text-xs text-gray-500">
                ({result.skipped} static/duplicate entries skipped)
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 px-2.5 py-1 border border-gray-300 rounded-md"
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy script'}
              </button>
              <a
                href="/executor"
                onClick={() => sessionStorage.setItem('generatedK6Script', result.script)}
                className="flex items-center gap-1.5 text-xs text-white bg-teal-600 hover:bg-teal-700 px-2.5 py-1 rounded-md font-medium"
              >
                <Send size={12} /> Send to Executor
              </a>
            </div>
          </div>

          {/* Warnings */}
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

          {/* Extracted request list (collapsible) */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRequests(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700 transition-colors"
            >
              <span>Extracted Requests ({result.testCases.length})</span>
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
    </div>
  );
};
