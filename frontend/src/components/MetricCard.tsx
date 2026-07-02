import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  trend?: string;
  status?: 'pass' | 'fail' | 'neutral';
  sublabel?: string;
}

export const MetricCard: React.FC<Props> = ({ label, value, trend, status = 'neutral', sublabel }) => {
  const borderColor =
    status === 'pass' ? 'border-l-green-500' :
    status === 'fail' ? 'border-l-red-500' :
    'border-l-blue-500';

  const trendColor = trend?.startsWith('-') ? 'text-green-600' : trend?.startsWith('+') ? 'text-red-600' : 'text-gray-500';

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm p-5 border-l-4 ${borderColor}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sublabel && <div className="text-xs text-gray-500 mt-0.5">{sublabel}</div>}
      {trend && (
        <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${trendColor}`}>
          {trend.startsWith('-') ? <TrendingDown size={12} /> : trend.startsWith('+') ? <TrendingUp size={12} /> : <Minus size={12} />}
          {trend}
        </div>
      )}
    </div>
  );
};
