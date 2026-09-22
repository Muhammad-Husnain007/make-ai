export function issueStatus(issue) {
  if (issue?.lifecycle === 'pending' || issue?.lifecycle === 'resolved' || issue?.lifecycle === 'merged') {
    return issue.lifecycle;
  }
  if (Number(issue?.pr_merged) === 1) return 'merged';
  if (issue?.pr_url && String(issue.pr_url).trim() && !Number(issue?.pr_closed)) return 'resolved';
  return 'pending';
}
