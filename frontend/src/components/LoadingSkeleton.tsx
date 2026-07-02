import React from 'react';

interface Props {
  rows?: number;
  className?: string;
}

export const LoadingSkeleton: React.FC<Props> = ({ rows = 3, className = '' }) => (
  <div className={`animate-pulse ${className}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-3 mb-4">
        <div className="h-4 bg-gray-200 rounded w-1/4" />
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-1/5" />
      </div>
    ))}
  </div>
);

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/4" />
      </div>
    ))}
  </div>
);
