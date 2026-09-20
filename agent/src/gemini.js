import { GoogleGenAI } from '@google/genai';

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

function crashLine(issue, event) {
  const text = `${issue.culprit || ''}\n${event.stack || ''}`;
  const match = text.match(/([^/\\]+\.(?:js|jsx|mjs|cjs)):(\d+)(?::\d+)?/i);
  return {
    file: match?.[1] || '',
    line: match ? Number(match[2]) : 0,
  };
}

function fileWindow(contents, line, radius = 45) {
  const rows = String(contents || '').replace(/\r\n/g, '\n').split('\n');
  if (!line) return { startLine: 1, contents: rows.slice(0, 120).join('\n') };
  const start = Math.max(0, line - radius - 1);
  const end = Math.min(rows.length, line + radius);
  return { startLine: start + 1, contents: rows.slice(start, end).join('\n') };
}

export async function analyzeWithGemini({ issue, event, contextFiles, repo, base }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const preferred = (process.env.PRIMARY_GEMINI_MODEL || 'gemini-3.6-flash').replace(/^models\//, '');
  const models = [...new Set([preferred, 'gemini-3.6-flash', 'gemini-flash-latest'])];
  const ai = new GoogleGenAI({ apiKey });
  const allowedPaths = contextFiles.map((file) => file.path);
  const focus = crashLine(issue, event);
  const snippets = contextFiles.map((file) => ({
    path: file.path,
    ...fileWindow(file.contents, focus.line),
  }));
  const prompt = `You are Pulse. Fix this production crash with a GitHub PR against \`${repo}\` branch \`${base}\`.
${focus.file ? `Crash: ${focus.file} line ${focus.line}.` : 'Fix the smallest crashing snippet.'}

Return ONLY JSON:
{
  "summary": "one paragraph",
  "rootCause": "syntax error or logical bug",
  "solution": "what changed",
  "prBody": "markdown",
  "files": [{
    "path": "exact/path/from/the/list.js",
    "edits": [{ "old": "exact text copied from contents", "new": "that text with only the bug fixed" }]
  }]
}

Rules:
- Handle syntax errors AND logical bugs. Always return files with at least one edit.
- Only edit: ${JSON.stringify(allowedPaths)}
- "old" must be copied from contents, including spaces.
- One or two tiny edits. No rewrites, no extra files, no formatting.

Issue: ${issue.title}
Culprit: ${issue.culprit || 'n/a'}
Stack:
${event.stack || issue.title}

Files:
${JSON.stringify(snippets)}`;

  let lastError;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      return parseJsonObject(response.text || '');
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
          return parseJsonObject(response.text || '');
        } catch (retryError) {
          lastError = retryError;
          if (isMissingModel(retryError)) continue;
        }
      }
    }
  }
  throw lastError;
}
