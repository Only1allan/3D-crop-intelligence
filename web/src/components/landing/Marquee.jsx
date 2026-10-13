const WORDS = ['Citations on every number', 'Named-officer approval', 'Open-Meteo rainfall', 'Pest bulletins', 'Rule engine first', 'LangGraph agent', 'AgriTwin MCP tools', 'Open-weights model', 'Audit log', 'One twin per farm', 'SMS · USSD · visit', 'Simulated dispatch']
export default function Marquee() {
  const row = [...WORDS, ...WORDS]
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {row.map((w, i) => <span key={i}>{w}<i>✦</i></span>)}
      </div>
    </div>
  )
}
