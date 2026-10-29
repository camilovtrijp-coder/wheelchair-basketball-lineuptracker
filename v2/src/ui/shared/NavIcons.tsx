import type { ComponentChildren } from 'preact';

export type NavIconName = 'roster' | 'game' | 'stats' | 'trends' | 'history';

// Decoratieve iconen (aria-hidden): het label ernaast is de toegankelijke naam.
// Paden volgen de v1-iconenset (lijn-iconen, 24x24, stroke currentColor).
const PATHS: Record<NavIconName, ComponentChildren> = {
  roster: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.3c2.2.7 3.5 2.7 3.5 5.7" />
    </>
  ),
  game: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </>
  ),
  stats: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M9 17v-5" />
      <path d="M13 17V8" />
      <path d="M17 17v-3" />
    </>
  ),
  trends: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="app-nav__icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
