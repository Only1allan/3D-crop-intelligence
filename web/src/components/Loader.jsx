import Logo from './Logo'
export default function Loader({ label = 'Loading', sub }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#000', zIndex: 50 }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 18 }}>
        <div style={{ position: 'relative', width: 64, height: 64, display: 'grid', placeItems: 'center' }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(74,222,128,.15)', borderTopColor: 'var(--green)', animation: 'spin 1s linear infinite' }} />
          <Logo size={30} mark />
        </div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{sub}</div>}
      </div>
    </div>
  )
}
