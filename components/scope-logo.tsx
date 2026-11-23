/** A shared field of view around three connected project nodes. */
export function ScopeLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M12 4H9a5 5 0 0 0-5 5v3m16-8h3a5 5 0 0 1 5 5v3M4 20v3a5 5 0 0 0 5 5h3m8 0h3a5 5 0 0 0 5-5v-3" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="m11 11 10 5-10 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11" cy="11" r="2.6" fill="currentColor" />
      <circle cx="21" cy="16" r="2.6" fill="currentColor" />
      <circle cx="11" cy="21" r="2.6" fill="currentColor" />
    </svg>
  );
}
