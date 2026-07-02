// Shared between Test Authoring (where these are configured) and the K6 Executor
// (which just consumes whatever was configured during authoring).

export type TestType = 'smoke' | 'load' | 'stress' | 'spike' | 'soak' | 'breakpoint';
export type Complexity = 'simple' | 'medium' | 'complex';

export interface TestTypeProfile {
  label: string;
  emoji: string;
  description: string;
  hint: string;               // e.g. "1 VU · 2 min"
  watchFor: string;           // contextual metric guidance
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
  accent: string;             // tailwind colour token (text + border)
  accentBg: string;
}

export const TEST_TYPE_PROFILES: Record<TestType, TestTypeProfile> = {
  smoke: {
    label: 'Smoke',    emoji: '🔬',
    description: 'Verify system works at minimal load',
    hint: '1 VU · 2 min',
    watchFor: 'Focus: error rate — any failure signals a broken baseline.',
    profileType: 'staged',
    stages: [
      { target: 1, duration: '30s' },
      { target: 1, duration: '1m' },
      { target: 0, duration: '30s' },
    ],
    accent: 'text-sky-700 border-sky-300', accentBg: 'bg-sky-50',
  },
  load: {
    label: 'Load',     emoji: '📈',
    description: 'Normal expected traffic patterns',
    hint: '10 VUs · 9 min',
    watchFor: 'Focus: P95 latency and error rate under normal usage.',
    profileType: 'staged',
    stages: [
      { target: 10, duration: '2m' },
      { target: 10, duration: '5m' },
      { target: 0,  duration: '2m' },
    ],
    accent: 'text-green-700 border-green-300', accentBg: 'bg-green-50',
  },
  stress: {
    label: 'Stress',   emoji: '💪',
    description: 'Push beyond normal capacity',
    hint: '200 VUs · 14 min',
    watchFor: 'Focus: error rate spike and latency degradation under high load.',
    profileType: 'staged',
    stages: [
      { target: 50,  duration: '2m' },
      { target: 100, duration: '5m' },
      { target: 200, duration: '5m' },
      { target: 0,   duration: '2m' },
    ],
    accent: 'text-orange-700 border-orange-300', accentBg: 'bg-orange-50',
  },
  spike: {
    label: 'Spike',    emoji: '⚡',
    description: 'Sudden extreme load burst',
    hint: '500 VUs · 2.5 min burst',
    watchFor: 'Focus: how quickly errors rise and system recovers post-spike.',
    profileType: 'staged',
    stages: [
      { target: 1,   duration: '1m' },
      { target: 500, duration: '30s' },
      { target: 1,   duration: '1m' },
    ],
    accent: 'text-red-700 border-red-300', accentBg: 'bg-red-50',
  },
  soak: {
    label: 'Soak',     emoji: '🕐',
    description: 'Extended duration reliability run',
    hint: '10 VUs · 70 min',
    watchFor: 'Focus: memory leaks, slow latency creep, and error accumulation over time.',
    profileType: 'staged',
    stages: [
      { target: 10, duration: '5m' },
      { target: 10, duration: '60m' },
      { target: 0,  duration: '5m' },
    ],
    accent: 'text-purple-700 border-purple-300', accentBg: 'bg-purple-50',
  },
  breakpoint: {
    label: 'Breakpoint', emoji: '🎯',
    description: 'Gradually increase until failure',
    hint: '300 VUs · 20 min ramp',
    watchFor: 'Focus: the VU count where errors exceed 1 % — that is your breakpoint.',
    profileType: 'staged',
    stages: [
      { target: 50,  duration: '5m' },
      { target: 100, duration: '5m' },
      { target: 200, duration: '5m' },
      { target: 300, duration: '5m' },
    ],
    accent: 'text-yellow-700 border-yellow-300', accentBg: 'bg-yellow-50',
  },
};

export interface Stage {
  target: number;
  duration: string;
}

export interface EnvVar {
  key: string;
  value: string;
}

// Maps Test Authoring's TestType/Complexity onto the labels AIGeneratePanel/AI
// generation endpoint expects.
export const TEST_TYPE_TO_AI_LABEL: Record<TestType, string> = {
  smoke: 'Smoke Test',
  load: 'Load Test',
  stress: 'Stress Test',
  spike: 'Spike Test',
  soak: 'Soak Test',
  breakpoint: 'Breakpoint Test',
};

export const COMPLEXITY_TO_AI_LABEL: Record<Complexity, string> = {
  simple: 'Simple',
  medium: 'Standard',
  complex: 'Advanced',
};
