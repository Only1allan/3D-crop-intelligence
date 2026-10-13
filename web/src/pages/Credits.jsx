import Nav from '../components/Nav'
import Footer from '../components/Footer'

const IMAGES = [
  ['farmer-field.jpg', 'A farmer tends to his crops in a green field', 'Richard Nyoni', '1AoGjqdyDLU'],
  ['woman-planting.jpg', 'Woman planting during daytime', 'Annie Spratt', 'QYcSeY7vuZM'],
  ['carrying-toddler.jpg', 'Woman carrying toddler at back while planting', 'Annie Spratt', '2INKkSrEmc8'],
  ['woman-grass.jpg', 'Woman holding green grass', 'Annie Spratt', 'm0DUL38R49Y'],
  ['grass-bundle.jpg', 'A man carries a large bundle of grass', 'Lisa Marie Theck', 'uBsAfl1t4dE'],
  ['grain-hands.jpg', 'A woman holding a handful of grain', 'Ali Mkumbwa', 's8Kzx7C6yqo'],
  ['aerial-farm.jpg', 'Aerial view of a farm field with rows of crops', 'Unsplash contributor', 'wZ7DKdf1Hsk'],
  ['aerial-rows.jpg', 'Aerial view of parallel rows of green crops', 'Unsplash contributor', 'pjggRY_zWjA'],
  ['hero-sunset.jpg', 'Rows of green crops in field at sunset', 'Unsplash contributor', 'IQVFVH0ajag'],
  ['sprout.jpg', 'Tiny green sprouts emerge from dark soil', 'Danielle-Claude Bélanger', 'GFzR9qefoRI'],
  ['sprout2.jpg', 'A tiny plant sprouts from the soil', 'Unsplash contributor', 'wBzCEI3ny84'],
]

const TOOLING = [
  ['LangGraph', 'Agent graph: gather → cross-check → draft → await officer → finalise. Pauses at the officer gate until a decision is posted.'],
  ['Model Context Protocol (MCP)', 'Our AgriTwin MCP server exposes the twin, the rule engine, drafting, flags and the audit log as tools; the same tools serve the agent and the REST bridge.'],
  ['chuk-mcp-open-meteo', 'Borrowed MCP server for Open-Meteo. Rainfall archive (ERA5) and forecast for the farm’s coordinates.'],
  ['Open-Meteo', 'Free weather API, no key. The only live external data in the demo.'],
  ['Gemma 4 / Qwen via OpenRouter, Ollama-ready', 'Open-weights drafting model. Provider, model id and an open-weights flag are shown on every draft and in every run trace.'],
  ['FastAPI + SSE', 'REST bridge and the event stream the console subscribes to (status, tool_call, tool_result, llm, draft, awaiting_officer, decision, done).'],
  ['Vite + React + React Three Fiber', 'This console: the 3D farm twin, the advisory tab and the desk.'],
  ['OpenUSD farmSensor / farmZone schema', 'Attribute names the plot values are keyed by, so a real probe can replace the synthetic values without renaming.'],
]

export default function Credits() {
  return (
    <>
      <Nav />
      <main className="container" style={{ padding: '140px 24px 90px' }}>
        <span className="eyebrow">Credits and tooling</span>
        <h1 className="h2">Open tools, open imagery, open data</h1>
        <p className="lead">What the Advisory Desk is built from, and who made the pictures. Earlier work on this twin was first shown at the GoMyCode × NVIDIA Hackathon 2026 as an Omniverse-ready OpenUSD scene; the Lab page keeps that 3D proof.</p>

        <h2 className="h3" style={{ marginTop: 56 }}>Tooling for this build</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 18 }}>
          {TOOLING.map(([t, d]) => (
            <div key={t} className="card" style={{ padding: 16, fontSize: 13.5 }}><b style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>{t}</b><span className="muted">{d}</span></div>
          ))}
        </div>

        <h2 className="h3" style={{ marginTop: 56 }}>Photography</h2>
        <p className="muted" style={{ fontSize: 14.5 }}>Photos are used under the free <a className="accent" href="https://unsplash.com/license" target="_blank" rel="noreferrer">Unsplash License</a>. Thank you to the photographers.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginTop: 24 }}>
          {IMAGES.map(([f, t, a, id]) => (
            <a key={f} href={`https://unsplash.com/photos/${id}`} target="_blank" rel="noreferrer" className="card" style={{ overflow: 'hidden' }}>
              <img src={`/images/${f}`} alt={t} loading="lazy" style={{ height: 160, width: '100%', objectFit: 'cover' }} />
              <div style={{ padding: 14, fontSize: 13 }}><b style={{ fontWeight: 600 }}>{t}</b><div className="muted">Photo by {a} on Unsplash</div></div>
            </a>
          ))}
        </div>
        <h2 className="h3" style={{ marginTop: 56 }}>3D data</h2>
        <ul className="muted" style={{ fontSize: 14.5 }}>
          <li>Pheno4D maize scans: Schunck et al., “Pheno4D: A spatio-temporal dataset of maize and tomato plant point clouds”, PLoS ONE 2021 (University of Bonn / ETH).</li>
          <li>Gaussian-splat captures: INRIA Tanks and Temples “truck”, and Mip-NeRF 360 “garden” public reference scenes, trained on a free Kaggle T4.</li>
          <li>Fonts: Poppins (SIL Open Font License). Icons: Lucide (ISC).</li>
        </ul>
      </main>
      <Footer />
    </>
  )
}
