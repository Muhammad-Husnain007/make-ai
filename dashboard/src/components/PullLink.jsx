import { GitPullRequest } from 'lucide-react';

export function PullLink({ url, className = '' }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex items-center gap-1 break-all text-emerald-300 hover:underline ${className}`}
    >
      <GitPullRequest size={12} />
      {url}
    </a>
  );
}
