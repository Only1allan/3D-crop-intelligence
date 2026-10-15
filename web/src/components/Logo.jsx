export default function Logo({ size = 28, mark = false }) {
  const icon = (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bef264" /><stop offset="1" stopColor="#22c55e" /></linearGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="none" stroke="url(#lg)" strokeWidth="3" strokeDasharray="4 5" opacity=".55" />
      <path d="M32 50V29" stroke="url(#lg)" strokeWidth="4" strokeLinecap="round" />
      <path d="M32 33c0-10 7-16 17-17 0 10-7 17-17 17z" fill="url(#lg)" />
      <path d="M32 39c0-8-6-13-14-14 0 8 6 14 14 14z" fill="#22c55e" />
    </svg>
  )
  if (mark) return icon
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 600, letterSpacing: '-0.01em' }}>
      {icon}
      <span style={{ lineHeight: 1.05, fontSize: 15 }}>
        Crop<span style={{ color: 'var(--green)' }}>Intelligence</span>
        <span style={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', color: 'var(--text-3)', textTransform: 'uppercase' }}>FarmVerse</span>
      </span>
    </span>
  )
}
