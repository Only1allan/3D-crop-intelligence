import { phBand } from '../lib/status'
// Horizontal pH scale 4.5..7.5 with the potato optimum window 5.5..6.5 marked.
export default function PhGauge({ ph }) {
  const lo = 4.5, hi = 7.5, pct = (v) => ((v - lo) / (hi - lo)) * 100
  const band = phBand(ph)
  return (
    <div className="ph-gauge">
      <div className="ph-top">
        <div><span className="ph-val">{ph.toFixed(1)}</span><span className="ph-unit">pH</span></div>
        <span className={`chip ${band.level === 'nominal' ? '' : 'amber'}`}>{band.text}</span>
      </div>
      <div className="ph-track">
        <div className="ph-opt" style={{ left: pct(5.5) + '%', width: pct(6.5) - pct(5.5) + '%' }}><span>potato optimum</span></div>
        <div className="ph-marker" style={{ left: `calc(${pct(Math.min(hi, Math.max(lo, ph)))}% - 1px)` }} />
      </div>
      <div className="ph-scale"><span>4.5 acidic</span><span>5.5</span><span>6.5</span><span>alkaline 7.5</span></div>
    </div>
  )
}
