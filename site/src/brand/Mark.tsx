/** The Pill O: the island as a ring. Masters live in assets/brand/ at the repo root. */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={(size * 50) / 84}
      viewBox="8 25 84 50"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M33 25H67A25 25 0 0 1 92 50A25 25 0 0 1 67 75H33A25 25 0 0 1 8 50A25 25 0 0 1 33 25ZM34 42H66A8 8 0 0 1 74 50A8 8 0 0 1 66 58H34A8 8 0 0 1 26 50A8 8 0 0 1 34 42Z"
      />
    </svg>
  )
}

/** The mark beside the name, as the menu bar sets it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark ${className ?? ''}`}>
      <Mark className="wordmark-mark" />
      <span>Just Notch</span>
    </span>
  )
}

/** The lowercase "notch" drawn in strokes, its o the ring: the footer's display wordmark. */
export function NotchWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="3.5 11.5 237 69" className={className} aria-hidden="true" focusable="false">
      <path
        d="M10 74V46M10 59A13 13 0 0 1 36 59V74M72 46H86A14 14 0 0 1 100 60A14 14 0 0 1 86 74H72A14 14 0 0 1 58 60A14 14 0 0 1 72 46ZM129 28V64A10 10 0 0 0 139 74H143M121 46H143M186.9 50.1A14 14 0 1 0 186.9 69.9M208 74V18M208 59A13 13 0 0 1 234 59V74"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
