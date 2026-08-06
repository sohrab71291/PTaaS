"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScriptPathForSpec = getScriptPathForSpec;
exports.pushScript = pushScript;
exports.fetchScript = fetchScript;
const rest_1 = require("@octokit/rest");
const slug_1 = require("./slug");
// Accepts "owner/repo", a bare "https://github.com/owner/repo(.git)" URL, or an
// owner/repo pair with extra path segments (e.g. a URL copied with a /tree/branch suffix).
function parseRepoUrl(repoUrl) {
    const trimmed = repoUrl.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '');
    const [owner, repo] = trimmed.split('/');
    if (!owner || !repo)
        return null;
    return { owner, repo };
}
function getConfig(override) {
    const token = override?.token || process.env.GITHUB_TOKEN;
    const branch = override?.branch || process.env.GITHUB_BRANCH || 'main';
    const scriptsPath = process.env.GITHUB_SCRIPTS_PATH || 'scripts';
    if (override?.repoUrl) {
        const parsed = parseRepoUrl(override.repoUrl);
        if (!parsed || !token)
            return null;
        return { token, owner: parsed.owner, repo: parsed.repo, branch, scriptsPath, explicitScriptPath: override.scriptPath || null };
    }
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!token || !owner || !repo)
        return null;
    return { token, owner, repo, branch, scriptsPath, explicitScriptPath: null };
}
function scriptPath(specName, scriptsPath) {
    return `${scriptsPath}/${(0, slug_1.slugify)(specName)}.js`;
}
function getScriptPathForSpec(specName) {
    const config = getConfig();
    return scriptPath(specName, config?.scriptsPath || 'scripts');
}
async function pushScript(specId, specName, content, message) {
    const config = getConfig();
    if (!config) {
        console.warn('[GitHub] Skipping script push — GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO not configured');
        return;
    }
    const octokit = new rest_1.Octokit({ auth: config.token });
    const path = scriptPath(specName, config.scriptsPath);
    try {
        let sha;
        try {
            const existing = await octokit.repos.getContent({
                owner: config.owner,
                repo: config.repo,
                path,
                ref: config.branch,
            });
            if (!Array.isArray(existing.data) && existing.data.type === 'file') {
                sha = existing.data.sha;
            }
        }
        catch (err) {
            if (err.status !== 404)
                throw err;
        }
        await octokit.repos.createOrUpdateFileContents({
            owner: config.owner,
            repo: config.repo,
            path,
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: config.branch,
            ...(sha ? { sha } : {}),
        });
    }
    catch (err) {
        console.warn(`[GitHub] Failed to push script for spec ${specId} (${specName}): ${err.message}`);
    }
}
async function fetchScript(specName, override) {
    const config = getConfig(override);
    if (!config) {
        throw new Error('GitHub not configured — set a repo URL + token on the schedule, or GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO env vars');
    }
    const octokit = new rest_1.Octokit({ auth: config.token });
    const path = config.explicitScriptPath || scriptPath(specName, config.scriptsPath);
    const res = await octokit.repos.getContent({
        owner: config.owner,
        repo: config.repo,
        path,
        ref: config.branch,
    });
    if (Array.isArray(res.data) || res.data.type !== 'file' || !res.data.content) {
        throw new Error(`GitHub path "${path}" is not a file`);
    }
    return Buffer.from(res.data.content, 'base64').toString('utf-8');
}
