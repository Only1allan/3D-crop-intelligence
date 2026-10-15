import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Play, Droplets, FlaskConical, Sprout, ShieldAlert, Bot, UserCheck, Lock, Quote } from 'lucide-react'
import GrowingPlant from './GrowingPlant'

const DRAFTS = [
  { plot: 'B2 · South Slope · Mary Wairimu', action: 'IRRIGATE', cls: 'blue', msg: 'Mary, South Slope: soil moisture is 13.2% (below 18%) during tuber initiation and no useful rain is forecast this week. Irrigate within 2 days if the shared pump is available.', cites: 3, officer: 'Amina Wekesa', verdict: 'Approved · simulated SMS' },
  { plot: 'A3 · East Valley · Grace Achieng', action: 'SPRAY', cls: 'red', msg: 'Grace, East Valley: late-blight risk is HIGH (humidity 92%, 14 mm rain). Spray a protectant fungicide within 24 h and scout lower leaves for brown lesions.', cites: 4, officer: 'Amina Wekesa', verdict: 'Approved · simulated SMS' },
  { plot: 'B1 · River Flats · Samuel Mwangi', action: 'HARVEST', cls: 'lime', msg: 'Samuel, River Flats: crop is at day 96, maturing normally. Cut the haulms in 10-14 days and plan harvest around early October.', cites: 3, officer: 'Joseph Kariuki', verdict: 'Rejected · "labour already booked, I will visit"' },
]

function DraftDemo() {
  const [i, setI] = useState(0)
  const [phase, setPhase] = useState(0) // 0 drafting, 1 draft shown, 2 decided
  useEffect(() => {
    const t = [setTimeout(() => setPhase(1), 1400), setTimeout(() => setPhase(2), 4600), setTimeout(() => { setPhase(0); setI((x) => (x + 1) % DRAFTS.length) }, 8600)]
    return () => t.forEach(clearTimeout)
  }, [i])
  const d = DRAFTS[i]
  const ok = d.verdict.startsWith('Approved')
  return (
    <div className="hero-chat glass">
      <div className="hc-head">
        <span className="hc-av"><Bot size={14} /></span>
        <div><b>Agent draft · officer gate</b><span>{d.plot}</span></div>
        <span className="chip" style={{ marginLeft: 'auto' }}><span className="live-dot" />drafting</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={i} className="hc-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {phase === 0 && <div className="hc-typing"><i /><i /><i /></div>}
          {phase >= 1 && (
            <motion.div className="hc-a" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <span className={`chip action ${d.cls}`} style={{ marginBottom: 8 }}>{d.action}</span>
              {d.msg}
              <span className="hc-tag"><Quote size={11} /> {d.cites} citations · {d.msg.length}/320 chars</span>
            </motion.div>
          )}
          {phase === 2 && (
            <motion.div className={`hc-q hc-decision ${ok ? 'ok' : 'no'}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <UserCheck size={14} /> {d.officer}: {d.verdict}
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="hc-input"><Lock size={15} /><span>Nothing leaves without a named officer's approval</span></div>
    </div>
  )
}

const CHIPS = [
  { icon: FlaskConical, label: 'Soil pH', v: '5.1', note: 'lime · cited', cls: 'amber', style: { top: '15%', left: '52%' }, d: 0.9 },
  { icon: Droplets, label: 'Moisture', v: '13.2%', note: 'irrigate · cited', cls: 'amber', style: { top: '37%', right: '4%' }, d: 1.1 },
  { icon: Sprout, label: 'Rain, 7 days', v: '31 mm', note: 'Open-Meteo', cls: '', style: { top: '31%', left: '61%' }, d: 1.3 },
  { icon: ShieldAlert, label: 'Blight risk', v: 'HIGH', note: 'spray · awaiting officer', cls: 'red', style: { top: '12%', right: '8%' }, d: 1.5 },
]

export default function Hero({ onPlay }) {
  return (
    <section className="hero noise">
      <div className="hero-img">
        <img src="/images/farmer-field.jpg" alt="A farmer inspecting his crop in a green field" fetchPriority="high" />
      </div>
      <div className="hero-glow" />
      <GrowingPlant className="hero-plant" />
      {CHIPS.map((c) => (
        <motion.div key={c.label} className={`data-chip ${c.cls}`} style={c.style}
          initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: c.d, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
          <c.icon size={16} />
          <div><span>{c.label}</span><b>{c.v}</b></div>
          <em>{c.note}</em>
        </motion.div>
      ))}
      <div className="container hero-inner">
        <motion.div className="hero-copy" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.12 } } }}>
          <motion.span className="eyebrow" variants={fade}>FarmVerse Crop Intelligence</motion.span>
          <motion.h1 className="h1" variants={fade}>Your office's farms, digitized.<br /><span className="grad-text">Advisories drafted, never sent without you.</span></motion.h1>
          <motion.p className="lead" variants={fade}>
            One digital twin per farm the extension office serves. An agent drafts a climate-smart advisory for every plot, with a citation on every number.
            A named officer approves or rejects before anything reaches a household.
          </motion.p>
          <motion.div className="hero-ctas" variants={fade}>
            <Link to="/twin" className="btn btn-primary">Open the twin <ArrowRight size={18} className="arrow" /></Link>
            <Link to="/desk" className="btn btn-ghost">Open the desk</Link>
          </motion.div>
          <motion.div className="hero-trust" variants={fade}>
            <span><b>LangGraph</b> agent</span>
            <span><b>AgriTwin</b> MCP server</span>
            <span><b>Open-weights</b> model</span>
            <span><b>Open-Meteo</b> rainfall</span>
          </motion.div>
        </motion.div>
        <motion.div className="hero-chat-wrap" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 1, ease: [0.22, 1, 0.36, 1] }}>
          <DraftDemo />
        </motion.div>
      </div>
      <div className="scroll-cue"><span /></div>
    </section>
  )
}
const fade = { h: { opacity: 0, y: 26 }, s: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } } }
