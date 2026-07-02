import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Header } from '../types';

interface Props {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}

export const HeadersTable: React.FC<Props> = ({ headers, onChange }) => {
  const add = () => onChange([...headers, { key: '', value: '' }]);
  const remove = (i: number) => onChange(headers.filter((_, idx) => idx !== i));
  const update = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...headers];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };

  return (
    <div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Key</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Value</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {headers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-center text-gray-400 text-sm">No headers added</td>
              </tr>
            )}
            {headers.map((h, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={h.key}
                    onChange={e => update(i, 'key', e.target.value)}
                    placeholder="Content-Type"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={h.value}
                    onChange={e => update(i, 'value', e.target.value)}
                    placeholder="application/json"
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
        <Plus size={14} /> Add Header
      </button>
    </div>
  );
};
