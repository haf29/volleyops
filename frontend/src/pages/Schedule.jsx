import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

// ─── Calendar Sync Modal ───────────────────────────────────────────────────────
function CalendarSyncModal({ onClose }) {
  const toast = useToast()
  const [tokenData, setTokenData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get('/calendar/token')
      .then(r => setTokenData(r.data))
      .catch(() => toast('Failed to load calendar token', 'error'))
      .finally(() => setLoading(false))
  }, [])

  function copyUrl() {
    if (tokenData?.feed_url) {
      navigator.clipboard.writeText(tokenData.feed_url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  function downloadIcs() {
    if (tokenData?.feed_url) {
      const a = document.createElement('a')
      a.href = tokenData.feed_url
      a.download = 'volleyops.ics'
      a.click()
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">📅 Calendar Sync</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Generating your calendar link…</div>
        ) : tokenData ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Open your matches and training sessions in Google Calendar. Your personal calendar link is private, so anyone with the URL can view your schedule.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 6 }}>Calendar Feed URL</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={tokenData.feed_url} className="input" style={{ fontSize: 12, flex: 1 }} onClick={e => e.target.select()} />
                <button className="btn btn-secondary" onClick={copyUrl} style={{ whiteSpace: 'nowrap' }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={downloadIcs}>
                ⬇️ Download .ics File
              </button>
              <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(tokenData.feed_url)}`} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  <img src="https://www.google.com/favicon.ico" alt="" style={{ width: 14, height: 14, marginRight: 6 }} />
                  Add to Google Calendar
                </button>
              </a>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 16 }}>
              This private feed includes all matches and practices for your teams.
            </p>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--pink)' }}>Failed to load calendar data.</div>
        )}
      </div>
    </div>
  )
}

// ─── Create Practice Modal ─────────────────────────────────────────────────────
function CreatePracticeModal({ teams, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({
    team_id: teams[0]?.id ?? '',
    date: '',
    type: 'training',
    title: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const set = f => e => setForm(v => ({ ...v, [f]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/attendance/sessions', {
        ...form,
        team_id: Number(form.team_id),
      })
      toast('Practice session scheduled', 'success')
      onCreated(data.session)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Schedule Practice</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Team *</label>
            <select className="select" required value={form.team_id} onChange={set('team_id')}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          <div className="form-grid">
            <div className="form-row"><label>Date &amp; Time *</label>
              <input className="input" type="datetime-local" required value={form.date} onChange={set('date')} /></div>
            <div className="form-row"><label>Type</label>
              <select className="select" value={form.type} onChange={set('type')}>
                <option value="training">Training</option>
                <option value="match">Match</option>
                <option value="tournament">Tournament</option>
                <option value="other">Other</option>
              </select></div>
          </div>
          <div className="form-row"><label>Title</label>
            <input className="input" placeholder="e.g. Defensive Drills" value={form.title} onChange={set('title')} /></div>
          <div className="form-row"><label>Notes</label>
            <textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Schedule'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const POS_LABELS = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'OH',
  opposite: 'OPP', middle_blocker: 'MB', defensive_specialist: 'DS',
}

const STATUS_STYLE = {
  scheduled:  { badge: 'badge-cyan',   label: 'Scheduled' },
  completed:  { badge: 'badge-green',  label: 'Completed' },
  cancelled:  { badge: 'badge-pink',   label: 'Cancelled' },
  postponed:  { badge: 'badge-yellow', label: 'Postponed' },
}

const ROLE_STYLE = {
  starter:    { color: '#10b981', bg: 'rgba(16,185,129,.15)', label: '🟢 Starter',    border: 'rgba(16,185,129,.35)' },
  substitute: { color: '#06b6d4', bg: 'rgba(6,182,212,.15)',  label: '🔵 Substitute', border: 'rgba(6,182,212,.35)' },
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
function daysUntil(iso) {
  const diff = new Date(iso) - Date.now()
  if (diff < 0) return null
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

// ─── Create Match Modal ────────────────────────────────────────────────────────
function CreateMatchModal({ teams, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({
    team_id: teams[0]?.id ?? '', opponent: '', match_date: '', home_away: 'home',
    competition: '', location: '', notes: '',
  })
  const [loading, setLoading] = useState(false)
  const set = f => e => setForm(v => ({ ...v, [f]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/matches', { ...form, team_id: Number(form.team_id) })
      toast('Match scheduled', 'success')
      onCreated(data)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Schedule Match</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Team *</label>
            <select className="select" required value={form.team_id} onChange={set('team_id')}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          <div className="form-row"><label>Opponent *</label>
            <input className="input" required placeholder="Beirut Blockers" value={form.opponent} onChange={set('opponent')} /></div>
          <div className="form-grid">
            <div className="form-row"><label>Date & Time *</label>
              <input className="input" type="datetime-local" required value={form.match_date} onChange={set('match_date')} /></div>
            <div className="form-row"><label>Home / Away</label>
              <select className="select" value={form.home_away} onChange={set('home_away')}>
                <option value="home">Home</option>
                <option value="away">Away</option>
                <option value="neutral">Neutral</option>
              </select></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Competition</label>
              <input className="input" placeholder="League, Cup…" value={form.competition} onChange={set('competition')} /></div>
            <div className="form-row"><label>Location</label>
              <input className="input" placeholder="Sports Complex A" value={form.location} onChange={set('location')} /></div>
          </div>
          <div className="form-row"><label>Notes</label>
            <textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Schedule Match'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Result Modal ─────────────────────────────────────────────────────────────
function ResultModal({ match, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    sets_us: match.sets_us ?? '', sets_them: match.sets_them ?? '',
    score_us: match.score_us ?? '', score_them: match.score_them ?? '',
    status: 'completed',
  })
  const [loading, setLoading] = useState(false)
  const [playerStats, setPlayerStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const set = f => e => setForm(v => ({ ...v, [f]: e.target.value }))

  useEffect(() => {
    let alive = true
    setStatsLoading(true)
    api.get(`/matches/${match.id}/stats`)
      .then(({ data }) => {
        if (!alive) return
        setPlayerStats((data.players || []).map(p => ({
          ...p,
          sets_played: p.sets_played ?? 0,
          points: p.points ?? 0,
          kills: p.kills ?? 0,
          aces: p.aces ?? 0,
          blocks: p.blocks ?? 0,
          digs: p.digs ?? 0,
          errors: p.errors ?? 0,
        })))
      })
      .catch(() => {
        if (alive) toast('Failed to load roster stats', 'error')
      })
      .finally(() => {
        if (alive) setStatsLoading(false)
      })
    return () => { alive = false }
  }, [match.id])

  function setStat(playerId, field, value) {
    const clean = Math.max(0, Number(value) || 0)
    setPlayerStats(prev => prev.map(p => (
      p.player_id === playerId ? { ...p, [field]: clean } : p
    )))
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.put(`/matches/${match.id}`, {
        status: 'completed',
        sets_us: Number(form.sets_us) || null,
        sets_them: Number(form.sets_them) || null,
        score_us: Number(form.score_us) || null,
        score_them: Number(form.score_them) || null,
      })
      if (playerStats.length) {
        await api.post(`/matches/${match.id}/stats`, {
          stats: playerStats.map(p => ({
            player_id: p.player_id,
            sets_played: Number(p.sets_played) || 0,
            points: Number(p.points) || 0,
            kills: Number(p.kills) || 0,
            aces: Number(p.aces) || 0,
            blocks: Number(p.blocks) || 0,
            digs: Number(p.digs) || 0,
            errors: Number(p.errors) || 0,
          })),
        })
      }
      toast('Result and player stats saved', 'success')
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 900, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Record Result & Player Stats</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          {match.team_name} vs {match.opponent}
        </p>
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Sets Won</label>
              <input className="input" type="number" min="0" max="3" value={form.sets_us} onChange={set('sets_us')} style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, padding: '8px 0' }} />
            </div>
            <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>–</span>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Sets Lost</label>
              <input className="input" type="number" min="0" max="3" value={form.sets_them} onChange={set('sets_them')} style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, padding: '8px 0' }} />
            </div>
          </div>
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Player Match Stats</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              These numbers update dashboard leaders and analytics after saving.
            </div>
            {statsLoading ? (
              <div className="loading-center" style={{ minHeight: 120 }}><div className="spinner" /></div>
            ) : playerStats.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, border: '1px solid var(--border)', borderRadius: 10 }}>
                No active roster players found for this team.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {['Player','Sets','Pts','Kills','Aces','Blocks','Digs','Errors'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Player' ? 'left' : 'center', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {playerStats.map(p => (
                      <tr key={p.player_id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', minWidth: 180 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{p.player_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {POS_LABELS[p.position] || 'No position'}{p.role ? ` - ${p.role}` : ''}
                          </div>
                        </td>
                        {['sets_played','points','kills','aces','blocks','digs','errors'].map(field => (
                          <td key={field} style={{ padding: 6 }}>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              value={p[field]}
                              onChange={e => setStat(p.player_id, field, e.target.value)}
                              style={{ width: 72, textAlign: 'center', padding: '7px 4px' }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || statsLoading}>{loading ? 'Saving…' : 'Save Result & Stats'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Lineup Panel (right side) ────────────────────────────────────────────────
function LineupPanel({ match, canManage, onLineupSaved }) {
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [saving, setSaving] = useState(false)
  // local assignment map: { [playerId]: 'starter' | 'substitute' | 'remove' }
  const [assignments, setAssignments] = useState({})

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/matches/${match.id}`)
      setDetail(data)
      const init = {}
      data.lineup.forEach(l => { init[l.player_id] = l.role })
      setAssignments(init)
    } catch {}
  }, [match.id])

  useEffect(() => { load() }, [load])

  function assign(playerId, role) {
    setAssignments(prev => {
      const next = { ...prev }
      if (next[playerId] === role) {
        delete next[playerId] // toggle off
      } else {
        next[playerId] = role
      }
      return next
    })
  }

  async function saveLineup() {
    setSaving(true)
    try {
      const lineup = Object.entries(assignments).map(([player_id, role]) => ({
        player_id: Number(player_id), role,
      }))
      await api.post(`/matches/${match.id}/lineup`, { lineup })
      toast('Lineup saved', 'success')
      load()
      onLineupSaved?.()
    } catch { toast('Failed to save lineup', 'error') }
    finally { setSaving(false) }
  }

  if (!detail) return <div className="loading-center"><div className="spinner" /></div>

  const starterCount = Object.values(assignments).filter(r => r === 'starter').length
  const subCount     = Object.values(assignments).filter(r => r === 'substitute').length

  // All players: those in lineup + unassigned
  const allPlayers = [
    ...detail.lineup.map(l => ({ id: l.player_id, name: l.player_name, position: l.player_position, jersey_number: l.jersey_number })),
    ...detail.unassigned,
  ]

  const isDirty = JSON.stringify(
    Object.fromEntries(detail.lineup.map(l => [l.player_id, l.role]))
  ) !== JSON.stringify(
    Object.fromEntries(Object.entries(assignments).filter(([, r]) => r !== 'remove'))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>
          {detail.team_name} vs {detail.opponent}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {formatDate(detail.match_date)} · {formatTime(detail.match_date)}
          {detail.location && ` · ${detail.location}`}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'rgba(16,185,129,.15)', color: '#10b981', fontWeight: 700 }}>
            {starterCount} / 6 starters
          </span>
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'rgba(6,182,212,.15)', color: '#06b6d4', fontWeight: 700 }}>
            {subCount} subs
          </span>
          {detail.roster_size - starterCount - subCount > 0 && (
            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'var(--surface2)', color: 'var(--text-muted)' }}>
              {detail.roster_size - starterCount - subCount} unselected
            </span>
          )}
        </div>
      </div>

      {/* Player list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {allPlayers.length === 0 && (
          <div className="empty-state" style={{ paddingTop: 40 }}>
            <div className="empty-icon">👥</div>
            <p>No players on this team's roster yet</p>
          </div>
        )}
        {allPlayers.map(p => {
          const role = assignments[p.id]
          const rs   = ROLE_STYLE[role]
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 10,
              background: rs ? rs.bg : 'var(--surface2)',
              border: `1px solid ${rs ? rs.border : 'var(--border)'}`,
              transition: 'all .15s',
            }}>
              {/* Jersey + name */}
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: rs ? rs.bg : 'var(--surface)',
                border: `1px solid ${rs ? rs.border : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, color: rs?.color ?? 'var(--text-muted)',
              }}>
                {p.jersey_number != null ? `#${p.jersey_number}` : p.name.charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: rs?.color ?? 'var(--text)' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {POS_LABELS[p.position] || 'No position'}
                  {role && <span style={{ marginLeft: 6, color: rs?.color, fontWeight: 700 }}>{rs?.label}</span>}
                </div>
              </div>
              {/* Assignment buttons */}
              {canManage && match.status === 'scheduled' && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => assign(p.id, 'starter')}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontFamily: 'DM Sans, sans-serif',
                      background: role === 'starter' ? 'rgba(16,185,129,.3)' : 'transparent',
                      color: role === 'starter' ? '#10b981' : 'var(--text-muted)',
                      border: `1px solid ${role === 'starter' ? '#10b981' : 'var(--border)'}` }}>
                    Start
                  </button>
                  <button onClick={() => assign(p.id, 'substitute')}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontFamily: 'DM Sans, sans-serif',
                      background: role === 'substitute' ? 'rgba(6,182,212,.3)' : 'transparent',
                      color: role === 'substitute' ? '#06b6d4' : 'var(--text-muted)',
                      border: `1px solid ${role === 'substitute' ? '#06b6d4' : 'var(--border)'}` }}>
                    Sub
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Save bar */}
      {canManage && match.status === 'scheduled' && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {starterCount > 6 && (
            <div style={{ fontSize: 12, color: 'var(--pink)', marginBottom: 8 }}>⚠ Max 6 starters allowed</div>
          )}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
            disabled={saving || !isDirty || starterCount > 6}
            onClick={saveLineup}>
            {saving ? 'Saving…' : 'Save Lineup'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Schedule() {
  const { canManageFixtures, canManageLineups } = useAuth()
  const toast = useToast()
  const [matches,  setMatches]  = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [tab,      setTab]      = useState('upcoming')   // upcoming | past | all | practices
  const [showCreate, setShowCreate] = useState(false)
  const [showResult, setShowResult] = useState(null)
  const [showCalSync, setShowCalSync] = useState(false)

  // ── practices state ───────────────────────────────────────────────────────
  const [practices,     setPractices]     = useState([])
  const [practLoading,  setPractLoading]  = useState(false)
  const [showCreatePractice, setShowCreatePractice] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (tab === 'upcoming') params.upcoming = 'true'
      if (tab === 'past')     params.status   = 'completed'
      if (tab === 'practices') { setLoading(false); return }
      const { data } = await api.get('/matches', { params })
      const nextMatches = data.matches || []
      setMatches(nextMatches)
      setSelected(prev => {
        if (!nextMatches.length) return null
        if (!prev) return nextMatches[0]
        return nextMatches.find(m => m.id === prev.id) || nextMatches[0]
      })
    } catch { toast('Failed to load schedule', 'error') }
    finally { setLoading(false) }
  }, [tab])

  const loadPractices = useCallback(async () => {
    setPractLoading(true)
    try {
      const { data } = await api.get('/attendance/sessions')
      setPractices(data.sessions || [])
    } catch {}
    finally { setPractLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'practices') loadPractices()
    else load()
  }, [tab, load, loadPractices])

  useEffect(() => {
    if (canManageFixtures) {
      api.get('/teams').then(({ data }) => setTeams(data.teams || [])).catch(() => {})
    }
  }, [canManageFixtures])

  const filteredMatches = matches.filter(m => {
    if (tab === 'upcoming') return m.status === 'scheduled'
    if (tab === 'past')     return m.status === 'completed' || m.status === 'cancelled' || m.status === 'postponed'
    return true
  })

  const SESSION_TYPE_STYLE = {
    training:    { badge: 'badge-cyan',   label: '🏋️ Training',   color: 'var(--cyan)' },
    match:       { badge: 'badge-purple', label: '🏐 Match',       color: 'var(--purple-light)' },
    tournament:  { badge: 'badge-pink',   label: '🏆 Tournament',  color: 'var(--pink)' },
    other:       { badge: 'badge-yellow', label: '📋 Other',       color: 'var(--yellow)' },
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Schedule</div>
          <div className="page-subtitle">
            {tab === 'practices'
              ? `${practices.length} practice session${practices.length !== 1 ? 's' : ''}`
              : `${matches.length} match${matches.length !== 1 ? 'es' : ''} · manage fixtures and team lineups`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setShowCalSync(true)}>📅 Sync Calendar</button>
          {canManageFixtures && tab !== 'practices' && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Schedule Match</button>
          )}
          {canManageFixtures && tab === 'practices' && (
            <button className="btn btn-primary" onClick={() => setShowCreatePractice(true)}>+ Schedule Practice</button>
          )}
        </div>
      </div>

      {/* ── Practices tab ── */}
      {tab === 'practices' ? (
        <div>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            {[['upcoming','Upcoming'],['past','Past'],['all','All Matches'],['practices','Practices']].map(([key, label]) => (
              <button key={key} onClick={() => { setTab(key); setSelected(null) }}
                style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  color: tab === key ? 'var(--cyan)' : 'var(--text-muted)',
                  borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent' }}>
                {label}
              </button>
            ))}
          </div>

          {practLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : !practices.length ? (
            <div className="empty-state">
              <div className="empty-icon">🏋️</div>
              <p>No practice sessions scheduled yet</p>
              {canManageFixtures && <button className="btn btn-primary" onClick={() => setShowCreatePractice(true)}>Schedule First Practice</button>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {practices.map(s => {
                const st = SESSION_TYPE_STYLE[s.type] || SESSION_TYPE_STYLE.other
                const d = s.date ? new Date(s.date) : null
                return (
                  <div key={s.id} className="card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.title || 'Practice Session'}</div>
                      <span className={`badge ${st.badge}`}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {s.team_name || '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: s.notes ? 8 : 0 }}>
                      📅 {d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      {d && <span style={{ marginLeft: 8 }}>{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                    {s.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>{s.notes}</div>}
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.marked_count ?? 0} marked</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (

      <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 200px)', minHeight: 500 }}>

        {/* ── Left: match list ── */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 4px' }}>
            {[['upcoming','Upcoming'],['past','Past'],['all','All'],['practices','Practices']].map(([key, label]) => (
              <button key={key} onClick={() => { setTab(key); setSelected(null) }}
                style={{ flex: 1, padding: '12px 4px', fontSize: 11, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  color: tab === key ? 'var(--purple-light)' : 'var(--text-muted)',
                  borderBottom: tab === key ? '2px solid var(--purple)' : '2px solid transparent' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Match list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : filteredMatches.length === 0 ? (
              <div className="empty-state" style={{ paddingTop: 40 }}>
                <div className="empty-icon">📅</div>
                <p>No {tab} matches</p>
              </div>
            ) : filteredMatches.map(m => {
              const st    = STATUS_STYLE[m.status] || STATUS_STYLE.scheduled
              const until = daysUntil(m.match_date)
              const isActive = selected?.id === m.id
              return (
                <div key={m.id} onClick={() => setSelected(m)}
                  style={{ padding: '14px 16px', cursor: 'pointer', transition: 'background .1s',
                    background: isActive ? 'rgba(124,58,237,.12)' : 'transparent',
                    borderLeft: `3px solid ${isActive ? 'var(--purple)' : 'transparent'}`,
                    borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>vs {m.opponent}</div>
                    <span className={`badge ${st.badge}`} style={{ fontSize: 10 }}>{st.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {m.team_name}
                    {m.home_away === 'home' ? ' 🏠' : m.home_away === 'away' ? ' ✈️' : ' ⚖️'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatDate(m.match_date)}</span>
                    {until && m.status === 'scheduled' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: until === 'Today' || until === 'Tomorrow' ? 'var(--pink)' : 'var(--purple-light)' }}>{until}</span>
                    )}
                    {m.status === 'completed' && m.sets_us != null && (
                      <span style={{ fontSize: 12, fontWeight: 800, color: m.sets_us > m.sets_them ? '#10b981' : 'var(--pink)' }}>
                        {m.sets_us}–{m.sets_them}
                      </span>
                    )}
                  </div>
                  {m.status === 'scheduled' && (
                    <div style={{ marginTop: 6, height: 3, background: 'var(--surface2)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (m.lineup_count / Math.max(1, m.roster_size)) * 100)}%`, background: m.lineup_count >= m.roster_size ? '#10b981' : 'var(--purple)', borderRadius: 2, transition: 'width .3s' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right: detail / lineup panel ── */}
        <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <p>Select a match to view or manage the lineup</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Match header bar */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    {selected.competition || 'League Match'} · {selected.team_name}
                    {selected.home_away === 'home' ? ' 🏠 Home' : selected.home_away === 'away' ? ' ✈️ Away' : ' ⚖️ Neutral'}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>
                    {selected.team_name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs</span> {selected.opponent}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatDate(selected.match_date)} · {formatTime(selected.match_date)}
                    {selected.location && <span> · 📍 {selected.location}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selected.status === 'completed' && selected.sets_us != null && (
                    <div style={{ textAlign: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 20px' }}>
                      <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 4 }}>
                        <span style={{ color: selected.sets_us > selected.sets_them ? '#10b981' : 'var(--text)' }}>{selected.sets_us}</span>
                        <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>–</span>
                        <span style={{ color: selected.sets_them > selected.sets_us ? 'var(--pink)' : 'var(--text)' }}>{selected.sets_them}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>SETS</div>
                    </div>
                  )}
                  {canManageFixtures && ['scheduled', 'completed'].includes(selected.status) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowResult(selected)}>
                      {selected.status === 'completed' ? 'Edit Result & Stats' : 'Record Result'}
                    </button>
                  )}
                </div>
              </div>

              {/* Lineup */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <LineupPanel
                  key={selected.id}
                  match={selected}
                  canManage={canManageLineups}
                  onLineupSaved={load}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      )} {/* end tab !== 'practices' */}

      {showCreate && (
        <CreateMatchModal
          teams={teams}
          onClose={() => setShowCreate(false)}
          onCreated={(m) => { setMatches(prev => [m, ...prev]); setShowCreate(false); setSelected(m) }}
        />
      )}

      {showResult && (
        <ResultModal
          match={showResult}
          onClose={() => setShowResult(null)}
          onSaved={() => { setShowResult(null); load() }}
        />
      )}

      {showCalSync && (
        <CalendarSyncModal onClose={() => setShowCalSync(false)} />
      )}

      {showCreatePractice && (
        <CreatePracticeModal
          teams={teams}
          onClose={() => setShowCreatePractice(false)}
          onCreated={(s) => { setPractices(prev => [s, ...prev]); setShowCreatePractice(false) }}
        />
      )}
    </div>
  )
}
