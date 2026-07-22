import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import {
  ChevronDown, ChevronUp, Save, Eye, Calendar,
  GitBranch, Plus, Trash2,
  Code2, Copy, RotateCcw, Send, Loader2, Sparkles, Globe,
  AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { TestSpec, Header } from '../types';
import { TagInput } from '../components/TagInput';
import { HeadersTable } from '../components/HeadersTable';
import { RunConfirmModal } from '../components/RunConfirmModal';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';
import { useFetch } from '../hooks/useFetch';
import { PreviewDrawer } from '../components/PreviewDrawer';
import { AIGeneratePanel, StoredFile } from '../components/AIGeneratePanel';
import { AgentRefinePanel } from '../components/AgentRefinePanel';
import { HarToScriptPanel } from '../components/HarToScriptPanel';
import { SloEditor } from '../components/SloEditor';
import {
  TestType, Complexity, TestTypeProfile, TEST_TYPE_PROFILES,
  Stage, EnvVar, TEST_TYPE_TO_AI_LABEL, COMPLEXITY_TO_AI_LABEL,
} from '../lib/testProfiles';
import { ScriptSpecSnapshot, buildScriptSpecSnapshot, computeSpecDiff } from '../lib/specDiff';

interface StoredFileWithSource extends StoredFile { source: 'ai' | 'har'; }

const DEFAULT_SPEC: Omit<TestSpec, 'id' | 'createdAt' | 'updatedAt' | 'lastRunStatus' | 'lastRunAt'> = {
  name: '',
  description: '',
  tags: [],
  request: {
    url: 'https://api.example.com/endpoint',
    method: 'GET',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    payload: null,
    auth: { type: 'none' },
  },
  loadProfile: {
    type: 'staged',
    stages: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 50 },
      { duration: '1m', target: 0 },
    ],
    thinkTime: 1,
  },
  thresholds: {
    http_req_duration: [{ condition: 'p(95)<500', abortOnFail: false }],
    http_req_failed: [{ condition: 'rate<0.01', abortOnFail: false }],
  },
  checks: ['status is 200', 'response time < 500ms'],
  environmentId: 'env-qa',
} as any;

interface AccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}

