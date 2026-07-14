import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { SloResults } from '../types/slo';
import { Stage } from '../lib/testProfiles';

export type ExecutionStatus = 'idle' | 'starting' | 'running' | 'complete' | 'error' | 'stopped';

export type StageName = 'script_generation' | 'script_execution' | 'postgres' | 'influx' | 'grafana';
export type StageState = 'pending' | 'in_progress' | 'done' | 'error' | 'skipped';
export type StageMap = Record<StageName, StageState>;

const STAGE_ORDER: StageName[] = ['script_generation', 'script_execution', 'postgres', 'influx', 'grafana'];

const idleStages = (): StageMap => ({
  script_generation: 'pending', script_execution: 'pending',
  postgres: 'pending', influx: 'pending', grafana: 'pending',
});

export interface LiveMetrics {
  vus: number;
  rps: number;
  p95: number;
  p50: number;
  errorRate: number;
  progress: number;
  history: Array<{ t: number; p95: number; p50: number; rps: number; vus: number }>;
}

export interface SystemMetrics {
  systemCpuPct: number;
  processCpuPct: number;
  systemMemPct: number;
  processMemPct: number;
  totalMemMB: number;
  freeMemMB: number;
  history: Array<{ t: number; sysCpu: number; procCpu: number; sysMem: number; procMem: number }>;
}

export interface ConsoleLine {
  id: string;
  text: string;
  isStderr?: boolean;
}

export interface SummaryData {
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  errorRate?: number;
}

export interface StartExecutionParams {
  script: string;
  profileType: 'staged' | 'constant';
  stages: Stage[];
  constantVus: number;
  constantDuration: string;
  envVars: Record<string, string>;
  testName: string;
  slos: any[];
  specId?: string | null;
}

interface ExecutionContextValue {
  status: ExecutionStatus;
  executionId: string | null;
  specId: string | null;
  testName: string;
  liveMetrics: LiveMetrics;
  systemMetrics: SystemMetrics;
  consoleLines: ConsoleLine[];
  summary: SummaryData | null;
  k6NotFound: boolean;
  sloResults: SloResults | null;
  stages: StageMap;
  startExecution: (params: StartExecutionParams) => Promise<void>;
  stopExecution: () => Promise<void>;
}

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

const METRIC_HISTORY_LIMIT = 60;

const emptyLiveMetrics: LiveMetrics = { vus: 0, rps: 0, p95: 0, p50: 0, errorRate: 0, progress: 0, history: [] };
const emptySystemMetrics: SystemMetrics = {
  systemCpuPct: 0, processCpuPct: 0, systemMemPct: 0, processMemPct: 0, totalMemMB: 0, freeMemMB: 0, history: [],
};

