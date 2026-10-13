import { lazy, Suspense, useState } from 'react'
import { ExternalLink, Sprout, ScanLine, Trees, Film } from 'lucide-react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import './lab.css'

const PhenoViewer = lazy(() => import('../three/PhenoViewer'))

const TABS = [
  { id: 'pheno', icon: Sprout, t: '4D plant growth', badge: 'REAL DATA', d: 'Pheno4D (Uni Bonn / ETH, PLoS ONE 2021): the same maize plant laser-scanned every day for 12 days. Each scan is a USD time sample on one prim, the twin’s 4D mechanic fed with real agricultural data. Height is measured from the scan itself: 0.66 m to 3.66 m.' },
  { id: 'garden', icon: Trees, t: 'Gaussian-splat scan · garden', badge: 'REAL GPU RUN', src: '/twin-assets/viewer-garden/index.html', d: '3D Gaussian Splatting trained on a free Kaggle T4 from the Mip-NeRF 360 “garden” public capture (PSNR 27.3). It proves the field-scan pipeline and converts to OpenUSD. It is not our farm yet.' },
  { id: 'truck', icon: ScanLine, t: 'Gaussian-splat scan · outdoor', badge: 'REAL GPU RUN', src: '/twin-assets/viewer/index.html', d: 'The first real run: the INRIA “truck” public capture, 7k iterations on a free T4 (PSNR 25.0), ~150k splats decoded in your browser.' },
  { id: 'video', icon: Film, t: 'Orbit render (offline backup)', badge: 'VIDEO', d: 'The orbit rendered straight from the trained splats. Plays even without WebGL or internet.' },
]

export default function Lab() {
  const [tab, setTab] = useState('pheno')
  const cur = TABS.find((x) => x.id === tab)
  return (
    <>
      <Nav />
      <main className="lab">
        <div className="container">
          <span className="eyebrow">Real 3D data</span>
          <h1 className="h2" style={{ marginTop: 14 }}>The pipeline behind the twin, <span className="grad-text">running on real captures.</span></h1>
          <p className="lead">The demo farm uses synthetic plot values. The 3D and 4D machinery underneath has already run on real data (first shown at the GoMyCode × NVIDIA Hackathon 2026). Explore it here.</p>
          <div className="lab-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
                <x.icon size={16} />{x.t}
              </button>
            ))}
          </div>
          <div className="lab-stage">
            {tab === 'pheno' && <Suspense fallback={null}><PhenoViewer /></Suspense>}
            {cur.src && <iframe key={cur.id} src={cur.src} title={cur.t} allow="fullscreen" />}
            {tab === 'video' && <video src="/twin-assets/viewer-garden/orbit.mp4" autoPlay muted loop controls playsInline />}
          </div>
          <div className="lab-info">
            <span className="chip">{cur.badge}</span>
            <p className="muted">{cur.d}</p>
            {cur.src && <a className="btn btn-ghost btn-sm" href={cur.src} target="_blank" rel="noreferrer">Open full screen <ExternalLink size={14} /></a>}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
