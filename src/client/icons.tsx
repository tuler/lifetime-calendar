// Four inline glyphs. Kept as source rather than an icon package so the client
// kepps no runtime dependency, and so they inherit `currentColor` from the
// element they sit in.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function CalendarIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base} strokeWidth={2.25}>
      <path d="M20 6.5 9.5 17 4 11.5" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H17" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * The Life Time wordmark, inlined from their own `life-time-logo-xs.svg` rather
 * than hotlinked, so the page makes no third-party request. Filled with
 * `currentColor` so it follows the theme; their brand gray is #A2AAAD, which is
 * what `--muted` resolves to in dark mode.
 */
export function LifeTimeLogo() {
  return (
    <svg
      className="logo"
      viewBox="0 0 94 20"
      role="img"
      aria-label="Life Time"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M10,15v5H0V0h5v15H10z M11,0v20h5V0H11z M27,5V0H17v20h5v-8h4V8h-4V5H27z M38,5V0H28v20h10v-5h-5v-3h4V8h-4 V5H38z M88,5V0H78v20h10v-5h-5v-3h4V8h-4V5H88z M41,0v5h3v15h5V5h3V0H41z M53,0v20h5V0H53z M72,0h-2.5L68,10L66.5,0H64h-5v20h5V9 l2,11h4l2-11v11h5V0H72z M91.5,0C90.1,0,89,1.1,89,2.5S90.1,5,91.5,5S94,3.9,94,2.5S92.9,0,91.5,0z M91.5,4.6c-1.2,0-2.1-1-2.1-2.1 s1-2.1,2.1-2.1s2.1,1,2.1,2.1S92.7,4.6,91.5,4.6z M91.9,2.7c0.2,0,0.4-0.1,0.5-0.2c0.1-0.1,0.2-0.3,0.2-0.6c0-0.3-0.1-0.5-0.3-0.6 C92.3,1.1,92,1,91.7,1h-1.1V4H91V2.7h0.5L92.3,4h0.5L91.9,2.7z M91.5,2.3H91V1.4h0.6c0.1,0,0.2,0,0.2,0c0.1,0,0.1,0,0.2,0.1 c0.1,0,0.1,0.1,0.1,0.1c0,0.1,0.1,0.1,0.1,0.2c0,0.1,0,0.2-0.1,0.3c0,0.1-0.1,0.1-0.2,0.1c-0.1,0-0.2,0.1-0.2,0.1 C91.7,2.3,91.6,2.3,91.5,2.3z"
      />
    </svg>
  );
}
