/** Kelp mark. Colours come from CSS (.logo .mark-*), so it follows the theme. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect className="mark-bg" width="64" height="64" rx="15" />
      <path className="mark-bucket" d="M16 22h32l-4 26a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3z" />
      <ellipse className="mark-rim" cx="32" cy="22" rx="16" ry="5" />
    </svg>
  );
}
