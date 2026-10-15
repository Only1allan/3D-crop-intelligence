import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Check, X, MessageCircle, Radio, Cpu, ScanLine, ShieldCheck, FlaskConical, CloudRain, Bug, Send, Boxes } from 'lucide-react'
import Reveal from '../Reveal'

const ROWS = [
  ['A chatbot that answers the farmer directly', 'An agent that drafts for the officer, who decides'],
  ['Advice with no trace of where the number came from', 'A citation on every number: field, source, timestamp'],
  ['One dashboard per farm, no overview', 'One twin per farm, one desk for the whole office'],
  ['Model picks the action', 'Rule engine picks the action; the model writes it up; stale data is refused'],
  ['Closed APIs, data leaves the country', 'Open-weights model, extensible MCP server, Ollama-ready'],
]

export function Compare() {
  return (
    <section className="section compare">
      <div className="container">
        <div className="sec-head center">
          <Reveal><span className="eyebrow">Why we are different</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">Assistants talk to farmers.<br /><span className="grad-text">We back the officer.</span></h2></Reveal>
        </div>
        <Reveal className="cmp card">
          <div className="cmp-head"><span>Farmer-facing chatbots</span><span className="accent">FarmVerse · Advisory Desk</span></div>
          {ROWS.map(([a, b], i) => (
            <motion.div key={a} className="cmp-row" initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
              <span className="cmp-a"><X size={16} />{a}</span>
              <span className="cmp-b"><Check size={16} />{b}</span>
            </motion.div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

const TRUTH = [
  { icon: FlaskConical, t: 'Plot values are synthetic, on the real schema', d: 'Soil, pH, NDVI and crop numbers are demo data keyed by the real farmSensor / farmZone attribute names, so a real probe can drop in without renaming. No sensor bluffing.' },
  { icon: CloudRain, t: 'Rainfall is live', d: 'Past 7 days and the 7-day forecast come from Open-Meteo for the farm’s coordinates on every agent run, through a borrowed MCP server.' },
  { icon: Bug, t: 'Pest bulletins are synthetic', d: 'The late-blight bulletin is a hand-written fixture shaped like a county plant-health alert.' },
  { icon: Send, t: 'Dispatch is simulated', d: 'Approving a draft writes a labelled “simulated dispatch” record. No SMS or USSD message is actually sent to anyone.' },
]
export function Honesty() {
  return (
    <section id="honesty" className="section honesty">
      <div className="container">
        <div className="hon card">
          <div className="hon-left">
            <ShieldCheck size={34} className="accent" />
            <h2 className="h2" style={{ fontSize: 'clamp(28px,3.2vw,40px)' }}>What is real today.</h2>
            <p className="muted">Labelled truthfully, on screen and here. The agent, the rule engine, the citations, the officer gate and the audit log are real; the plot values are not.</p>
          </div>
          <div className="hon-items">
            {TRUTH.map((x, i) => (
              <Reveal key={x.t} delay={i * 0.1} className="hon-item">
                <x.icon size={20} className="accent" />
                <div><b>{x.t}</b><p className="muted">{x.d}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const ROAD = [
  { icon: MessageCircle, t: 'Real dispatch', d: 'Africa’s Talking SMS/USSD behind the same officer gate; the approval record becomes the send receipt.', tag: 'Next' },
  { icon: Radio, t: 'Live plot ingestion', d: 'County soil-lab results and low-cost probes as AgriTwin data adapters, replacing the synthetic plot values.', tag: 'Phase 2' },
  { icon: Cpu, t: 'More crop profiles', d: 'Maize and beans rule profiles on the same MCP server; officers pick the profile per farm.', tag: 'Phase 2' },
  { icon: Boxes, t: 'In-country inference', d: 'Ollama on a ministry server with the same open-weights model; the twin never leaves the country.', tag: 'Phase 3' },
]
export function Roadmap() {
  return (
    <section id="roadmap" className="section roadmap">
      <div className="container">
        <div className="sec-head">
          <Reveal><span className="eyebrow">Roadmap</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">From one demo farm to every ward office.</h2></Reveal>
        </div>
        <div className="road">
          <div className="road-line"><motion.i initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }} /></div>
          {ROAD.map((r, i) => (
            <Reveal key={r.t} delay={0.2 + i * 0.15} className="road-item">
              <span className="road-dot"><r.icon size={18} /></span>
              <span className="chip gray">{r.tag}</span>
              <h3 className="h3">{r.t}</h3>
              <p className="muted">{r.d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

export function FinalCTA() {
  return (
    <section className="final noise">
      <img src="/images/sprout2.jpg" alt="" className="final-bg" loading="lazy" />
      <div className="container final-inner">
        <Reveal><h2 className="h1" style={{ fontSize: 'clamp(40px,6vw,76px)' }}>Let the agent draft.<br /><span className="grad-text">Keep the decision.</span></h2></Reveal>
        <Reveal delay={0.12}><p className="lead" style={{ margin: '24px auto 0' }}>Runs in any browser. Open the twin, draft an advisory, read the citations, and approve or reject it by name.</p></Reveal>
        <Reveal delay={0.2}>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 36 }}>
            <Link to="/twin" className="btn btn-primary" style={{ height: 60, padding: '0 34px', fontSize: 17 }}>Open the twin <ArrowRight size={20} className="arrow" /></Link>
            <Link to="/desk" className="btn btn-ghost" style={{ height: 60, padding: '0 34px', fontSize: 17 }}>Open the desk</Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
