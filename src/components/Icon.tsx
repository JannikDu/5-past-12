type IconName = 'arrow-right' | 'arrow-down' | 'arrow-up' | 'arrow-left' | 'arrow-up-right' | 'search' | 'close' | 'reset' | 'chevron-down' | 'check';

const paths: Record<IconName, string> = {
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  'arrow-down': 'M12 4v16m-6-6 6 6 6-6',
  'arrow-up': 'M12 20V4m-6 6 6-6 6 6',
  'arrow-left': 'M20 12H4m6-6-6 6 6 6',
  'arrow-up-right': 'M6 18 18 6M6 6h12v12',
  search: 'm16 16 4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12M6 18 18 6',
  reset: 'M4 10a8 8 0 1 1 1 7M4 4v6h6',
  'chevron-down': 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
};

export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" width="18" height="18" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}
