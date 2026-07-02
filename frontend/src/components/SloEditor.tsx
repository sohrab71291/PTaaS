import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SloDefinition, SloMetric, SloType, SLO_METRIC_OPTIONS } from '../types/slo';

interface Props {
  slos: SloDefinition[];
  onChange: (slos: SloDefinition[]) => void;
}

function newSlo(): SloDefinition {
  const opt = SLO_METRIC_OPTIONS[2]; // default p95
  return {
    id: crypto.randomUUID(),
    label:    opt.label,
    metric:   opt.value,
    operator: opt.defaultOp,
    target:   opt.defaultTarget,
    unit:     opt.defaultUnit,
    type:     'slo',
  };
}

const inputCls = 'px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400';
const selectCls = `${inputCls} cursor-pointer`;

export const SloEditor: React.FC<Props> = ({ slos, onChange }) => {
  const add = () => onChange([...slos, newSlo()]);

  const remove = (id: string) => onChange(slos.filter(s => s.id !== id));

  const update = (id: string, patch: Partial<SloDefinition>) => {
    onChange(slos.map(s => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      // When metric changes, auto-update unit, operator, and label
      if (patch.metric) {
        const opt = SLO_METRIC_OPTIONS.find(o => o.value === patch.metric)!;
        next.unit     = opt.defaultUnit;
        next.operator = opt.defaultOp;
        next.label    = opt.label;
        if (!patch.target) next.target = opt.defaultTarget;
      }
      return next;
    }));
  };

  return (
    <div className="space-y-3">
      {slos.length === 0 && (
        <p className="text-sm text-gray-400 italic">No SLOs defined. Add one to track compliance automatically after each run.</p>
      )}

      {slos.map(slo => (
        <div key={slo.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {/* Metric */}
            <select value={slo.metric} onChange={e => update(slo.id, { metric: e.target.value as SloMetric })} className={`${selectCls} flex-1 min-w-0`}>
              {SLO_METRIC_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => remove(slo.id)} className="text-gray-400 hover:text-red-500 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Operator */}
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Condition</p>
              <select value={slo.operator} onChange={e => update(slo.id, { operator: e.target.value as 'lte' | 'gte' })} className={`${selectCls} w-full`}>
                <option value="lte">≤ max</option>
                <option value="gte">≥ min</option>
              </select>
            </div>

            {/* Target */}
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Target</p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={slo.target}
                  min={0}
                  onChange={e => update(slo.id, { target: parseFloat(e.target.value) || 0 })}
                  className={`${inputCls} w-full`}
                />
                <span className="text-xs text-gray-400 shrink-0">{slo.unit}</span>
              </div>
            </div>

            {/* Type */}
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Type</p>
              <select value={slo.type} onChange={e => update(slo.id, { type: e.target.value as SloType })} className={`${selectCls} w-full`}>
                <option value="slo">SLO</option>
                <option value="sla">SLA</option>
              </select>
            </div>
          </div>

          {/* Custom label */}
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Label</p>
            <input
              type="text"
              value={slo.label}
              placeholder="Custom label (optional)"
              onChange={e => update(slo.id, { label: e.target.value })}
              className={`${inputCls} w-full`}
            />
          </div>
        </div>
      ))}

      <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 font-medium mt-1">
        <Plus size={14} /> Add SLO / SLA
      </button>

      {slos.length > 0 && (
        <p className="text-xs text-gray-400">
          <span className="font-medium text-gray-600">SLO</span> = internal objective &nbsp;·&nbsp;
          <span className="font-medium text-gray-600">SLA</span> = business agreement (stricter violation impact)
        </p>
      )}
    </div>
  );
};
