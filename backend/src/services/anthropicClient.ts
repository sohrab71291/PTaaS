import Anthropic from '@anthropic-ai/sdk';

// Build client lazily so it always reads the env vars after dotenv has run
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (apiKey) return new Anthropic({ apiKey });
  if (authToken) return new Anthropic({ authToken });
  return new Anthropic({ apiKey: '' }); // will fail with clear auth error
}

export function hasAnthropicCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export const isOverloadedError = (err: any) =>
  err?.status === 529 || err?.error?.error?.type === 'overloaded_error' || err?.error?.type === 'overloaded_error';

export const CLAUDE_MODEL = 'claude-opus-4-8';
export const MAX_STREAM_ATTEMPTS = 4;
export const STREAM_BACKOFF_MS = [1000, 2000, 4000];

export const stripCodeFences = (s: string) => s
  .replace(/^```(?:javascript|js)?\n?/m, '')
  .replace(/\n?```\s*$/m, '')
  .trim();