// Lives above the router's <Outlet/> so an in-progress k6 run (and its WebSocket)
// survives navigating away from the Executor page — the floating popup
// (ExecutionStatusPopup) reads this same state to show progress on other pages.
export function ExecutionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ExecutionStatus>('idle');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [testName, setTestName] = useState('');
  const [stages, setStages] = useState<StageMap>(idleStages());
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>(emptyLiveMetrics);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>(emptySystemMetrics);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [k6NotFound, setK6NotFound] = useState(false);
  const [sloResults, setSloResults] = useState<SloResults | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use a random id rather than an incrementing ref-backed counter: if a stale
  // WebSocket from before a hot-reload (or any other duplicate-mount edge case)
  // keeps writing into this same state, two independent counters starting from
  // a similar baseline would collide and produce React "duplicate key" warnings.
  // A random id can't collide across independent closures.
  const addConsoleLine = useCallback((text: string, isStderr?: boolean) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setConsoleLines(prev => [...prev.slice(-500), { id, text, isStderr }]);
  }, []);

  const extractSummary = useCallback((raw: any) => {
    const dur = raw.metrics?.http_req_duration?.values;
    const failed = raw.metrics?.http_req_failed?.values;
    setSummary({
      p50:       raw.p50  ?? dur?.['p(50)'],
      p90:       raw.p90  ?? dur?.['p(90)'],
      p95:       raw.p95  ?? dur?.['p(95)'],
      p99:       raw.p99  ?? dur?.['p(99)'],
      errorRate: raw.errorRate ?? (failed ? failed.rate * 100 : undefined),
    });
  }, []);

  const handleWsMessage = useCallback((msg: any) => {
    if (msg.type === 'log') {
      addConsoleLine(msg.data.line, msg.data.isStderr);
    } else if (msg.type === 'metric') {
      const d = msg.data;
      setLiveMetrics(prev => {
        const hasLatency = d.p95 !== undefined || d.p50 !== undefined;
        const newHistory = hasLatency
          ? [...prev.history.slice(-(METRIC_HISTORY_LIMIT - 1)), { t: msg.timestamp, p95: d.p95 ?? prev.p95, p50: d.p50 ?? prev.p50, rps: d.rps ?? prev.rps, vus: d.vus ?? prev.vus }]
          : prev.history;
        return {
          vus: d.vus ?? prev.vus, rps: d.rps ?? prev.rps,
          p95: d.p95 ?? prev.p95, p50: d.p50 ?? prev.p50,
          errorRate: d.errorRate ?? prev.errorRate, progress: d.progress ?? prev.progress,
          history: newHistory,
        };
      });
    } else if (msg.type === 'system') {
      const d = msg.data;
      setSystemMetrics(prev => ({
        ...d,
        history: [...prev.history.slice(-(METRIC_HISTORY_LIMIT - 1)),
          { t: msg.timestamp, sysCpu: d.systemCpuPct, procCpu: d.processCpuPct, sysMem: d.systemMemPct, procMem: d.processMemPct }],
      }));
    } else if (msg.type === 'stage') {
      const { stage, status: stageStatus } = msg.data as { stage: StageName; status: StageState };
      setStages(prev => {
        const next = { ...prev, [stage]: stageStatus };
        // Mark every stage before this one as done too, in case an event was missed.
        const idx = STAGE_ORDER.indexOf(stage);
        for (let i = 0; i < idx; i++) {
          if (next[STAGE_ORDER[i]] === 'pending') next[STAGE_ORDER[i]] = 'done';
        }
        return next;
      });
    } else if (msg.type === 'complete') {
      setStatus('complete');
      addConsoleLine(`[PerfOps] Execution complete. Exit code: ${msg.data.exitCode}`);
      if (msg.data.summary) { try { extractSummary(msg.data.summary); } catch {} }
    } else if (msg.type === 'error') {
      setStatus('error');
      addConsoleLine(`[PerfOps] ${msg.data.message}`, true);
      if (msg.data.code === 'K6_NOT_FOUND') setK6NotFound(true);
    }
  }, [addConsoleLine, extractSummary]);

  // Poll the DB for confirmation the execution actually finished (covers cases
  // where the WS closes/drops before the final 'complete' message arrives) and
  // fetch SLO results once it has.
  const startPolling = useCallback((eid: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/executions/${eid}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const exec = await res.json();
        if (exec.status === 'pass' || exec.status === 'fail' || exec.status === 'complete') {
          setStatus('complete');
          addConsoleLine(`[PerfOps] Execution complete (confirmed via DB: ${exec.status}).`);
          if (exec?.sloResults?.results?.length) setSloResults(exec.sloResults);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        } else if (exec.status === 'failed') {
          setStatus('error');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch {}
    }, 4000);
  }, [addConsoleLine]);

  const startExecution = useCallback(async (params: StartExecutionParams) => {
    let script = params.script;
    if (!script.trim()) {
      addConsoleLine('[PerfOps] No script provided. Please select a script source.', true);
      return;
    }

    // Matches any default export form — function, async function, or arrow
    // (`export default async () => {}`, `export default () => {}`, etc).
    // Checking only the function-keyword forms missed arrow-style default
    // exports and appended a second `export default`, which is a SyntaxError.
    const hasDefault = /\bexport\s+default\b/.test(script);
    if (!hasDefault) {
      script = script + "\n\n// Auto-injected by PerfOps\nexport default function() {}";
      addConsoleLine('[PerfOps] ⚠ Auto-injected missing `export default function() {}`.', false);
    }

    setTestName(params.testName);
    setSpecId(params.specId ?? null);
    setStatus('starting');
    setSummary(null);
    setK6NotFound(false);
    setSloResults(null);
    setConsoleLines([]);
    setLiveMetrics(emptyLiveMetrics);
    setSystemMetrics(emptySystemMetrics);
    setStages({ ...idleStages(), script_generation: 'done', script_execution: 'in_progress' });

    try {
      const body = new FormData();
      body.append('script', script);
      body.append('profileType', params.profileType);
      if (params.profileType === 'staged') {
        body.append('stages', JSON.stringify(params.stages));
      } else {
        body.append('vus', String(params.constantVus));
        body.append('duration', params.constantDuration);
      }
      if (Object.keys(params.envVars).length > 0) {
        body.append('envVars', JSON.stringify(params.envVars));
      }
      if (params.testName.trim()) body.append('testName', params.testName.trim());
      if (params.slos.length)     body.append('slos', JSON.stringify(params.slos));

      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/executor/run', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start execution');

      setExecutionId(data.executionId);
      startPolling(data.executionId);

      // Close out any previous connection first — otherwise its onmessage
      // closure (bound to whatever state existed at the time) can keep
      // delivering messages alongside the new socket's, double-writing into
      // shared state like consoleLines.
      if (wsRef.current) {
        wsRef.current.onopen = null; wsRef.current.onmessage = null;
        wsRef.current.onerror = null; wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const wsUrl = import.meta.env.DEV
        ? `ws://localhost:3001/ws/executor/${data.executionId}`
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/executor/${data.executionId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const statusRef = { current: 'starting' as ExecutionStatus };

      ws.onopen = () => { statusRef.current = 'running'; setStatus('running'); };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleWsMessage(msg);
          if (msg.type === 'complete') statusRef.current = 'complete';
          if (msg.type === 'error')    statusRef.current = 'error';
        } catch {}
      };
      ws.onerror = () => { statusRef.current = 'error'; setStatus('error'); addConsoleLine('[PerfOps] WebSocket connection error', true); };
      ws.onclose = () => {
        if (statusRef.current === 'starting') { setStatus('error'); addConsoleLine('[PerfOps] Connection to backend failed. Is the server running?', true); }
        else if (statusRef.current === 'running') { setStatus('stopped'); addConsoleLine('[PerfOps] Connection closed.'); }
      };
    } catch (e: any) {
      setStatus('error');
      addConsoleLine(`[PerfOps] Error: ${e.message}`, true);
    }
  }, [addConsoleLine, handleWsMessage, startPolling]);

  const stopExecution = useCallback(async () => {
    // Sending on a socket that isn't OPEN (CONNECTING/CLOSING/CLOSED) throws
    // synchronously — that exception was previously aborting the rest of this
    // function (including the REST stop call below), making Stop a no-op.
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'stop' }));
      }
    } catch (e: any) {
      console.error('[PerfOps] Failed to send stop over WebSocket:', e);
    }

    if (executionId) {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/executor/stop/${executionId}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || data.stopped === false) {
          addConsoleLine('[PerfOps] ⚠ Stop request sent, but the agent may not have received it (it may be offline).', true);
        }
      } catch (e: any) {
        addConsoleLine(`[PerfOps] Failed to send stop request: ${e.message}`, true);
      }
    }

    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setStatus('stopped');
    addConsoleLine('[PerfOps] Execution stopped by user');
  }, [executionId, addConsoleLine]);

  return (
    <ExecutionContext.Provider value={{
      status, executionId, specId, testName, liveMetrics, systemMetrics, consoleLines, summary, k6NotFound, sloResults, stages,
      startExecution, stopExecution,
    }}>
      {children}
    </ExecutionContext.Provider>
  );
}

export function useExecution(): ExecutionContextValue {
  const ctx = useContext(ExecutionContext);
  if (!ctx) throw new Error('useExecution must be used inside ExecutionProvider');
  return ctx;
}
