import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const SKILLS = [
  { key: 'serving',      label: 'Serving',      icon: '🏐' },
  { key: 'passing',      label: 'Passing',       icon: '🤲' },
  { key: 'setting',      label: 'Setting',       icon: '✋' },
  { key: 'hitting',      label: 'Hitting',       icon: '💥' },
  { key: 'blocking',     label: 'Blocking',      icon: '🛡️' },
  { key: 'defense',      label: 'Defense',       icon: '🔒' },
  { key: 'athleticism',  label: 'Athleticism',   icon: '⚡' },
  { key: 'coachability', label: 'Coachability',  icon: '🎓' },
]

const POS_LABELS = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'OH',
  opposite: 'OPP', middle_blocker: 'MB', defensive_specialist: 'DS',
}

function ScorePill({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {[1,2,3,4,5,6,7,8,9,10].map(n => (
        <button key={n} type="button" onClick={() => onChange(value === n ? null : n)}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .1s',
            borderColor: value >= n ? 'var(--purple)' : 'var(--border)',
            background: value >= n
              ? n <= 4 ? 'rgba(236,72,153,.2)' : n <= 7 ? 'rgba(245,158,11,.2)' : 'rgba(16,185,129,.2)'
              : 'var(--surface2)',
            color: value >= n
              ? n <= 4 ? 'var(--pink)' : n <= 7 ? '#f59e0b' : 'var(--green)'
              : 'var(--text-dim)',
          }}>
          {n}
        </button>
      ))}
    </div>
  )
}

function overall(scores) {
  const vals = Object.values(scores).filter(v => v != null && v !== '')
  if (!vals.length) return null
  return (vals.reduce((a, b) => a + Number(b), 0) / vals.length).toFixed(1)
}

