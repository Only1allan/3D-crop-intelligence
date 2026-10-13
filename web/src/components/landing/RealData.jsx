import { Link } from 'react-router-dom'
import { ArrowRight, ScanLine, Sprout, Box } from 'lucide-react'
import Reveal from '../Reveal'

export default function RealData() {
  return (
    <section className="section realdata">
      <div className="container rd-grid">
        <Reveal className="rd-copy">
          <span className="eyebrow">Real 3D, real plants</span>
          <h2 className="h2">The twin’s 3D and 4D pipeline already runs on real data.</h2>
          <p className="lead">Two proofs sit behind the procedural farm. We trained a Gaussian-splat scan on a free GPU, and we replay a real maize plant laser-scanned every day for 12 days as time samples. A scanned field can replace the procedural plots without touching the advisory desk.</p>
          <div className="rd-facts">
            <div><ScanLine size={18} className="accent" /><b>3D Gaussian Splatting</b><span>trained on a free T4 · PSNR 27.3 · public reference capture</span></div>
            <div><Sprout size={18} className="accent" /><b>Pheno4D maize growth</b><span>the same plant, 0.66 m → 3.66 m in 12 daily scans</span></div>
            <div><Box size={18} className="accent" /><b>Composes into the twin</b><span>as layers; plot records and advisories stay untouched</span></div>
          </div>
          <Link to="/lab" className="btn btn-ghost" style={{ marginTop: 28 }}>Explore the real 3D data <ArrowRight size={18} className="arrow" /></Link>
        </Reveal>
        <Reveal className="rd-visual" delay={0.15}>
          <img src="/images/sprout.jpg" alt="Young seedlings emerging from soil" loading="lazy" />
          <div className="rd-growth glass">
            <div className="rd-g-top"><span>Plant height from the scans</span><b>3.66 m</b></div>
            <div className="rd-bars">
              {[0.664, 0.88, 1.15, 1.352, 1.823, 2.486, 2.846, 2.825, 2.965, 3.706, 3.753, 3.66].map((h, i) => (
                <i key={i} style={{ height: `${(h / 3.8) * 100}%`, animationDelay: `${i * 0.08}s` }} title={`day ${i + 1}: ${h} m`} />
              ))}
            </div>
            <div className="rd-g-bot"><span>day 1</span><span>Pheno4D · Uni Bonn / ETH · PLoS ONE 2021</span><span>day 12</span></div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
