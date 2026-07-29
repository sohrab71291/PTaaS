import { Octokit } from '@octokit/rest';

export interface ScheduleGithubConfig {
  repoUrl?: string | null;
  branch?: string | null;
  scriptPath?: string | null;
  token?: string | null;
}

// Accepts "owner/repo", a bare "https://github.com/owner/repo(.git)" URL, or an
// owner/repo pair with extra path segments (e.g. a URL copied with a /tree/branch suffix).
function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const trimmed = repoUrl.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '');
  const [owner, repo] = trimmed.split('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}

function getConfig(override?: ScheduleGithubConfig) {
  const token = override?.token || process.env.GITHUB_TOKEN;
  const branch = override?.branch || process.env.GITHUB_BRANCH || 'main';
  const scriptsPath = process.env.GITHUB_SCRIPTS_PATH || 'scripts';

  if (override?.repoUrl) {
    const parsed = parseRepoUrl(override.repoUrl);
    if (!parsed || !token) return null;
    return { token, owner: parsed.owner, repo: parsed.repo, branch, scriptsPath, explicitScriptPath: override.scriptPath || null };
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, branch, scriptsPath, explicitScriptPath: null };
}

function scriptPath(specId: string, scriptsPath: string): string {
  return `${scriptsPath}/${specId}.js`;
}

export function getScriptPathForSpec(specId: string): string {
  const config = getConfig();
  return scriptPath(specId, config?.scriptsPath || 'scripts');
}

export async function pushScript(specId: string, content: string, message: string): Promise<void> {
  const config = getConfig();
  if (!config) {
    console.warn('[GitHub] Skipping script push — GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO not configured');
    return;
  }

  const octokit = new Octokit({ auth: config.token });
  const path = scriptPath(specId, config.scriptsPath);

  try {
    let sha: string | undefined;
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
    } catch (err: any) {
      if (err.status !== 404) throw err;
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
  } catch (err: any) {
    console.warn(`[GitHub] Failed to push script for spec ${specId}: ${err.message}`);
  }
}

export async function fetchScript(specId: string, override?: ScheduleGithubConfig): Promise<string> {
  const config = getConfig(override);
  if (!config) {
    throw new Error('GitHub not configured — set a repo URL + token on the schedule, or GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO env vars');
  }

  const octokit = new Octokit({ auth: config.token });
  const path = config.explicitScriptPath || scriptPath(specId, config.scriptsPath);

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