const Accordion: React.FC<AccordionProps> = ({ title, children, defaultOpen = false, badge }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 rounded-lg"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">{title}</span>
          {badge && (
            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{badge}</span>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-6 pb-6 border-t border-gray-100 pt-4">{children}</div>}
    </div>
  );
};

const formLabel = "block text-sm font-medium text-gray-700 mb-1.5";
const formInput = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent";

export const TestAuthor: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [spec, setSpec] = useState<typeof DEFAULT_SPEC>(DEFAULT_SPEC);
  const [saving, setSaving] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Section F tab: AI-generate-from-config vs. convert-from-HAR/JSON
  const [genTab, setGenTab] = useState<'ai' | 'har'>('ai');
  const [previewTab, setPreviewTab] = useState<'json' | 'k6'>('json');
  const [savedId, setSavedId] = useState<string | null>(id || null);
  const { toasts, addToast, removeToast } = useToast();

  // Track the generated script (from AI panel or file import) to persist with the suite
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  // Whether the user has manually edited the script after it was generated
  const [scriptEdited, setScriptEdited] = useState(false);
  // Snapshot of the last AI/import-generated version — used for the Reset button
  const [scriptSnapshot, setScriptSnapshot] = useState<string | null>(null);
  // Copy feedback
  const [scriptCopied, setScriptCopied] = useState(false);

  // Test execution settings — must be completed before AI script generation can start
  const [testType, setTestType] = useState<TestType | null>(null);
  const [complexity, setComplexity] = useState<Complexity>('medium');
  const [profileType, setProfileType] = useState<'staged' | 'constant'>('staged');
  const [stages, setStages] = useState<Stage[]>([
    { target: 10, duration: '2m' },
    { target: 50, duration: '5m' },
    { target: 0,  duration: '1m' },
  ]);
  const [constantVus, setConstantVus] = useState(10);
  const [constantDuration, setConstantDuration] = useState('1m');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Login credentials CSV — uploaded here so it can gate script generation;
  // cached in Postgres by the backend and picked up by the Executor at run
  // time via credentialBatchId (see stashForExecutor/storeExecutionSettings).
  const [credentialBatchId, setCredentialBatchId] = useState<string | null>(null);
  const [credentialFileName, setCredentialFileName] = useState<string | null>(null);
  const [credentialCount, setCredentialCount] = useState(0);
  const [credentialUploading, setCredentialUploading] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  useEffect(() => {
    const bid = sessionStorage.getItem('generatedK6ScriptCredentialBatchId');
    const fn = sessionStorage.getItem('generatedK6ScriptCredentialFileName');
    const cnt = sessionStorage.getItem('generatedK6ScriptCredentialCount');
    if (bid) setCredentialBatchId(bid);
    if (fn) setCredentialFileName(fn);
    if (cnt) setCredentialCount(parseInt(cnt, 10) || 0);
  }, []);

  const onDropCredentials = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setCredentialError(null);
    setCredentialUploading(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/executor/credentials', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload credentials CSV');
      setCredentialBatchId(data.batchId);
      setCredentialFileName(f.name);
      setCredentialCount(data.count);
      sessionStorage.setItem('generatedK6ScriptCredentialBatchId', data.batchId);
      sessionStorage.setItem('generatedK6ScriptCredentialFileName', f.name);
      sessionStorage.setItem('generatedK6ScriptCredentialCount', String(data.count));
    } catch (e: any) {
      setCredentialError(e.message || 'Failed to upload credentials CSV');
      setCredentialBatchId(null);
      setCredentialFileName(null);
      setCredentialCount(0);
    } finally {
      setCredentialUploading(false);
    }
  }, []);

  const { getRootProps: getCredRootProps, getInputProps: getCredInputProps, isDragActive: isCredDragActive } = useDropzone({
    onDrop: onDropCredentials,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    multiple: false,
  });

  const clearCredentials = () => {
    setCredentialBatchId(null);
    setCredentialFileName(null);
    setCredentialCount(0);
    setCredentialError(null);
    sessionStorage.removeItem('generatedK6ScriptCredentialBatchId');
    sessionStorage.removeItem('generatedK6ScriptCredentialFileName');
    sessionStorage.removeItem('generatedK6ScriptCredentialCount');
  };

  // Source files that generatedScript was produced from (test-case file for
  // the AI-generate tab, HAR/JSON captures for the import tab) — persisted
  // with the suite so re-opening it for edits doesn't force a re-upload
  // before "Generate" works again.
  const [aiFile, setAiFile] = useState<StoredFile | null>(null);
  const [harFiles, setHarFiles] = useState<StoredFile[]>([]);

  // Snapshot of the spec fields that affect the script, taken whenever the
  // script is (re)generated or loaded — diffed against current form state to
  // detect suite edits that haven't been reflected in the script yet.
  const [scriptSpecSnapshot, setScriptSpecSnapshot] = useState<ScriptSpecSnapshot | null>(null);
  const [syncingScript, setSyncingScript] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  // Tracks whether anything has changed since the last successful save —
  // drives the "save before running?" prompt when sending to the Executor.
  const [dirty, setDirty] = useState(false);
  const skipDirtyCheck = useRef(true); // true on initial mount and right after loading an existing spec
  useEffect(() => {
    if (skipDirtyCheck.current) { skipDirtyCheck.current = false; return; }
    setDirty(true);
  }, [spec, generatedScript, testType, complexity, profileType, stages, constantVus, constantDuration, envVars]);

  const [showSendToExecutorModal, setShowSendToExecutorModal] = useState(false);
  const [sendToExecutorLoading, setSendToExecutorLoading] = useState(false);

  const { data: environments } = useFetch(() => api.environments.list() as Promise<any[]>);

  const handleTestTypeSelect = (type: TestType) => {
    const profile = TEST_TYPE_PROFILES[type];
    setTestType(type);
    setProfileType(profile.profileType);
    if (profile.stages)           setStages(profile.stages);
    if (profile.constantVus)      setConstantVus(profile.constantVus);
    if (profile.constantDuration) setConstantDuration(profile.constantDuration);
  };

  const addStage    = () => setStages(prev => [...prev, { target: 10, duration: '1m' }]);
  const removeStage = (i: number) => setStages(prev => prev.filter((_, idx) => idx !== i));
  const updateStage  = (i: number, field: keyof Stage, val: string | number) =>
    setStages(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const addEnvVar    = () => setEnvVars(prev => [...prev, { key: '', value: '' }]);
  const removeEnvVar = (i: number) => setEnvVars(prev => prev.filter((_, idx) => idx !== i));
  const updateEnvVar = (i: number, field: 'key' | 'value', val: string) =>
    setEnvVars(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  // Mandatory before generation can start — covers every section above the AI
  // panel (A: name, B: test type/load profile, C: request URL, D: at least one
  // check and one threshold). E (SLO/SLA) is intentionally optional.
  const generationBlockedReason = (): string | null => {
    if (!spec.name.trim()) return 'Enter a Test Name (section A) before generating a script.';
    if (!testType) return 'Select a Test Type (section B) before generating a script.';
    if (profileType === 'staged') {
      if (stages.length === 0) return 'Add at least one Load Profile stage (section B) before generating a script.';
      if (stages.some(s => !s.duration.trim())) return 'Every Load Profile stage needs a duration (section B) before generating a script.';
    } else {
      if (!constantVus || constantVus < 1) return 'Set a valid VUs count (section B) before generating a script.';
      if (!constantDuration.trim()) return 'Set a Duration (section B) before generating a script.';
    }
    if (!spec.request.url.trim()) return 'Enter a Request URL (section C) before generating a script.';
    if (spec.checks.filter((c: string) => c.trim()).length === 0) return 'Add at least one Check (section D) before generating a script.';
    if (Object.keys(spec.thresholds).length === 0) return 'Add at least one Threshold (section D) before generating a script.';
    if (!credentialBatchId) return 'Upload a Login Credentials CSV before generating a script.';
    return null;
  };
  const blockedReason = generationBlockedReason();

  // Builds the current spec snapshot used to detect drift from the last
  // generated/loaded script (see scriptSpecSnapshot above).
  const currentSnapshot = useCallback((): ScriptSpecSnapshot => buildScriptSpecSnapshot({
    name: spec.name,
    request: spec.request,
    checks: spec.checks,
    thresholds: spec.thresholds,
    profileType, stages, constantVus, constantDuration,
    envVars,
    slos: (spec as any).slos ?? [],
    testType,
    complexity,
  }), [spec, profileType, stages, constantVus, constantDuration, envVars, testType, complexity]);

  // Non-empty only once a script exists and the suite has since drifted from
  // the snapshot it was generated/loaded against.
  const specDiffSinceScript = generatedScript && scriptSpecSnapshot
    ? computeSpecDiff(scriptSpecSnapshot, currentSnapshot())
    : [];

  const handleSyncScript = async () => {
    if (!generatedScript || specDiffSinceScript.length === 0 || syncingScript) return;
    setSyncingScript(true);
    setSyncError(null);
    syncAbortRef.current = new AbortController();

    const prompt =
      `Apply ONLY the following test-suite configuration changes to this k6 script, preserving everything else (structure, comments, unrelated logic) exactly as-is:\n` +
      specDiffSinceScript.map(d => `- ${d}`).join('\n');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/ai-refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentScript: generatedScript, prompt }),
        signal: syncAbortRef.current.signal,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'chunk') {
              accumulated += event.text;
            } else if (event.type === 'complete') {
              const clean = event.script || accumulated;
              setGeneratedScript(clean);
              setScriptSnapshot(clean);
              setScriptEdited(false);
              sessionStorage.setItem('generatedK6Script', clean);
              setScriptSpecSnapshot(currentSnapshot());
              addToast('Script updated to match the test suite changes.', 'success');
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setSyncError(e.message || 'Failed to sync script with suite changes');
      addToast(e.message || 'Failed to sync script with suite changes', 'error');
    } finally {
      setSyncingScript(false);
    }
  };

  // Section A/C/D/E context — sent alongside B's testType/complexity/loadProfile
  // to /api/ai-generate so the generated script reflects the entire spec.
  const specContext = {
    name: spec.name,
    description: spec.description,
    tags: spec.tags,
    request: spec.request,
    checks: spec.checks,
    thresholds: spec.thresholds,
    slos: (spec as any).slos ?? [],
  };

  // Stashes the current script + settings into sessionStorage for the K6 Executor
  // to pick up. specIdOverride lets callers pass a just-saved id before the
  // `savedId` state update has re-rendered (avoids a stale-closure read).
  const stashForExecutor = (specIdOverride?: string | null) => {
    if (!generatedScript) return;
    sessionStorage.setItem('generatedK6Script', generatedScript);
    if (spec.name.trim()) sessionStorage.setItem('generatedK6ScriptName', spec.name.trim());
    const specId = specIdOverride ?? savedId;
    if (specId) sessionStorage.setItem('generatedK6ScriptSpecId', specId);
    else sessionStorage.removeItem('generatedK6ScriptSpecId');
    const specSlos = (spec as any).slos ?? [];
    if (specSlos.length) sessionStorage.setItem('generatedK6ScriptSlos', JSON.stringify(specSlos));
    else sessionStorage.removeItem('generatedK6ScriptSlos');
    storeExecutionSettings();
  };

  // "Send to Executor" entry point — if the suite has unsaved changes, ask the
  // user whether to save first before opening the Executor.
  const handleSendToExecutorClick = () => {
    if (dirty || !savedId) { setShowSendToExecutorModal(true); return; }
    stashForExecutor();
    navigate('/executor');
  };

  const confirmSendToExecutor = async (shouldSave: boolean) => {
    setSendToExecutorLoading(true);
    try {
      let specIdForStash: string | null = savedId;
      if (shouldSave) {
        const result = await handleSave({ silent: true });
        if (!result) return; // save failed — keep modal open, error toast already shown
        specIdForStash = result.id;
      }
      stashForExecutor(specIdForStash);
      setShowSendToExecutorModal(false);
      navigate('/executor');
    } finally {
      setSendToExecutorLoading(false);
    }
  };

  const storeExecutionSettings = () => {
    sessionStorage.setItem('generatedK6ScriptProfile', JSON.stringify({
      profileType, stages, constantVus, constantDuration,
    }));
    const envObj: Record<string, string> = {};
    envVars.filter(e => e.key.trim()).forEach(e => { envObj[e.key] = e.value; });
    if (Object.keys(envObj).length) sessionStorage.setItem('generatedK6ScriptEnvVars', JSON.stringify(envObj));
    else sessionStorage.removeItem('generatedK6ScriptEnvVars');
    if (credentialBatchId) sessionStorage.setItem('generatedK6ScriptCredentialBatchId', credentialBatchId);
    else sessionStorage.removeItem('generatedK6ScriptCredentialBatchId');
  };

  // Shared completion handler for both Section F generators (AI-from-config and
  // HAR/JSON import) — either one populates the same Script Editor (section G).
  const handleScriptGenerated = (script: string) => {
    sessionStorage.setItem('generatedK6Script', script);
    if (spec.name.trim()) sessionStorage.setItem('generatedK6ScriptName', spec.name.trim());
    if (savedId) sessionStorage.setItem('generatedK6ScriptSpecId', savedId);
    else sessionStorage.removeItem('generatedK6ScriptSpecId');
    const specSlos = (spec as any).slos ?? [];
    if (specSlos.length) sessionStorage.setItem('generatedK6ScriptSlos', JSON.stringify(specSlos));
    else sessionStorage.removeItem('generatedK6ScriptSlos');
    storeExecutionSettings();
    setGeneratedScript(script);
    setScriptSnapshot(script);
    setScriptEdited(false);
    setScriptSpecSnapshot(currentSnapshot());
  };

  // Load existing spec if editing
  useEffect(() => {
    if (id) {
      api.testSpecs.get(id).then((s: any) => {
        const {
          id: _id, createdAt: _c, updatedAt: _u, lastRunStatus: _ls, lastRunAt: _la,
          generatedScript: gs, testType: tt, complexity: cx, envVars: ev, uploadedFiles: uf, ...rest
        } = s;
        setSpec(rest);
        setSavedId(id);
        if (tt) setTestType(tt);
        if (cx) setComplexity(cx);
        const loadedEnvVars = (Array.isArray(ev) && ev.length) ? ev : [];
        if (loadedEnvVars.length) setEnvVars(loadedEnvVars);
        const lp = rest.loadProfile;
        let loadedProfileType: 'staged' | 'constant' = 'staged';
        let loadedStages = stages;
        let loadedConstantVus = constantVus;
        let loadedConstantDuration = constantDuration;
        if (lp?.type === 'constant') {
          loadedProfileType = 'constant';
          loadedConstantVus = lp.constantVus || constantVus;
          loadedConstantDuration = lp.constantDuration || constantDuration;
          setProfileType('constant');
          if (lp.constantVus) setConstantVus(lp.constantVus);
          if (lp.constantDuration) setConstantDuration(lp.constantDuration);
        } else if (Array.isArray(lp?.stages) && lp.stages.length) {
          loadedProfileType = 'staged';
          loadedStages = lp.stages;
          setProfileType('staged');
          setStages(lp.stages);
        }
        if (gs) {
          setGeneratedScript(gs);
          setScriptSnapshot(gs);
          setScriptEdited(false);
          sessionStorage.setItem('generatedK6Script', gs);
          // Baseline the diff-detection snapshot against exactly what's on
          // disk (not React state, which hasn't flushed these setters yet).
          setScriptSpecSnapshot(buildScriptSpecSnapshot({
            name: rest.name,
            request: rest.request,
            checks: rest.checks,
            thresholds: rest.thresholds,
            profileType: loadedProfileType,
            stages: loadedStages,
            constantVus: loadedConstantVus,
            constantDuration: loadedConstantDuration,
            envVars: loadedEnvVars,
            slos: rest.slos ?? [],
            testType: tt ?? null,
            complexity: cx ?? 'medium',
          }));
        }
        if (Array.isArray(uf)) {
          const ai = uf.find((f: StoredFileWithSource) => f.source === 'ai');
          setAiFile(ai ? { name: ai.name, content: ai.content, mimeType: ai.mimeType } : null);
          setHarFiles(uf.filter((f: StoredFileWithSource) => f.source === 'har').map((f: StoredFileWithSource) => ({ name: f.name, content: f.content, mimeType: f.mimeType })));
        }
        skipDirtyCheck.current = true;
        setDirty(false);
      }).catch(e => addToast(e.message, 'error'));
    }
  }, [id]);

  const setField = (path: string, value: unknown) => {
    setSpec(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let cur: any = next;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  // Section B's load-profile controls (testType/profileType/stages/constantVus/
  // constantDuration) live in local state, separate from spec.loadProfile — this
  // reconciles them into the shape persisted with the suite.
  const buildLoadProfile = () => ({
    type: profileType,
    thinkTime: spec.loadProfile?.thinkTime ?? 1,
    stages: profileType === 'staged' ? stages : [],
    ...(profileType === 'constant' ? { constantVus, constantDuration } : {}),
  });

  const handleSave = async (opts?: { silent?: boolean }): Promise<any | null> => {
    if (!spec.name.trim()) { addToast('Name is required', 'error'); return null; }
    setSaving(true);
    try {
      const uploadedFiles: StoredFileWithSource[] = [
        ...(aiFile ? [{ ...aiFile, source: 'ai' as const }] : []),
        ...harFiles.map(f => ({ ...f, source: 'har' as const })),
      ];
      const payload = {
        ...spec,
        loadProfile: buildLoadProfile(),
        testType,
        complexity,
        envVars: envVars.filter(e => e.key.trim()),
        generatedScript: generatedScript ?? null,
        uploadedFiles,
      };
      let result: any;
      if (isEdit && savedId) {
        result = await api.testSpecs.update(savedId, payload);
        if (!opts?.silent) addToast('Test suite updated! View it in Test Suites.', 'success');
      } else {
        // POST does upsert-by-name: same name → update existing suite, new name → create
        result = await api.testSpecs.create(payload);
        setSavedId(result.id);
        const isUpdate = result.updatedAt !== result.createdAt;
        if (!opts?.silent) addToast(
          isUpdate ? 'Test suite updated! View it in Test Suites.' : 'Test suite saved! View it in Test Suites.',
          'success'
        );
        navigate(`/tests/${result.id}/edit`, { replace: true });
      }
      skipDirtyCheck.current = true;
      setDirty(false);
      return result;
    } catch (e: any) {
      addToast(e.message, 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    setRunLoading(true);
    try {
      // Save first if needed
      if (!savedId) {
        if (!spec.name.trim()) { addToast('Save the spec first', 'error'); return; }
        const result: any = await api.testSpecs.create(spec);
        setSavedId(result.id);
        navigate(`/tests/${result.id}/edit`, { replace: true });
        const exec: any = await api.executions.trigger({ specId: result.id });
        addToast(`Execution started: ${exec.id}`, 'success');
        navigate(`/reports?exec=${exec.id}`);
      } else {
        const exec: any = await api.executions.trigger({ specId: savedId });
        addToast(`Execution started: ${exec.id}`, 'success');
        navigate(`/reports?exec=${exec.id}`);
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setRunLoading(false);
      setShowRunModal(false);
    }
  };

  const getEnv = () => environments?.find((e: any) => e.id === spec.environmentId) || null;

  // Threshold management
  const addThreshold = () => {
    setSpec(prev => ({
      ...prev,
      thresholds: {
        ...prev.thresholds,
        [`custom_metric_${Date.now()}`]: [{ condition: 'p(95)<500', abortOnFail: false }],
      },
    }));
  };

  const removeThreshold = (metric: string) => {
    setSpec(prev => {
      const next = { ...prev.thresholds };
      delete next[metric];
      return { ...prev, thresholds: next };
    });
  };

  const updateThreshold = (metric: string, condition: string) => {
    setSpec(prev => ({
      ...prev,
      thresholds: {
        ...prev.thresholds,
        [metric]: [{ condition, abortOnFail: prev.thresholds[metric]?.[0]?.abortOnFail || false }],
      },
    }));
  };

  const addCheck = () => {
    setSpec(prev => ({ ...prev, checks: [...prev.checks, ''] }));
  };

  const updateCheck = (i: number, val: string) => {
    const next = [...spec.checks];
    next[i] = val;
    setSpec(prev => ({ ...prev, checks: next }));
  };

  const removeCheck = (i: number) => {
    setSpec(prev => ({ ...prev, checks: prev.checks.filter((_, idx) => idx !== i) }));
  };

  const specForModal = savedId
    ? { ...spec, id: savedId, createdAt: '', updatedAt: '', lastRunStatus: null, lastRunAt: null } as TestSpec
    : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {showRunModal && specForModal && (
        <RunConfirmModal
          spec={specForModal}
          env={getEnv()}
          onConfirm={handleRun}
          onCancel={() => setShowRunModal(false)}
          loading={runLoading}
        />
      )}
      {showPreview && savedId && (
        <PreviewDrawer
          specId={savedId}
          defaultTab={previewTab}
          onClose={() => setShowPreview(false)}
          onRun={() => { setShowPreview(false); setShowRunModal(true); }}
        />
      )}
      {showSendToExecutorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Save before running?</h2>
            <p className="text-sm text-gray-600 mb-5">
              This test suite has unsaved changes. Save it before opening the K6 Executor?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => confirmSendToExecutor(false)}
                disabled={sendToExecutorLoading}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                No, just run
              </button>
              <button
                type="button"
                onClick={() => confirmSendToExecutor(true)}
                disabled={sendToExecutorLoading}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50"
              >
                {sendToExecutorLoading && <Loader2 size={14} className="animate-spin" />}
                Yes, save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Test Suite' : 'New Test Suite'}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Configure your performance test</p>
          {generatedScript && (
            <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
              AI-generated script ready — will be saved with this suite
            </p>
          )}
        </div>
        {/* Actions Bar */}
        <div className="flex items-center gap-2">
          {savedId && (
            <>
              <button
                type="button"
                onClick={() => { setPreviewTab('json'); setShowPreview(true); }}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                <Eye size={14} /> Preview JSON
              </button>
              <button
                type="button"
                onClick={() => { setPreviewTab('k6'); setShowPreview(true); }}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                <Eye size={14} /> Preview K6
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
              generatedScript
                ? 'border-purple-400 bg-purple-50 text-purple-700 hover:bg-purple-100'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => addToast('Schedule functionality coming soon', 'info')}
          >
            <Calendar size={14} /> Schedule
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => addToast('Pipeline integration coming soon', 'info')}
          >
            <GitBranch size={14} /> Add to Pipeline
          </button>
        </div>
      </div>

      {/* A–E: laid out in a 2-column grid so the page uses the full panel width      */}
      {/* instead of a single narrow scrollable column.                                */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* A. Basic Details */}
        <Accordion title="A. Basic Details" defaultOpen>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className={formLabel}>Test Name *</label>
              <input
                type="text"
                value={spec.name}
                onChange={e => setField('name', e.target.value)}
                className={formInput}
                placeholder="Search_API_Load_Test"
              />
            </div>
            <div>
              <label className={formLabel}>Tags</label>
              <TagInput
                tags={spec.tags}
                onChange={tags => setField('tags', tags)}
                placeholder="search, api, load..."
              />
            </div>
            <div>
              <label className={formLabel}>Description</label>
              <textarea
                value={spec.description || ''}
                onChange={e => setField('description', e.target.value)}
                className={`${formInput} h-20 resize-none`}
                placeholder="Describe the purpose of this test..."
              />
            </div>
          </div>
        </Accordion>

        {/* B. Test Configuration — mandatory before AI script generation can start */}
        <Accordion title="B. Test Configuration" defaultOpen badge="Required">
        <div className="space-y-6">
        <p className="text-xs text-gray-500 -mt-2">Required before generating a script.</p>

        {/* Test Type */}
        <div>
          <label className={`${formLabel} mb-2`}>Test Type *</label>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5 mb-3">
            {(Object.entries(TEST_TYPE_PROFILES) as [TestType, TestTypeProfile][]).map(([key, profile]) => {
              const selected = testType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleTestTypeSelect(key)}
                  className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border text-center transition-all ${
                    selected
                      ? `${profile.accentBg} ${profile.accent} border-current`
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-base leading-none">{profile.emoji}</span>
                  <span className={`text-[10px] font-semibold leading-tight ${selected ? '' : 'text-gray-700'}`}>{profile.label}</span>
                  <span className={`text-[9px] leading-tight ${selected ? 'opacity-70' : 'text-gray-400'}`}>{profile.hint}</span>
                </button>
              );
            })}
          </div>
          {testType && (
            <div className={`rounded-lg px-3 py-2.5 text-xs ${TEST_TYPE_PROFILES[testType].accentBg} border ${TEST_TYPE_PROFILES[testType].accent.split(' ').find(c => c.startsWith('border-'))}`}>
              <div className="font-semibold mb-0.5 text-gray-800">{TEST_TYPE_PROFILES[testType].label} Test</div>
              <div className="text-gray-600">{TEST_TYPE_PROFILES[testType].description}</div>
            </div>
          )}
        </div>

        {/* Script Complexity */}
        <div>
          <label className={`${formLabel} mb-2`}>Script Complexity *</label>
          <div className="flex gap-1.5 max-w-md">
            {(['simple', 'medium', 'complex'] as Complexity[]).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setComplexity(c)}
                className={`flex-1 py-1.5 text-xs rounded-lg font-medium border transition-colors capitalize ${
                  complexity === c
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            {complexity === 'simple'  && 'Single endpoint, basic GET requests.'}
            {complexity === 'medium'  && 'Multiple endpoints, checks & thresholds.'}
            {complexity === 'complex' && 'Auth flows, data-driven, custom metrics.'}
          </p>
        </div>

        {/* Load Profile */}
        <div>
          <label className={`${formLabel} mb-2`}>Load Profile *</label>
          <div className="flex gap-1.5 mb-3 max-w-xs">
            {(['staged', 'constant'] as const).map(pt => (
              <button key={pt} type="button" onClick={() => setProfileType(pt)}
                className={`flex-1 py-1.5 text-xs rounded-lg font-medium border transition-colors ${profileType === pt ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                {pt.charAt(0).toUpperCase() + pt.slice(1)}
              </button>
            ))}
          </div>

          {profileType === 'staged' && (
            <div className="max-w-md">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 mb-1.5">
                <span className="text-xs text-gray-500 font-medium">VUs</span>
                <span className="text-xs text-gray-500 font-medium">Duration</span>
                <span />
              </div>
              {stages.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 mb-1.5">
                  <input type="number" value={s.target} min={0} onChange={e => updateStage(i, 'target', parseInt(e.target.value) || 0)}
                    className={`${formInput} text-xs py-1.5`} />
                  <input type="text" value={s.duration} placeholder="1m" onChange={e => updateStage(i, 'duration', e.target.value)}
                    className={`${formInput} text-xs py-1.5`} />
                  <button type="button" onClick={() => removeStage(i)} className="text-gray-400 hover:text-red-500 flex items-center justify-center">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addStage} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium mt-1">
                <Plus size={12} /> Add Stage
              </button>
            </div>
          )}

          {profileType === 'constant' && (
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">VUs</label>
                <input type="number" value={constantVus} min={1} onChange={e => setConstantVus(parseInt(e.target.value) || 1)} className={formInput} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Duration</label>
                <input type="text" value={constantDuration} placeholder="1m" onChange={e => setConstantDuration(e.target.value)} className={formInput} />
              </div>
            </div>
          )}
        </div>

        {/* Env Variables */}
        <div>
          <div className="flex items-center justify-between mb-2 max-w-md">
            <label className={`${formLabel} mb-0`}>Env Variables</label>
            <button type="button" onClick={addEnvVar} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium">
              <Plus size={12} /> Add
            </button>
          </div>
          <div className="max-w-md">
            {envVars.map((ev, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 mb-1.5">
                <input type="text" value={ev.key} placeholder="KEY" onChange={e => updateEnvVar(i, 'key', e.target.value)}
                  className={`${formInput} text-xs py-1.5`} />
                <input type="text" value={ev.value} placeholder="value" onChange={e => updateEnvVar(i, 'value', e.target.value)}
                  className={`${formInput} text-xs py-1.5`} />
                <button type="button" onClick={() => removeEnvVar(i)} className="text-gray-400 hover:text-red-500 flex items-center justify-center">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
        </div>
        </Accordion>

        {/* C. Request Configuration */}
        <Accordion title="C. Request Configuration" defaultOpen>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={formLabel}>Method</label>
                <select
                  value={spec.request.method}
                  onChange={e => setField('request.method', e.target.value)}
                  className={formInput}
                >
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className={formLabel}>URL *</label>
                <input
                  type="text"
                  value={spec.request.url}
                  onChange={e => setField('request.url', e.target.value)}
                  className={formInput}
                  placeholder="https://api.example.com/endpoint"
                />
              </div>
            </div>

            <div>
              <label className={formLabel}>Headers</label>
              <HeadersTable
                headers={spec.request.headers}
                onChange={h => setField('request.headers', h)}
              />
            </div>

            {(spec.request.method !== 'GET' && spec.request.method !== 'DELETE') && (
              <div>
                <label className={formLabel}>JSON Payload</label>
                <textarea
                  value={spec.request.payload || ''}
                  onChange={e => setField('request.payload', e.target.value || null)}
                  className={`${formInput} h-32 font-mono text-xs resize-y`}
                  placeholder='{"key": "value"}'
                />
              </div>
            )}

            <div>
              <label className={formLabel}>Authentication</label>
              <div className="grid grid-cols-3 gap-3">
                <select
                  value={spec.request.auth.type}
                  onChange={e => setField('request.auth.type', e.target.value)}
                  className={formInput}
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="apikey">API Key</option>
                  <option value="basic">Basic Auth</option>
                </select>
                {(spec.request.auth.type === 'bearer' || spec.request.auth.type === 'apikey') && (
                  <input
                    type="text"
                    value={spec.request.auth.tokenSecret || ''}
                    onChange={e => setField('request.auth.tokenSecret', e.target.value)}
                    className={formInput}
                    placeholder="Secret name (e.g. api_token)"
                  />
                )}
                {spec.request.auth.type === 'apikey' && (
                  <input
                    type="text"
                    value={spec.request.auth.headerName || 'X-API-Key'}
                    onChange={e => setField('request.auth.headerName', e.target.value)}
                    className={formInput}
                    placeholder="Header name (e.g. X-API-Key)"
                  />
                )}
              </div>
            </div>
          </div>
        </Accordion>

        {/* D. Validation and Threshold */}
        <Accordion title="D. Validation and Threshold">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`${formLabel} mb-0`}>Checks *</label>
                <button
                  type="button"
                  onClick={addCheck}
                  className="flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600"
                >
                  <Plus size={13} /> Add Check
                </button>
              </div>
              <div className="space-y-2">
                {spec.checks.map((check, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={check}
                      onChange={e => updateCheck(i, e.target.value)}
                      className={`${formInput} flex-1`}
                      placeholder="status is 200"
                    />
                    <button
                      type="button"
                      onClick={() => removeCheck(i)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`${formLabel} mb-0`}>Thresholds *</label>
                <button
                  type="button"
                  onClick={addThreshold}
                  className="flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600"
                >
                  <Plus size={13} /> Add Threshold
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Metric</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Condition</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Abort on Fail</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(spec.thresholds).map(([metric, conditions]) => (
                      <tr key={metric} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{metric}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={conditions[0]?.condition || ''}
                            onChange={e => updateThreshold(metric, e.target.value)}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={conditions[0]?.abortOnFail || false}
                            onChange={e => {
                              setSpec(prev => ({
                                ...prev,
                                thresholds: {
                                  ...prev.thresholds,
                                  [metric]: [{ ...conditions[0], abortOnFail: e.target.checked }],
                                },
                              }));
                            }}
                            className="rounded"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeThreshold(metric)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Accordion>

        {/* E. SLO / SLA Targets — spans full width, column-spanning the grid */}
        <div className="xl:col-span-2">
          <Accordion title="E. SLO/SLA Targets" badge={(spec as any).slos?.length ? String((spec as any).slos.length) : undefined}>
            <p className="text-xs text-gray-500 mb-4">
              Define performance objectives. After each run PerfOps will evaluate these automatically and mark the execution as compliant or breached.
            </p>
            <SloEditor
              slos={(spec as any).slos ?? []}
              onChange={slos => {
                setField('slos', slos);
                if (slos.length) sessionStorage.setItem('generatedK6ScriptSlos', JSON.stringify(slos));
                else sessionStorage.removeItem('generatedK6ScriptSlos');
              }}
            />
          </Accordion>
        </div>
      </div>

      {/* Login Credentials CSV — required before a script can be generated */}
      <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Login Credentials CSV *</label>
          <span className="text-xs text-gray-400">Required columns: URL, Username, Password, InstanceName — one row per VU</span>
        </div>
        {credentialBatchId ? (
          <div className="flex items-center gap-2">
            <span className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 text-xs text-green-700">
              ✓ {credentialFileName} — {credentialCount} credential{credentialCount === 1 ? '' : 's'} loaded
            </span>
            <button type="button" onClick={clearCredentials}
              className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded border border-gray-200 hover:border-red-300">
              Remove
            </button>
          </div>
        ) : (
          <div {...getCredRootProps()} className={`border-2 border-dashed rounded-lg px-4 py-2 text-center cursor-pointer text-xs transition-colors ${isCredDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}`}>
            <input {...getCredInputProps()} />
            {credentialUploading
              ? <span className="text-gray-500">Uploading…</span>
              : <span className="text-gray-500">Drop credentials .csv file or click to browse — required to generate a script</span>}
          </div>
        )}
        {credentialError && <p className="text-xs text-red-600 mt-1.5">{credentialError}</p>}
      </div>

      {/* F. Script Generation — AI-from-config vs. HAR/JSON import, in separate tabs */}
      <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className={`px-6 py-4 ${genTab === 'ai' ? 'bg-gradient-to-r from-purple-600 to-indigo-600' : 'bg-gradient-to-r from-teal-600 to-cyan-600'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold text-base">F. Script Generation</h2>
              <p className="text-white/80 text-xs">
                {genTab === 'ai'
                  ? 'Upload test cases → Claude analyzes → K6 script generated'
                  : 'Captured session → Claude analyzes → K6 script generated'}
              </p>
            </div>
            <div className="flex gap-1 bg-black/20 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setGenTab('ai')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  genTab === 'ai' ? 'bg-white text-purple-700 shadow-sm' : 'text-white/80 hover:text-white'
                }`}
              >
                <Sparkles size={14} /> AI Generate
              </button>
              <button
                type="button"
                onClick={() => setGenTab('har')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  genTab === 'har' ? 'bg-white text-teal-700 shadow-sm' : 'text-white/80 hover:text-white'
                }`}
              >
                <Globe size={14} /> Import HAR/JSON
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          {genTab === 'ai' ? (
            <AIGeneratePanel
              embedded
              testType={testType ? TEST_TYPE_TO_AI_LABEL[testType] : ''}
              complexity={COMPLEXITY_TO_AI_LABEL[complexity]}
              loadProfile={{ profileType, stages, constantVus, constantDuration }}
              envVarKeys={envVars.filter(e => e.key.trim()).map(e => e.key.trim())}
              specContext={specContext}
              disabled={!!blockedReason}
              disabledReason={blockedReason ?? undefined}
              onScriptGenerated={handleScriptGenerated}
              credentialBatchId={credentialBatchId}
              initialFile={aiFile}
              onFileChange={setAiFile}
            />
          ) : (
            <HarToScriptPanel
              embedded
              loadProfile={{ profileType, stages, constantVus, constantDuration }}
              disabled={!spec.name.trim() || !credentialBatchId}
              disabledReason={
                !spec.name.trim()
                  ? 'Enter a Test Name (section A) before converting a HAR/JSON file.'
                  : !credentialBatchId
                    ? 'Upload a Login Credentials CSV before converting a HAR/JSON file.'
                    : undefined
              }
              onScriptGenerated={handleScriptGenerated}
              credentialBatchId={credentialBatchId}
              initialFiles={harFiles}
              onFilesChange={setHarFiles}
            />
          )}
        </div>
      </div>

      {/* G. Script Editor — shown whenever a script has been generated (AI panel) or  */}
      {/* imported (file upload). Editing updates generatedScript directly, so the     */}
      {/* modified version is what gets saved with the test suite.                     */}
      {generatedScript !== null && (
        <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Code2 size={15} className="text-purple-600" />
              <span className="font-semibold text-gray-800 text-sm">G. Script Editor</span>
              <span className="text-xs text-gray-400">{generatedScript.split('\n').length} lines</span>
              {scriptEdited && (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  Edited
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Reset to original generated script */}
              {scriptEdited && scriptSnapshot && (
                <button
                  type="button"
                  onClick={() => { setGeneratedScript(scriptSnapshot); setScriptEdited(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Reset to original generated script"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              )}

              {/* Copy to clipboard */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(generatedScript).then(() => {
                    setScriptCopied(true);
                    setTimeout(() => setScriptCopied(false), 1500);
                  });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Copy size={12} />
                {scriptCopied ? 'Copied!' : 'Copy'}
              </button>

              {/* Send current (possibly edited) script to K6 Executor */}
              <button
                type="button"
                onClick={handleSendToExecutorClick}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium transition-colors"
              >
                <Send size={12} /> Send to Executor
              </button>
            </div>
          </div>

          {/* Suite-changed banner — shown whenever section A-E edits have drifted   */}
          {/* from the spec the current script was generated/loaded against. "Sync"  */}
          {/* sends only the itemized diff to /api/ai-refine, which is instructed to */}
          {/* touch just those lines rather than regenerate the script from scratch. */}
          {specDiffSinceScript.length > 0 && (
            <div className="flex items-start gap-3 px-5 py-3 bg-amber-50 border-b border-amber-200">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800">
                  Test suite changed since this script was generated ({specDiffSinceScript.length} change{specDiffSinceScript.length === 1 ? '' : 's'})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {specDiffSinceScript.map((d, i) => (
                    <li key={i} className="text-xs text-amber-700">• {d}</li>
                  ))}
                </ul>
                {syncError && <p className="text-xs text-red-600 mt-1.5">{syncError}</p>}
              </div>
              <button
                type="button"
                onClick={handleSyncScript}
                disabled={syncingScript}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition-colors flex-shrink-0"
              >
                {syncingScript ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {syncingScript ? 'Applying…' : 'Sync Script with Suite Changes'}
              </button>
            </div>
          )}

          {/* Editable code area */}
          <textarea
            value={generatedScript}
            onChange={e => {
              setGeneratedScript(e.target.value);
              setScriptEdited(true);
              // Keep sessionStorage in sync so Executor always gets the latest version
              sessionStorage.setItem('generatedK6Script', e.target.value);
            }}
            spellCheck={false}
            className="w-full bg-gray-950 text-gray-200 text-xs leading-5 p-4 resize-y focus:outline-none"
            style={{
              minHeight: 420,
              fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Courier New',monospace",
            }}
          />

          {/* Ask the agent to tweak the script (AI-generated or HAR-imported) */}
          <AgentRefinePanel
            script={generatedScript}
            onScriptUpdated={script => {
              setGeneratedScript(script);
              setScriptEdited(false);
              sessionStorage.setItem('generatedK6Script', script);
            }}
          />
        </div>
      )}
    </div>
  );
};
