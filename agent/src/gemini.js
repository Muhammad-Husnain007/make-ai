import { GoogleGenAI } from '@google/genai';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableAi = (error) => /UNAVAILABLE|503|high demand|RESOURCE_EXHAUSTED|429|overloaded/i.test(error?.message || String(error || ''));

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

function stackFocus(issue, event) {
  const text = `${issue.culprit || ''}\n${event.stack || ''}`;
  const match = text.match(/([^/\\]+\.(?:js|jsx|mjs|cjs)):(\d+)(?::\d+)?/i);
  if (!match) return 'Change only the crashing line or the smallest unique snippet.';
  return `The crash points at ${match[1]} line ${match[2]}. Edit only that line or the smallest unique snippet around it.`;
}

export async function analyzeWithGemini({ issue, event, contextFiles, repo, base }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const preferred = (process.env.PRIMARY_GEMINI_MODEL || 'gemini-3.6-flash').replace(/^models\//, '');
  const models = [...new Set([preferred, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'])];
  const ai = new GoogleGenAI({ apiKey });
  const allowedPaths = contextFiles.map((file) => file.path);
  const prompt = `You are Pulse, a production incident agent.
The files below are the current source that crashed.
${stackFocus(issue, event)}
A pull request will be opened against GitHub \`${repo}\` branch \`${base}\`.

Return ONLY JSON:
{
  "summary": "one paragraph",
  "rootCause": "technical cause",
  "solution": "what you changed and why",
  "prBody": "markdown PR description",
  "files": [{
    "path": "exact/path/from/the/list.js",
    "edits": [{ "old": "exact original snippet copied from the file", "new": "the same snippet with only the bug fixed" }]
  }]
}

Rules:
- Only edit these exact paths: ${JSON.stringify(allowedPaths)}
- Do NOT return full file contents. Return tiny search/replace edits only.
- "old" must match the file text exactly, including spaces.
- Change only the failing line or the smallest unique snippet. One or two edits is enough.
- Do not reformat, rename unrelated symbols, reorder imports, or rewrite the rest of the file.
- Do not add markdown, incident notes, or new files.
- Pulse will name the pull request fixed/issue-name from the issue title.
- If you cannot make a safe one-line/small-hunk fix, return files: [] and explain in solution.

Issue title: ${issue.title}
Culprit: ${issue.culprit || 'n/a'}
Level: ${issue.level}
URL: ${event.url || 'n/a'}
Environment: ${event.environment || 'n/a'}
Stack:
${event.stack || issue.title}

Client source files:
${JSON.stringify(contextFiles.map((file) => ({ path: file.path, contents: file.contents.slice(0, 16000) })))}`;

  let lastError;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        return parseJsonObject(response.text || '');
      } catch (error) {
        lastError = error;
        if (!isRetryableAi(error) && !/NOT_FOUND|404/i.test(error?.message || '')) throw error;
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}
