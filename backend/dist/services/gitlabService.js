"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushScript = pushScript;
exports.fetchScript = fetchScript;
const slug_1 = require("./slug");
// Accepts "namespace/project", "namespace/subgroup/project", or a full
// "https://gitlab.example.com/namespace/project(.git)" URL.
function parseProjectPath(repoUrl) {
    const trimmed = repoUrl.trim().replace(/\.git$/, '');
    const match = trimmed.match(/^https?:\/\/([^/]+)\/(.+)$/);
    if (match) {
        return { baseUrl: `https://${match[1]}`, projectPath: match[2] };
    }
    if (!trimmed.includes('/'))
        return null;
    return { baseUrl: process.env.GITLAB_BASE_URL || 'https://gitlab.com', projectPath: trimmed };
}
function getConfig(override) {
    const token = override?.token || process.env.GITLAB_TOKEN;
    const branch = override?.branch || process.env.GITLAB_BRANCH || 'main';
    const scriptsPath = process.env.GITLAB_SCRIPTS_PATH || 'scripts';
    const rawRepo = override?.repoUrl || (process.env.GITLAB_PROJECT
        ? `${process.env.GITLAB_BASE_URL || 'https://gitlab.com'}/${process.env.GITLAB_PROJECT}`
        : null);
    if (!rawRepo || !token)
        return null;
    const parsed = parseProjectPath(rawRepo);
    if (!parsed)
        return null;
    return {
        token,
        branch,
        scriptsPath,
        baseUrl: parsed.baseUrl,
        projectId: encodeURIComponent(parsed.projectPath),
        explicitScriptPath: override?.scriptPath || null,
    };
}
function scriptPath(specName, scriptsPath) {
    return `${scriptsPath}/${(0, slug_1.slugify)(specName)}.js`;
}
async function apiFetch(url, token, init) {
    return fetch(url, {
        ...init,
        headers: { 'PRIVATE-TOKEN': token, ...(init?.headers || {}) },
    });
}
async function pushScript(specId, specName, content, message) {
    const config = getConfig();
    if (!config) {
        console.warn('[GitLab] Skipping script push — GITLAB_TOKEN/GITLAB_PROJECT not configured');
        return;
    }
    const path = config.explicitScriptPath || scriptPath(specName, config.scriptsPath);
    const filesUrl = `${config.baseUrl}/api/v4/projects/${config.projectId}/repository/files/${encodeURIComponent(path)}`;
    try {
        const existing = await apiFetch(`${filesUrl}?ref=${encodeURIComponent(config.branch)}`, config.token);
        const method = existing.status === 404 ? 'POST' : 'PUT';
        const res = await apiFetch(filesUrl, config.token, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch: config.branch, content, commit_message: message }),
        });
        if (!res.ok) {
            throw new Error(`GitLab API responded ${res.status}: ${await res.text()}`);
        }
    }
    catch (err) {
        console.warn(`[GitLab] Failed to push script for spec ${specId} (${specName}): ${err.message}`);
    }
}
async function fetchScript(specName, override) {
    const config = getConfig(override);
    if (!config) {
        throw new Error('GitLab not configured — set a repo URL + token on the schedule, or GITLAB_TOKEN/GITLAB_PROJECT env vars');
    }
    const path = config.explicitScriptPath || scriptPath(specName, config.scriptsPath);
    const filesUrl = `${config.baseUrl}/api/v4/projects/${config.projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(config.branch)}`;
    const res = await apiFetch(filesUrl, config.token);
    if (!res.ok) {
        throw new Error(`GitLab path "${path}" could not be fetched (status ${res.status})`);
    }
    return res.text();
}
