import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Mic, MicOff, Square, Sparkles, AlertTriangle, Server, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import { useTwin } from '../state/TwinContext'
import { ModelChip } from './Advisory'

function chipsFor(plot) {
  const base = ['Which plots need me this week?', 'Why is B2 flagged?', 'What did the forecast say for this zone?', 'Show the audit trail for A3']
  if (!plot) return base
  return [`Why is ${plot.plotId} flagged?`, `Show the audit trail for ${plot.plotId}`, 'What did the forecast say for this zone?', 'Which plots need me this week?']
}

// tiny formatter: **bold**, bullet lines, paragraphs
function Rich({ text }) {
  const lines = text.split('\n').filter((l, i, a) => l.trim() || (i && a[i - 1].trim()))
  return lines.map((l, i) => {
    const bullet = /^\s*[-*•]\s+/.test(l)
    const body = l.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, '')
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p)
    return bullet ? <div key={i} className="b-li">{parts}</div> : body.trim() ? <p key={i}>{parts}</p> : null
  })
}

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export default function ChatPanel({ plot }) {
  const { selectedFarmId, farm, health } = useTwin()
  const ctxKey = selectedFarmId || 'farm'
  const [threads, setThreads] = useState({})
  const [threadIds, setThreadIds] = useState({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const closeRef = useRef(null)
  const scroller = useRef(null)
  const recRef = useRef(null)
  const msgs = threads[ctxKey] || []
  const chips = useMemo(() => chipsFor(plot), [plot])

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [msgs])
  useEffect(() => () => { closeRef.current?.() }, [])

  const update = (key, fn) => setThreads((t) => ({ ...t, [key]: fn(t[key] || []) }))

  async function ask(q) {
    const question = q.trim()
    if (!question || busy) return
    setInput('')
    const key = ctxKey
    update(key, (m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true, tools: [], sources: [] }])
    setBusy(true)
    const patch = (fn) => update(key, (m) => { const c = [...m]; c[c.length - 1] = fn(c[c.length - 1]); return c })
    try {
      const { runId, threadId } = await api.chat({ message: question, plotId: plot?.plotId || null, farmId: selectedFarmId, threadId: threadIds[key] })
      if (threadId) setThreadIds((t) => ({ ...t, [key]: threadId }))
      closeRef.current = api.runEvents(runId, ({ type, data }) => {
        if (type === 'token') patch((b) => ({ ...b, content: b.content + (data?.text || '') }))
        else if (type === 'tool_call') patch((b) => ({ ...b, tools: [...b.tools, { id: data.id, server: data.server, tool: data.tool, pending: true }] }))
        else if (type === 'tool_result') patch((b) => ({ ...b, tools: b.tools.map((t) => t.id === data.id ? { ...t, pending: false, ok: data.ok, ms: data.durationMs } : t) }))
        else if (type === 'llm') patch((b) => ({ ...b, model: data }))
        else if (type === 'message') patch((b) => ({ ...b, content: data?.text || b.content, sources: data?.sources || [] }))
        else if (type === 'error') { patch((b) => ({ ...b, error: data?.text || 'The agent returned an error.', streaming: false })); if (data?.recoverable === false) setBusy(false) }
        else if (type === 'done') { patch((b) => ({ ...b, streaming: false })); setBusy(false); closeRef.current = null }
      })
    } catch (e) {
      patch((b) => ({ ...b, streaming: false, error: e.message || 'Could not reach the agent.' }))
      setBusy(false)
    }
  }

  function stopRun() { closeRef.current?.(); closeRef.current = null; update(ctxKey, (m) => { const c = [...m]; const l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, content: l.content || '(stopped)' }; return c }); setBusy(false) }

  function toggleMic() {
    if (!SR) return
    if (listening) { recRef.current?.stop(); return }
    const r = new SR(); recRef.current = r
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join('')
      setInput(t)
      if (e.results[e.results.length - 1].isFinal) { r.stop(); ask(t) }
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    setListening(true); r.start()
  }

  const model = health?.model

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="chat-title">
          <Sparkles size={16} className="accent" />
          <span>Ask the agent about <b>{plot ? `Plot ${plot.plotId} · ${plot.displayName}` : farm?.name || 'this farm'}</b></span>
        </div>
      </div>
      <div className="chat-badges">
        {model ? <ModelChip drafter={model} compact /> : <span className="chip gray">agent offline</span>}
        <span className="chip gray"><Server size={12} /> MCP · agritwin + open-meteo</span>
      </div>

      <div className="chat-log" ref={scroller} aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>Ask about the week's priorities, why a plot is flagged, the forecast, or the audit trail. Answers come through the same MCP tools the drafter uses; the agent never contacts a household.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? (
              <>
                {m.tools?.length > 0 && (
                  <div className="b-tools">
                    {m.tools.map((t) => (
                      <span key={t.id} className={`b-tool ${t.pending ? 'pending' : t.ok === false ? 'fail' : ''}`}>
                        <span className={`srv ${t.server === 'open-meteo' ? 'meteo' : 'agri'}`}>{t.server || 'agritwin'}</span><Wrench size={10} />{t.tool}{!t.pending && typeof t.ms === 'number' ? <i>{t.ms} ms</i> : null}
                      </span>
                    ))}
                  </div>
                )}
                {m.content ? <Rich text={m.content} /> : m.error ? null : <div className="typing"><i /><i /><i /></div>}
                {m.error && <div className="b-err"><AlertTriangle size={12} />{m.error}</div>}
                {!m.streaming && (m.content || m.sources?.length > 0) && (
                  <div className="b-meta">
                    {m.model && <ModelChip drafter={m.model} compact />}
                    {m.sources?.slice(0, 5).map((s) => <span key={s} className="b-src">{s}</span>)}
                  </div>
                )}
              </>
            ) : m.content}
          </div>
        ))}
      </div>

      <div className="chat-chips">
        {chips.map((c) => <button key={c} disabled={busy} onClick={() => ask(c)}>{c}</button>)}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        {SR && (
          <button type="button" className={`icon-btn ${listening ? 'rec' : ''}`} onClick={toggleMic} title="Speak your question" aria-label="Speak your question">
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? 'Listening…' : plot ? `Ask about ${plot.plotId}…` : 'Ask about this farm…'} aria-label="Question" />
        {busy ? (
          <button type="button" className="icon-btn send" onClick={stopRun} aria-label="Stop"><Square size={16} /></button>
        ) : (
          <button type="submit" className="icon-btn send" disabled={!input.trim()} aria-label="Send"><Send size={17} /></button>
        )}
      </form>
    </div>
  )
}
