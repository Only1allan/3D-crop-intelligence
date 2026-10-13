import Reveal from '../Reveal'

const ITEMS = [
  { k: '1', v: 'season', t: 'From the first rains to harvest', d: 'A twin tracks each plot through planting, initiation, bulking and maturation so advice matches the stage.', a: 'farmZone:growthStage' },
  { k: '~15', v: 'min', t: 'Per household cluster, by hand', d: 'What an officer spends drafting one advisory today; the agent drafts in seconds, with sources.', a: 'draft_advisory' },
  { k: '1', v: 'officer', t: 'Decides. Always.', d: 'Nothing is sent without a named approval; a rejection needs a reason. Both are in the audit log.', a: 'decide_advisory' },
  { k: '100%', v: 'cited', t: 'Every number has a source', d: 'Field, value, unit, source and observation time travel with the draft to the officer.', a: 'citations[]' },
  { k: '7', v: 'days', t: 'Live rainfall window', d: 'Past 7 days and 7-day forecast for the farm’s coordinates from Open-Meteo, on every run.', a: 'signals.rainfall' },
  { k: '0', v: 'sent', t: 'Dispatch is simulated', d: 'Approvals produce a labelled, simulated SMS/USSD record. No real message reaches anyone during the demo.', a: 'dispatch.simulated' },
]

export default function Metrics() {
  return (
    <section className="section metrics" style={{ paddingTop: 40 }}>
      <div className="container">
        <div className="sec-head">
          <Reveal><span className="eyebrow">By the numbers</span></Reveal>
          <Reveal delay={0.08}><h2 className="h2">One season. Fifteen minutes back. The officer decides.</h2></Reveal>
        </div>
        <div className="metric-grid">
          {ITEMS.map((m, i) => (
            <Reveal key={m.t} delay={(i % 3) * 0.08} className="metric card">
              <div className="metric-k">{m.k}</div>
              <div className="metric-v">{m.v}</div>
              <h3 className="h3">{m.t}</h3>
              <p className="muted">{m.d}</p>
              <code>{m.a}</code>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
