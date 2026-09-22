export const CLIENT_MAINTENANCE_MESSAGE = 'This issue is currently under maintenance. Pulse is working on a fix.';

function hasHiddenAgentError(issue) {
  return Boolean(issue?.agent_error) || issue?.agent_status === 'failed';
}

export function issueLifecycle(issue) {
  if (!issue) return 'pending';
  if (Number(issue.pr_merged) === 1) return 'merged';
  if (issue.pr_url && String(issue.pr_url).trim() && !Number(issue.pr_closed)) return 'resolved';
  return 'pending';
}

export function presentIssue(issue, { admin = false } = {}) {
  if (!issue) return null;
  const { agent_pipeline, ...rest } = issue;
  const lifecycle = issueLifecycle(rest);
  if (admin) {
    return { ...rest, agent_pipeline: undefined, lifecycle };
  }
  const hidden = hasHiddenAgentError(rest) && !rest.pr_url;
  return {
    ...rest,
    lifecycle,
    agent_error: undefined,
    agent_pipeline: undefined,
    agent_status: hidden ? 'maintenance' : rest.agent_status === 'failed' ? 'done' : rest.agent_status,
    agent_summary: hidden ? CLIENT_MAINTENANCE_MESSAGE : rest.agent_summary,
    agent_solution: hidden ? CLIENT_MAINTENANCE_MESSAGE : rest.agent_solution,
  };
}
