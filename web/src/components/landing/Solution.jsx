import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, Cpu, MessagesSquare, Bot, Quote, UserCheck, ArrowRight, Radio, Leaf, Layers3 } from 'lucide-react'
import Reveal from '../Reveal'
import seed from '../../mock/farm_demo.json'
import { normalizePlot } from '../../state/TwinContext'

const FarmScene = lazy(() => import('../../three/FarmScene'))
const PREVIEW_PLOTS = seed.plots.map(normalizePlot)

const LAYERS = [
  { n: '01', icon: Database, t: 'Ingestion', d: 'A digital twin per farm: plot records, household and contact method, rainfall from Open-Meteo for the farm’s coordinates, and pest bulletins, all exposed as tools by our AgriTwin MCP server.', tags: ['Plot twin state', 'Open-Meteo rainfall', 'Pest bulletins', 'MCP tools'] },
  { n: '02', icon: Cpu, t: 'Processing', d: 'A deterministic rule engine reads the twin first. Only then does the LangGraph agent draft a cited, SMS-length advisory per plot. It refuses when readings are stale.', tags: ['Rule engine', 'LangGraph agent', 'Citation per number', 'Refuses stale data'] },
  { n: '03', icon: MessagesSquare, t: 'Communication', d: 'The draft stops at the officer gate. A named officer approves or rejects; only then is it sent by SMS, USSD or a visit note. Nothing leaves without a named approval. Dispatch is simulated today.', tags: ['Officer approval', 'SMS / USSD / visit', 'Audit log', 'Simulated send'] },
]
const STEPS = [
  { icon: Bot, t: 'Agent drafts', d: 'Gathers the twin, cross-checks the rules, writes the message.' },
  { icon: Quote, t: 'Officer reads the citations', d: 'Every number links to a field, a source and a timestamp.' },
  { icon: UserCheck, t: 'Officer decides', d: 'Approve → simulated SMS/USSD. Reject → reason logged. Always by name.' },
]

function useInView(ref) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { rootMargin: '0px' })
    ref.current && io.observe(ref.current)
    return () => io.disconnect()
  }, [ref])
  return v
}

export default function Solution() {
  const box = useRef(null)
  const inView = useInView(box)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { if (inView) setMounted(true) }, [inView])
  return (
    <section id="solution" className="section solution">
      <div className="sol-bg"><img src="/images/aerial-farm.jpg" alt="" loading="lazy" /></div>
      <div className="container">
        <div className="sec-head center">
          <Reveal><span className="eyebrow">Our solution</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">A twin for every farm the office serves.<br /><span className="grad-text">Built in three layers.</span></h2></Reveal>
          <Reveal delay={0.16}><p className="lead" style={{ margin: '22px auto 0' }}>The agent proposes. The officer disposes. The audit log remembers who did what, and from which reading.</p></Reveal>
        </div>

        <div className="layers">
          {LAYERS.map((l, i) => (
            <Reveal key={l.t} delay={i * 0.15} className="layer card">
              <div className="layer-top"><span className="layer-n">{l.n}</span><span className="layer-icon"><l.icon size={22} /></span></div>
              <h3 className="h3">{l.t}</h3>
              <p className="muted">{l.d}</p>
              <div className="layer-tags">{l.tags.map((t) => <span key={t} className="chip gray">{t}</span>)}</div>
              {i < 2 && <div className="flow" aria-hidden="true"><i /><i /><i /></div>}
            </Reveal>
          ))}
        </div>

        <Reveal className="preview" style={{ marginTop: 72 }}>
          <div className="preview-frame" ref={box}>
            {mounted ? (
              <Suspense fallback={<div className="preview-ph" />}>
                <FarmScene plots={PREVIEW_PLOTS} interactive={false} autoRotate showLabels paused={!inView} maxDpr={1.5} />
              </Suspense>
            ) : <div className="preview-ph" />}
            <div className="preview-overlay">
              <div className="po-top">
                <span className="chip"><span className="live-dot" />One farm twin · six plots · six households · rendered in your browser</span>
                <div className="po-legend">
                  <span><Radio size={13} />probes stream to the weather hub</span>
                  <span><Leaf size={13} />crop colour follows NDVI</span>
                  <span><Layers3 size={13} />pulsing plots have a draft waiting</span>
                </div>
              </div>
              <Link to="/twin" className="btn btn-primary po-cta">Open the live twin <ArrowRight size={18} className="arrow" /></Link>
            </div>
          </div>
        </Reveal>

        <div className="steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.12} className="step">
              <span className="step-n">{i + 1}</span>
              <s.icon size={22} className="accent" />
              <div><b>{s.t}</b><span>{s.d}</span></div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
