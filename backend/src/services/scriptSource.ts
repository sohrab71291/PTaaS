import { fetchScript as fetchScriptFromGithub } from './githubService';
import { fetchScript as fetchScriptFromGitlab } from './gitlabService';

// Scripts are no longer trusted from local storage (TestSpec.generatedScript,
// session storage, etc.) at execution time — the repo is the source of truth,
// so every manual and scheduled run re-fetches the current file right before
// dispatch. GitHub is tried first (the primary/default remote), falling back
// to GitLab if that's what's configured instead.
export async function fetchLatestScript(specName: string): Promise<string> {
  try {
    return await fetchScriptFromGithub(specName);
  } catch (githubErr: any) {
    try {
      return await fetchScriptFromGitlab(specName);
    } catch (gitlabErr: any) {
      throw new Error(
        `Could not fetch script for "${specName}" from GitHub or GitLab. ` +
        `GitHub: ${githubErr.message} | GitLab: ${gitlabErr.message}`,
      );
    }
  }
}
