export const CLIENT_MAINTENANCE_MESSAGE = 'This issue is currently under maintenance. Pulse is working on a fix.';

function hasHiddenAgentError(issue) {
  return Boolean(issue?.agent_error) || issue?.agent_status === 'failed';
}

export function presentIssue(issue, { admin = false } = {}) {
  if (!issue) return null;
  const { agent_pipeline, ...rest } = issue;
  if (admin) {
    return { ...rest, agent_pipeline: undefined };
  }
  const hidden = hasHiddenAgentError(rest) && !rest.pr_url;
  return {
    ...rest,
    agent_error: undefined,
    agent_pipeline: undefined,
    agent_status: hidden ? 'maintenance' : rest.agent_status === 'failed' ? 'done' : rest.agent_status,
    agent_summary: hidden ? CLIENT_MAINTENANCE_MESSAGE : rest.agent_summary,
    agent_solution: hidden ? CLIENT_MAINTENANCE_MESSAGE : rest.agent_solution,
  };
}
