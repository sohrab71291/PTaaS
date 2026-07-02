import React from 'react';
import { Lock } from 'lucide-react';
import { Environment } from '../types';

interface Props {
  value: string;
  onChange: (id: string) => void;
  environments: Environment[];
}

export const EnvironmentSelector: React.FC<Props> = ({ value, onChange, environments }) => {
  return (
    <div className="flex flex-wrap gap-2">
      {environments.map(env => {
        const isSelected = value === env.id;
        return (
          <button
            key={env.id}
            type="button"
            onClick={() => onChange(env.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
              isSelected
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {env.requiresApproval && <Lock size={12} className="text-amber-500" />}
            <span>{env.name}</span>
            {env.requiresApproval && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Approval</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
