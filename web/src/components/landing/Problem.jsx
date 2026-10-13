import { motion } from 'framer-motion'
import { CloudRain, Bug, Timer, FileSpreadsheet, CloudSun, NotebookPen, MessageSquareWarning } from 'lucide-react'
import Reveal from '../Reveal'

const QUESTIONS = [
  { icon: CloudRain, q: 'Monday: the rainfall shifted.', d: 'The long-rains forecast moved by a week overnight. Which of 40 households should change their planting date, and which should hold?' },
  { icon: Bug, q: '6 am: a pest alert on WhatsApp.', d: 'A late-blight bulletin lands in the group chat. Which plots are at the susceptible stage, under a wet canopy, right now?' },
  { icon: Timer, q: '15 minutes per household cluster.', d: 'Each advisory is typed by hand from a notebook, a lab PDF and memory. Nobody can check what number it was based on afterwards.' },
]
const STATS = [
  { v: '40%', l: 'of global crop production is lost to plant pests and diseases every year', s: 'FAO, 2019' },
  { v: '70%', l: 'of the world’s freshwater withdrawals go to agriculture', s: 'FAO AQUASTAT' },
  { v: '1/3', l: 'of the world’s food is grown on small farms with the least access to advisory services', s: 'FAO, 2021' },
]
const SHARDS = [
  { icon: FileSpreadsheet, t: 'Soil lab PDF', s: 'pH 5.1 · filed in 2024', x: -150, y: -90, r: -8 },
  { icon: CloudSun, t: 'Weather app', s: '31 mm · no plot context', x: 160, y: -60, r: 7 },
  { icon: NotebookPen, t: 'Visit notebook', s: '“pump shared, dry spell?”', x: -120, y: 110, r: 6 },
  { icon: MessageSquareWarning, t: 'WhatsApp bulletin', s: 'late blight · 06:02', x: 150, y: 120, r: -6 },
]

export default function Problem() {
  return (
    <section id="problem" className="section problem">
      <div className="container">
        <div className="sec-head">
          <Reveal><span className="eyebrow">The problem</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">One officer. Hundreds of households.<br /><span className="muted">The week decides the season, and it is run by hand.</span></h2></Reveal>
        </div>

        <div className="problem-grid">
          <div className="problem-photos">
            <Reveal className="pp pp-1"><img src="/images/woman-planting.jpg" alt="A woman planting seedlings in a field" loading="lazy" /></Reveal>
            <Reveal className="pp pp-2" delay={0.15}><img src="/images/carrying-toddler.jpg" alt="Farmers working a plot by hand" loading="lazy" /></Reveal>
            <Reveal className="pp pp-3" delay={0.3}><img src="/images/grass-bundle.jpg" alt="A farmer carrying a bundle of harvested crop" loading="lazy" /></Reveal>
            <div className="pp-badge glass"><span className="dot warning" />No single view of the farms</div>
          </div>
          <div className="problem-qs">
            {QUESTIONS.map((x, i) => (
              <Reveal key={x.q} delay={i * 0.1} className="pq card">
                <span className="pq-icon"><x.icon size={20} /></span>
                <div><h3 className="h3">{x.q}</h3><p className="muted">{x.d}</p></div>
                <span className="pq-mark">?</span>
              </Reveal>
            ))}
            <Reveal delay={0.3}>
              <p className="problem-note">The cost is late advice, generic advice, and advice nobody can trace back to a reading. The officer carries the risk alone.</p>
            </Reveal>
          </div>
        </div>

        <div className="scatter-wrap">
          <Reveal className="scatter-copy">
            <h3 className="h3" style={{ fontSize: 28 }}>The data exists. <span className="accent">In fragments.</span></h3>
            <p className="muted">Plot records in a notebook, rainfall in an app, pest bulletins in a chat group. Nothing joins them per household, and nothing drafts the message with <b style={{ color: '#fff' }}>its sources attached</b>.</p>
          </Reveal>
          <div className="scatter">
            <div className="scatter-core"><span>?</span></div>
            {SHARDS.map((s, i) => (
              <motion.div key={s.t} className="shard glass"
                initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
                whileInView={{ x: s.x, y: s.y, opacity: 1, rotate: s.r }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ delay: 0.2 + i * 0.12, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
                <s.icon size={18} className="accent" />
                <div><b>{s.t}</b><span>{s.s}</span></div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="stats">
          {STATS.map((s, i) => (
            <Reveal key={s.v} delay={i * 0.1} className="stat">
              <div className="stat-v grad-text">{s.v}</div>
              <p>{s.l}</p>
              <span>{s.s}</span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
