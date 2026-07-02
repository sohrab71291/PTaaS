import React, { useState } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { Copy, Check, Download } from 'lucide-react';

interface Props {
  language: 'json' | 'javascript' | 'yaml' | 'bash';
  code: string;
  filename?: string;
  maxHeight?: string;
}

export const CodePanel: React.FC<Props> = ({ language, code, filename, maxHeight = '600px' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = language === 'javascript' ? 'js' : language;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `script.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700">
      <div className="flex items-center justify-between bg-[#1E1E2E] px-4 py-2 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-mono">{filename || language}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700"
          >
            <Download size={12} />
            Download
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div style={{ maxHeight, overflowY: 'auto' }}>
        <SyntaxHighlighter
          language={language === 'javascript' ? 'javascript' : language}
          style={atomOneDark}
          customStyle={{ margin: 0, borderRadius: 0, background: '#1E1E2E', fontSize: '13px' }}
          showLineNumbers
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
