import { Ban, CheckCircle2, CircleDot, Gauge, GitBranch, GitMerge, GitPullRequest } from 'lucide-react';
import { routes } from './routes.js';

export const ISSUE_VIEWS = [
  { id: 'open', label: 'Open issues', to: routes.errors, stat: 'openIssues', icon: CircleDot, empty: 'No open issues yet. Connected apps will appear here when they report errors.' },
  { id: 'fixed', label: 'Fixed issues', to: routes.errorsResolved, stat: 'fixedIssues', icon: CheckCircle2, empty: 'No AI-fixed issues yet.' },
  { id: 'create-pull', label: 'Open pull | PR', to: routes.pullRequests, stat: 'createPull', icon: GitPullRequest, empty: 'No open pull requests yet.' },
  { id: 'merge-pull', label: 'Merge pull', to: routes.pullRequestsMerged, stat: 'mergePull', icon: GitMerge, empty: 'No merged pull requests yet.' },
];

export const DROPDOWN_VIEWS = [
  ...ISSUE_VIEWS,
  { id: 'closed-pull', label: 'Closed PR', to: routes.pullRequestsClosed, stat: 'closedPull', icon: Ban, empty: 'No closed pull requests yet.' },
];

export const CATEGORY_VIEWS = [
  {
    id: 'performance',
    label: 'Performance optimization',
    to: routes.performance,
    empty: 'No timeout, latency, or slow-endpoint issues yet.',
    blurb: 'Slow responses, timeouts, and latency crashes from connected clients.',
    icon: Gauge,
  },
  {
    id: 'pipelines',
    label: 'CI/CD pipelines',
    to: routes.pipelines,
    empty: 'No CI/CD workflows found in connected GitHub repositories.',
    blurb: 'GitHub Actions workflows and their latest run status.',
    icon: GitBranch,
  },
];

export function viewPath(id) {
  return [...DROPDOWN_VIEWS, ...CATEGORY_VIEWS].find((item) => item.id === id)?.to || routes.errors;
}
