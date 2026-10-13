import { Quote, UserCheck, Cpu, Plug, Layers3, CloudRain, Lock } from 'lucide-react'
import Reveal from '../Reveal'
import Sparkline from '../../twin/Sparkline'

const CITES = [
  ['soil.soilMoisture', '13.2 % VWC', 'plot B2 twin state · farmSensor:soilMoisture', '2026-09-27 08:41Z'],
  ['signals.rainfall.forecast.total7d', '4.6 mm', 'open-meteo forecast · farm coordinates', '2026-09-27 07:00Z'],
  ['series.soilMoisture[0]', '21 % VWC', 'plot B2 twin state · 7-day series', '2026-09-21'],
]

export default function Features() {
  return (
    <section id="features" className="section features">
      <div className="container">
        <div className="sec-head">
          <Reveal><span className="eyebrow">What the desk guarantees</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">Trust is built in, not bolted on.</h2></Reveal>
          <Reveal delay={0.16}><p className="lead">Five properties the officer can rely on, every draft, every farm.</p></Reveal>
        </div>
        <div className="bento">
          <Reveal className="b-card b-chat">
            <div className="b-img"><img src="/images/farmer-field.jpg" alt="" loading="lazy" /></div>
            <div className="b-content">
              <span className="b-icon"><Quote size={20} /></span>
              <h3 className="h3">Every number cited</h3>
              <p className="muted">A draft is not a paragraph; it is a message plus a citation list. Field, value and unit, source, and the time it was observed. No citation, no approval.</p>
              <ol className="cites compact" style={{ marginTop: 14 }}>
                {CITES.map(([f, v, s, t]) => (
                  <li key={f}><code className="cite-field">{f}</code><b className="cite-val">{v}</b><span className="cite-src">{s}</span><span className="cite-ts">{t}</span></li>
                ))}
              </ol>
            </div>
          </Reveal>
          <Reveal className="b-card" delay={0.08}>
            <span className="b-icon"><UserCheck size={20} /></span>
            <h3 className="h3">Named-officer gate</h3>
            <p className="muted">The agent never contacts a farmer. A draft waits at the gate until an officer from the roster approves or rejects it, by name, with a reason that is logged.</p>
            <div className="b-flags"><span className="chip amber"><Lock size={12} />awaiting officer</span><span className="chip">approved · Amina Wekesa</span></div>
          </Reveal>
          <Reveal className="b-card" delay={0.16}>
            <span className="b-icon"><Cpu size={20} /></span>
            <h3 className="h3">Open-weights model, data stays in-country</h3>
            <p className="muted">Drafting runs on an open-weights model (Gemma or Qwen) via OpenRouter today and Ollama on a ministry server tomorrow. Nothing in the twin has to leave the country to be useful.</p>
            <div className="b-row"><span>Gemma 4</span><span>Qwen</span><span>Ollama-ready</span></div>
          </Reveal>
          <Reveal className="b-card" delay={0.08}>
            <span className="b-icon"><Plug size={20} /></span>
            <h3 className="h3">Extensible MCP server</h3>
            <p className="muted">AgriTwin exposes the twin as MCP tools. Bring your own crop profile (maize, beans) or data adapter (a county soil lab, a probe vendor) without touching the agent.</p>
            <div className="b-row"><span>get_plot</span><span>evaluate_rules</span><span>draft_advisory</span></div>
          </Reveal>
          <Reveal className="b-card" delay={0.16}>
            <span className="b-icon"><Layers3 size={20} /></span>
            <h3 className="h3">One twin per farm, many farms per office</h3>
            <p className="muted">Register a farm with its coordinates and 1–3 plots; it gets its own twin, its own rainfall feed and its own queue. The desk shows every farm at once.</p>
            <div className="b-row"><span>F-001 · 6 plots</span><span>+ register</span><span>per-farm queue</span></div>
          </Reveal>
          <Reveal className="b-card" delay={0.24}>
            <span className="b-icon"><CloudRain size={20} /></span>
            <h3 className="h3">Rule engine before the model</h3>
            <p className="muted">Deterministic agronomy bands decide the action; the model only writes it up. Stale probe? The engine refuses and raises a flag instead of guessing.</p>
            <div className="b-spark"><Sparkline data={[21, 19.4, 17.9, 16.5, 15.2, 14.1, 13.2]} color="#fbbf24" w={260} h={46} /><span>B2 moisture 21% → 13.2% · rule: irrigate</span></div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