// ── Evaluate Modal ────────────────────────────────────────────────────────────
function EvalModal({ player, tryoutId, existingEval, onClose, onSaved }) {
  const toast = useToast()
  const empty = Object.fromEntries(SKILLS.map(s => [s.key, null]))
  const [scores, setScores] = useState(
    existingEval
      ? Object.fromEntries(SKILLS.map(s => [s.key, existingEval[s.key] ?? null]))
      : empty
  )
  const [notes, setNotes]     = useState(existingEval?.notes || '')
  const [season, setSeason]   = useState(existingEval?.season || '2024-2025')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/evaluations', {
        player_id: player.id || player.player_id,
        tryout_id: tryoutId || null,
        season,
        notes,
        ...scores,
      })
      toast('Evaluation saved', 'success')
      onSaved()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save', 'error')
    } finally { setLoading(false) }
  }

  const avg = overall(scores)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <span className="modal-title">Evaluate — {player.name || player.player_name}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {POS_LABELS[player.position] || 'Unknown position'}
              {avg && <span style={{ marginLeft: 10, color: 'var(--purple-light)', fontWeight: 700 }}>Overall: {avg}</span>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Season</label>
            <input className="input" style={{ marginTop: 6 }} value={season}
              onChange={e => setSeason(e.target.value)} placeholder="2024-2025" />
          </div>

          {SKILLS.map(({ key, label, icon }) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{icon}</span> {label}
                {scores[key] != null && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                    {scores[key]}/10 — <button type="button" onClick={() => setScores(s => ({ ...s, [key]: null }))}
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}>clear</button>
                  </span>
                )}
              </div>
              <ScorePill value={scores[key]} onChange={v => setScores(s => ({ ...s, [key]: v }))} />
            </div>
          ))}

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Notes</label>
            <textarea className="input" rows={2} style={{ marginTop: 6 }} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Optional scouting notes…" />
          </div>

          <div className="form-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Save Evaluation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Evaluations() {
  const { isAdmin, isCoach } = useAuth()
  const canEvaluate = isAdmin || isCoach
  const toast = useToast()
  const [tryouts,  setTryouts]  = useState([])
  const [players,  setPlayers]  = useState([]) // summary rows
  const [evals,    setEvals]    = useState([]) // flat evaluations
  const [selTryout, setSelTryout] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [evalTarget, setEvalTarget] = useState(null) // { player, existingEval }
  const [view,     setView]     = useState('summary') // 'summary' | 'detail'

  useEffect(() => {
    api.get('/tryouts').then(({ data }) => setTryouts(data.tryouts || [])).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (selTryout) params.tryout_id = selTryout
      const [sumRes, evRes] = await Promise.all([
        api.get('/evaluations/summary', { params }),
        api.get('/evaluations', { params }),
      ])
      setPlayers(sumRes.data.summary || [])
      setEvals(evRes.data.evaluations || [])
    } catch { toast('Failed to load evaluations', 'error') }
    finally { setLoading(false) }
  }, [selTryout])

  useEffect(() => { if (selTryout) load() }, [selTryout, load])

  function existingEvalForPlayer(playerId) {
    return evals.find(e => e.player_id === playerId) || null
  }

  function scoreBar(val) {
    if (val == null) return <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>
    const pct = (val / 10) * 100
    const color = val <= 4 ? 'var(--pink)' : val <= 7 ? '#f59e0b' : 'var(--green)'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 60, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{val}</span>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Player Evaluations</div>
          <div className="page-subtitle">Score players across 8 skill categories and view aggregated results</div>
        </div>
      </div>

      {/* Tryout selector + view toggle */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 260 }} value={selTryout}
          onChange={e => setSelTryout(e.target.value)}>
          <option value="">— Select a tryout —</option>
          {tryouts.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({new Date(t.date).toLocaleDateString()})</option>
          ))}
        </select>
        {selTryout && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[['summary','Summary'],['detail','All Scores']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: '1.5px solid', transition: 'all .15s',
                  background: view === v ? 'rgba(124,58,237,.1)' : 'var(--surface)',
                  borderColor: view === v ? 'var(--purple)' : 'var(--border)',
                  color: view === v ? 'var(--purple-light)' : 'var(--text)',
                }}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {!selTryout ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>Select a tryout above to view or add player evaluations.</p>
        </div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : view === 'summary' ? (

        /* ── Summary table (avg across all evaluators) ── */
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {players.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <p>No evaluations yet for this tryout. Open the detail view to add scores.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Player','Pos','Srv','Pass','Set','Hit','Blk','Def','Ath','Coach','Overall','#Evals',...(canEvaluate ? ['Action'] : [])].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr key={p.player_id} style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>{p.player_name}</td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)' }}>{POS_LABELS[p.position] || '—'}</td>
                    {['serving','passing','setting','hitting','blocking','defense','athleticism','coachability'].map(k => (
                      <td key={k} style={{ padding: '10px 12px' }}>{scoreBar(p[k] != null ? Math.round(p[k] * 10) / 10 : null)}</td>
                    ))}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple-light)' }}>{p.overall ?? '—'}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{p.eval_count}</td>
                    {canEvaluate && (
                      <td style={{ padding: '10px 12px' }}>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => setEvalTarget({ player: { id: p.player_id, name: p.player_name, position: p.position }, existingEval: existingEvalForPlayer(p.player_id) })}>
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      ) : (

        /* ── Detail table (every individual score) ── */
        <div>
          {canEvaluate && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setEvalTarget({ player: null, existingEval: null })}>
                + Add Evaluation
              </button>
            </div>
          )}
          {evals.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📝</div><p>No evaluations yet.</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {evals.map(e => (
                <div key={e.id} className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{e.player_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {POS_LABELS[e.position] || '—'} · Evaluated by {e.evaluator_name} · {new Date(e.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple-light)' }}>{e.overall ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Overall</div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))', gap: 8 }}>
                    {SKILLS.map(({ key, label, icon }) => (
                      <div key={key} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{icon} {label}</div>
                        {scoreBar(e[key])}
                      </div>
                    ))}
                  </div>
                  {e.notes && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{e.notes}</div>}
                  {canEvaluate && (
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => setEvalTarget({ player: { id: e.player_id, name: e.player_name, position: e.position }, existingEval: e })}>
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {evalTarget && (
        evalTarget.player ? (
          <EvalModal
            player={evalTarget.player}
            tryoutId={selTryout ? Number(selTryout) : null}
            existingEval={evalTarget.existingEval}
            onClose={() => setEvalTarget(null)}
            onSaved={load}
          />
        ) : (
          /* "Add Evaluation" from detail view — pick player first */
          <AddEvalPickerModal
            tryoutId={Number(selTryout)}
            onClose={() => setEvalTarget(null)}
            onPick={player => setEvalTarget({ player, existingEval: null })}
          />
        )
      )}
    </div>
  )
}

// Small helper: pick a player from tryout attendees before evaluating
function AddEvalPickerModal({ tryoutId, onClose, onPick }) {
  const [attendees, setAttendees] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.get(`/tryouts/${tryoutId}`)
      .then(({ data }) => setAttendees(data.attendees || []))
      .catch(() => {})
  }, [tryoutId])

  const filtered = attendees.filter(a =>
    a.status === 'present' &&
    (!search || a.player_name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">Select Player to Evaluate</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <input className="search-input" style={{ width: '100%', marginBottom: 12 }}
          placeholder="Search present players…" value={search} onChange={e => setSearch(e.target.value)} />
        {filtered.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            No present players. Mark check-in status first.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(a => (
              <button key={a.player_id}
                onClick={() => onPick({ id: a.player_id, name: a.player_name, position: a.position })}
                style={{
                  padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--text)', fontWeight: 600, fontSize: 13,
                  display: 'flex', justifyContent: 'space-between',
                }}>
                {a.player_name}
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{POS_LABELS[a.position] || ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
