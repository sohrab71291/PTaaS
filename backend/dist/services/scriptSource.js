"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLatestScript = fetchLatestScript;
const githubService_1 = require("./githubService");
const gitlabService_1 = require("./gitlabService");
// Scripts are no longer trusted from local storage (TestSpec.generatedScript,
// session storage, etc.) at execution time — the repo is the source of truth,
// so every manual and scheduled run re-fetches the current file right before
// dispatch. GitHub is tried first (the primary/default remote), falling back
// to GitLab if that's what's configured instead.
async function fetchLatestScript(specName) {
    try {
        return await (0, githubService_1.fetchScript)(specName);
    }
    catch (githubErr) {
        try {
            return await (0, gitlabService_1.fetchScript)(specName);
        }
        catch (gitlabErr) {
            throw new Error(`Could not fetch script for "${specName}" from GitHub or GitLab. ` +
                `GitHub: ${githubErr.message} | GitLab: ${gitlabErr.message}`);
        }
    }
}
