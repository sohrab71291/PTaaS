import React from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { Toast } from '../hooks/useToast';

interface Props {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const icons = {
  success: <CheckCircle size={16} className="text-green-500" />,
  error: <XCircle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-blue-500" />,
};

export const ToastContainer: React.FC<Props> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 min-w-[280px] max-w-sm animate-fade-in"
        >
          {icons[toast.type]}
          <span className="text-sm text-gray-800 flex-1">{toast.message}</span>
          <button onClick={() => onRemove(toast.id)} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
