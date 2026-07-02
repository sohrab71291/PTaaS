import React from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Stage } from '../types';

interface Props {
  stages: Stage[];
  onChange: (stages: Stage[]) => void;
}

export const StagesTable: React.FC<Props> = ({ stages, onChange }) => {
  const add = () => onChange([...stages, { duration: '1m', target: 10 }]);
  const remove = (i: number) => onChange(stages.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Stage, val: string | number) => {
    const next = [...stages];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };

  return (
    <div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-8" />
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Stage</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Duration</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Target VUs</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1.5 text-gray-300 cursor-grab">
                  <GripVertical size={14} />
                </td>
                <td className="px-2 py-1.5 text-gray-500 text-xs">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={s.duration}
                    onChange={e => update(i, 'duration', e.target.value)}
                    placeholder="2m"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    value={s.target}
                    onChange={e => update(i, 'target', parseInt(e.target.value) || 0)}
                    min={0}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600"
      >
        <Plus size={14} /> Add Stage
      </button>
    </div>
  );
};
