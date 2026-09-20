import { Ban, CheckCircle2, CircleDot, GitMerge, GitPullRequest } from 'lucide-react';

export const ISSUE_VIEWS = [
  { id: 'open', label: 'Open issues', to: '/', stat: 'openIssues', icon: CircleDot, empty: 'No open issues yet. Connected apps will appear here when they report errors.' },
  { id: 'fixed', label: 'Fixed issues', to: '/fixed', stat: 'fixedIssues', icon: CheckCircle2, empty: 'No AI-fixed issues yet.' },
  { id: 'create-pull', label: 'Open pull | PR', to: '/pulls', stat: 'createPull', icon: GitPullRequest, empty: 'No open pull requests yet.' },
  { id: 'merge-pull', label: 'Merge pull', to: '/merged', stat: 'mergePull', icon: GitMerge, empty: 'No merged pull requests yet.' },
];

export const DROPDOWN_VIEWS = [
  ...ISSUE_VIEWS,
  { id: 'closed-pull', label: 'Closed PR', to: '/closed', stat: 'closedPull', icon: Ban, empty: 'No closed pull requests yet.' },
];

export function viewPath(id) {
  return DROPDOWN_VIEWS.find((item) => item.id === id)?.to || '/';
}
