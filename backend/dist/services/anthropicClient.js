"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripCodeFences = exports.STREAM_BACKOFF_MS = exports.MAX_STREAM_ATTEMPTS = exports.CLAUDE_MODEL = exports.isOverloadedError = void 0;
exports.getAnthropicClient = getAnthropicClient;
exports.hasAnthropicCredentials = hasAnthropicCredentials;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// Build client lazily so it always reads the env vars after dotenv has run
function getAnthropicClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (apiKey)
        return new sdk_1.default({ apiKey });
    if (authToken)
        return new sdk_1.default({ authToken });
    return new sdk_1.default({ apiKey: '' }); // will fail with clear auth error
}
function hasAnthropicCredentials() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
const isOverloadedError = (err) => err?.status === 529 || err?.error?.error?.type === 'overloaded_error' || err?.error?.type === 'overloaded_error';
exports.isOverloadedError = isOverloadedError;
exports.CLAUDE_MODEL = 'claude-opus-4-8';
exports.MAX_STREAM_ATTEMPTS = 4;
exports.STREAM_BACKOFF_MS = [1000, 2000, 4000];
const stripCodeFences = (s) => s
    .replace(/^```(?:javascript|js)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
exports.stripCodeFences = stripCodeFences;
