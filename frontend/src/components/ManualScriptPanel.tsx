import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload, X, FileText, CheckCircle, AlertCircle, RotateCcw,
} from 'lucide-react';
import { StoredFile } from './AIGeneratePanel';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // a hand-written/exported k6 script is never anywhere near this

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop() || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function base64ToText(content: string): string {
  return decodeURIComponent(escape(atob(content)));
}

// The agent writes exactly one file per run to os.tmpdir() — there is no
// companion project structure alongside it, so a script that imports a
// sibling module via a relative path (e.g. '../utils/httpRequests.js') will
// always fail at execution time (see agent/src/k6Runner.ts's validateScript,
// which enforces this same rule server-side). Catching it here means the
// user finds out immediately instead of after a wasted execution attempt.
const RELATIVE_IMPORT_RE = /import\s+(?:[\w*\s{},]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g;

function findRelativeImports(script: string): string[] {
  return [...new Set([...script.matchAll(RELATIVE_IMPORT_RE)].map(m => m[1]))];
}

interface ManualScriptPanelProps {
  onScriptGenerated?: (script: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  embedded?: boolean;
  // Restores a previously-uploaded/pasted script (persisted with the test
  // suite as source: 'manual' in uploadedFiles) so editing a saved suite
  // shows what was last applied here, same pattern as aiFile/harFiles.
  initialFile?: StoredFile | null;
  onFileChange?: (file: StoredFile | null) => void;
}

export const ManualScriptPanel: React.FC<ManualScriptPanelProps> = ({
  onScriptGenerated, disabled, disabledReason, embedded, initialFile, onFileChange,
}) => {
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<StoredFile | null>(initialFile ?? null);
  const [pastedContent, setPastedContent] = useState('');
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const [relativeImports, setRelativeImports] = useState<string[]>([]);

  const relativeImportError = (imports: string[]) =>
    `This script imports local file(s) that can't be provided at execution time: ${imports.join(', ')}. ` +
    `Only single-file k6 scripts are supported — inline these imports into one file, or replace them with a full URL (e.g. https://jslib.k6.io/...).`;

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setError('');
    setApplied(false);
    fileToBase64(f).then(content => {
      const stored: StoredFile = { name: f.name, content, mimeType: f.type || 'application/javascript' };
      setFile(stored);
      onFileChange?.(stored);
      try {
        const imports = findRelativeImports(base64ToText(content));
        setRelativeImports(imports);
        if (imports.length > 0) setError(relativeImportError(imports));
      } catch {
        setRelativeImports([]);
      }
    });
  }, [onFileChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    validator: (f) => {
      const ext = '.' + (f.name.split('.').pop()?.toLowerCase() ?? '');
      if (ext !== '.js') {
        return { code: 'file-invalid-type', message: `Unsupported file type "${ext}". Only .js files are accepted.` };
      }
      if (f.size > MAX_FILE_BYTES) {
        return { code: 'file-too-large', message: `File is ${(f.size / 1024).toFixed(0)} KB — maximum allowed is ${MAX_FILE_BYTES / 1024} KB.` };
      }
      return null;
    },
    maxFiles: 1,
    onDropRejected: (rejections) => setError(rejections[0]?.errors[0]?.message ?? 'File rejected'),
  });

  const removeFile = () => {
    setFile(null);
    setApplied(false);
    setRelativeImports([]);
    setError('');
    onFileChange?.(null);
  };

  const applyFile = () => {
    if (!file || relativeImports.length > 0) return;
    try {
      onScriptGenerated?.(base64ToText(file.content));
      setApplied(true);
    } catch {
      setError('Could not read this file as text.');
    }
  };

  const onPasteChange = (value: string) => {
    setPastedContent(value);
    setApplied(false);
    const imports = findRelativeImports(value);
    setRelativeImports(imports);
    setError(imports.length > 0 ? relativeImportError(imports) : '');
  };

  const applyPaste = () => {
    if (!pastedContent.trim()) { setError('Paste a k6 script first.'); return; }
    if (relativeImports.length > 0) return;
    onScriptGenerated?.(pastedContent);
    setApplied(true);
    setError('');
  };

  const inner = (
    <div className="space-y-4">
      {/* Input mode toggle */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => { setInputMode('file'); setError(''); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
            inputMode === 'file' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Upload .js File
        </button>
        <button
          type="button"
          onClick={() => { setInputMode('paste'); setError(''); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
            inputMode === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Paste Script
        </button>
      </div>

      {disabled && disabledReason && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">{disabledReason}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {inputMode === 'file' ? (
        <div className="space-y-3">
          {!file ? (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              } ${isDragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'}`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <Upload size={22} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    {isDragActive ? 'Drop the .js file here' : 'Drag & drop a k6 script (.js)'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Use an already-written or externally-generated k6 script as-is</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-200 rounded-lg">
              <FileText size={15} className="text-gray-500 flex-shrink-0" />
              <span className="flex-1 text-sm text-gray-800 truncate font-mono">{file.name}</span>
              <button onClick={removeFile} className="p-1 text-gray-400 hover:text-red-500 rounded flex-shrink-0">
                <X size={13} />
              </button>
            </div>
          )}

          {file && (
            <button
              onClick={applyFile}
              disabled={disabled || relativeImports.length > 0}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Upload size={15} /> Use This Script
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={pastedContent}
            onChange={(e) => onPasteChange(e.target.value)}
            disabled={disabled}
            placeholder="Paste your k6 JavaScript here…"
            rows={12}
            className="w-full font-mono text-xs p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={applyPaste}
            disabled={disabled || !pastedContent.trim() || relativeImports.length > 0}
            className="flex items-center gap-2 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FileText size={15} /> Use This Script
          </button>
        </div>
      )}

      {applied && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle size={14} className="flex-shrink-0" />
          Script applied below — edit it in the Script Editor, then Save.
          <button
            onClick={() => setApplied(false)}
            className="ml-auto flex items-center gap-1 text-xs text-green-700/80 hover:text-green-800"
          >
            <RotateCcw size={11} /> Dismiss
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) return inner;
  return <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">{inner}</div>;
};
