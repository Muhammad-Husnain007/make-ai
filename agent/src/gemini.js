import { GoogleGenAI } from '@google/genai';
import { isSecretPath, maskContextFile, redactText, sanitizeIssuePayload } from './secrets.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableAi = (error) => /UNAVAILABLE|503|high demand|RESOURCE_EXHAUSTED|429|overloaded/i.test(error?.message || String(error || ''));
const isMissingModel = (error) => /NOT_FOUND|404|not found|no longer available/i.test(error?.message || String(error || ''));

function parseJsonObject(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitizeAnalysis(analysis) {
  const files = Array.isArray(analysis?.files) ? analysis.files.map((file) => ({
    path: file?.path,
    edits: Array.isArray(file?.edits) ? file.edits : Array.isArray(file?.changes) ? file.changes : [],
  })) : [];
  return {
    summary: redactText(analysis?.summary || ''),
    rootCause: redactText(analysis?.rootCause || ''),
    solution: redactText(analysis?.solution || ''),
    prBody: redactText(analysis?.prBody || ''),
    files,
  };
}

export async function analyzeWithGemini({ issue, event, contextFiles, repo, base }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const preferred = (process.env.PRIMARY_GEMINI_MODEL || 'gemini-3.6-flash').replace(/^models\//, '');
  const models = [...new Set([preferred, 'gemini-3.6-flash', 'gemini-flash-latest'])];
  const ai = new GoogleGenAI({ apiKey });
  const safeFiles = (contextFiles || [])
    .map((file) => maskContextFile(file))
    .filter((file) => file && !isSecretPath(file.path));
  if (!safeFiles.length) throw new Error('No non-secret stack files are available for AI analysis.');
  const allowedPaths = safeFiles.map((file) => file.path);
  const payload = sanitizeIssuePayload(issue, event);
  const files = safeFiles.map((file) => ({
    path: file.path,
    contents: file.contents,
  }));
  const prompt = `You are Pulse. Fix this production crash with a GitHub PR against \`${repo}\` branch \`${base}\`.
Use only the stack-matched files below. You do not have the rest of the repository.

Return ONLY JSON:
{
  "summary": "one paragraph",
  "rootCause": "syntax error or logical bug",
  "solution": "what changed",
  "prBody": "markdown",
  "files": [{
    "path": "exact/path/from/the/list.js",
    "edits": [{ "old": "exact text copied from contents", "new": "that text with the bug fixed" }]
  }]
}

Rules:
- Handle syntax errors AND logical bugs, including complex fixes that need many edits or larger changes in these files.
- Only edit: ${JSON.stringify(allowedPaths)}
- Do not invent other files or ask for the rest of the repo.
- "old" must be copied from contents, including spaces.
- Leave every __PULSE_REDACTED_N__ token unchanged. Never output passwords, API keys, private keys, tokens, or connection secrets.
- Do not reformat unrelated code.
- After your edits the original crash must be gone from these files. Pulse will syntax-check the patch and refuse a PR if tests fail.

Issue: ${payload.title}
Culprit: ${payload.culprit || 'n/a'}
Stack:
${payload.stack}

Files:
${JSON.stringify(files)}`;

  let lastError;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      return sanitizeAnalysis(parseJsonObject(response.text || ''));
    } catch (error) {
      lastError = error;
      if (isMissingModel(error)) continue;
      if (isRetryableAi(error)) {
        await sleep(800);
        try {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { responseMimeType: 'application/json' },
          });
          return sanitizeAnalysis(parseJsonObject(response.text || ''));
        } catch (retryError) {
          lastError = retryError;
          if (isMissingModel(retryError)) continue;
        }
      }
    }
  }
  throw lastError;
}

export async function reviewFixWithGemini({ issue, event, patchedFiles, testFiles = [], repo, base }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: true, skipped: true, reason: 'GEMINI_API_KEY missing' };
  const safeFiles = (patchedFiles || [])
    .map((file) => maskContextFile({ ...file, contents: file.githubContents || file.contents }))
    .filter((file) => file && !isSecretPath(file.path));
  if (!safeFiles.length) return { ok: false, reason: 'No patched files available to review.' };
  const payload = sanitizeIssuePayload(issue, event);
  const tests = (testFiles || [])
    .map((file) => maskContextFile(file))
    .filter((file) => file && !isSecretPath(file.path))
    .slice(0, 4)
    .map((file) => ({ path: file.path, contents: file.contents }));
  const prompt = `You are Pulse. Review whether this patch fixes the production crash. You only see the patched stack files and any matching tests. You do not have the rest of the repository.

Return ONLY JSON:
{ "ok": true, "reason": "why this would or would not still throw" }

Rules:
- ok=true only if the original crash would not still happen in these files.
- ok=false if syntax is broken, the bad call/name is still used, or the change is unrelated.
- Leave every __PULSE_REDACTED_N__ token unchanged. Never output secrets.

Repo: ${repo || 'n/a'} branch ${base || 'n/a'}
Issue: ${payload.title}
Culprit: ${payload.culprit || 'n/a'}
Stack:
${payload.stack}

Patched files:
${JSON.stringify(safeFiles.map((file) => ({ path: file.path, contents: file.contents })))}

Related tests:
${JSON.stringify(tests)}`;

  const preferred = (process.env.PRIMARY_GEMINI_MODEL || 'gemini-3.6-flash').replace(/^models\//, '');
  const models = [...new Set([preferred, 'gemini-3.6-flash', 'gemini-flash-latest'])];
  const ai = new GoogleGenAI({ apiKey });
  let lastError;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = parseJsonObject(response.text || '');
      return { ok: parsed.ok === true, reason: redactText(parsed.reason || '') };
    } catch (error) {
      lastError = error;
      if (isMissingModel(error)) continue;
      if (isRetryableAi(error)) {
        await sleep(800);
        continue;
      }
    }
  }
  return { ok: true, skipped: true, reason: lastError?.message || 'AI review unavailable' };
}
