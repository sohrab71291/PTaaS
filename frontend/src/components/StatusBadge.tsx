import React from 'react';

type Status = 'pass' | 'fail' | 'running' | 'scheduled' | 'warning' | string;

interface Props {
  status: Status;
  size?: 'sm' | 'md';
}

const styles: Record<string, string> = {
  pass: 'bg-green-100 text-green-800 border border-green-200',
  fail: 'bg-red-100 text-red-800 border border-red-200',
  running: 'bg-blue-100 text-blue-800 border border-blue-200',
  scheduled: 'bg-amber-100 text-amber-800 border border-amber-200',
  warning: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  active: 'bg-green-100 text-green-800 border border-green-200',
  'expiring-soon': 'bg-orange-100 text-orange-800 border border-orange-200',
  expired: 'bg-red-100 text-red-800 border border-red-200',
  error: 'bg-red-100 text-red-800 border border-red-200',
};

export const StatusBadge: React.FC<Props> = ({ status, size = 'sm' }) => {
  const cls = styles[status] || 'bg-gray-100 text-gray-800 border border-gray-200';
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${cls} ${pad}`}>
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {status.toUpperCase()}
    </span>
  );
};
