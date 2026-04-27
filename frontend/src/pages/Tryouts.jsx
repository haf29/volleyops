import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const STATUS_BADGE = {
  registered: 'badge-dim',
  present:    'badge-green',
  absent:     'badge-pink',
  excused:    'badge-cyan',
}
const STATUS_LABEL = { registered: 'Registered', present: 'Present', absent: 'Absent', excused: 'Excused' }
const POS_LABELS   = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'OH',
  opposite: 'OPP', middle_blocker: 'MB', defensive_specialist: 'DS',
}

// ── Create Tryout Modal ───────────────────────────────────────────────────────
function CreateModal({ teams, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', date: '', team_id: '', location: '', season: '', notes: '' })
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { ...form, team_id: form.team_id ? Number(form.team_id) : null }
      await api.post('/tryouts', payload)
      toast('Tryout created', 'success')
      onCreated()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create tryout', 'error')
    } finally {
      setLoading(false)
    }
  }

  const f = field => ({ value: form[field], onChange: e => setForm(s => ({ ...s, [field]: e.target.value })) })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">New Tryout Session</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Tryout Name *</label>
            <input className="input" required placeholder="e.g. Spring 2025 Tryout" {...f('name')} />
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Date *</label>
              <input className="input" type="datetime-local" required {...f('date')} />
            </div>
            <div className="form-row"><label>Location</label>
              <input className="input" placeholder="Gym / Venue" {...f('location')} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Season</label>
              <input className="input" placeholder="2024-2025" {...f('season')} />
            </div>
            <div className="form-row"><label>Team (optional)</label>
              <select className="input" {...f('team_id')}>
                <option value="">— Any team —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row"><label>Notes</label>
            <textarea className="input" rows={2} placeholder="Optional notes…" {...f('notes')} />
          </div>
          <div className="form-actions">
            <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create Tryout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Check-In Panel ────────────────────────────────────────────────────────────
function CheckInPanel({ tryout, onClose, onUpdated }) {
  const toast    = useToast()
  const [data, setData]       = useState(null)
  const [players, setPlayers] = useState([])  // all approved players for bulk add
  const [working, setWorking] = useState(null)
  const [search,  setSearch]  = useState('')

  const reload = useCallback(async () => {
    const [detail, allPlayers] = await Promise.all([
      api.get(`/tryouts/${tryout.id}`),
      api.get('/players', { params: { status: 'approved', limit: 500 } }),
    ])
    setData(detail.data)
    setPlayers(allPlayers.data.players || [])
  }, [tryout.id])

  useEffect(() => { reload() }, [reload])

  async function checkin(player_id, status) {
    setWorking(player_id)
    try {
      await api.post(`/tryouts/${tryout.id}/checkin`, { player_id, status })
      await reload()
      onUpdated()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update', 'error')
    } finally { setWorking(null) }
  }

  async function bulkRegister() {
    try {
      const payload = tryout.team_id ? { team_id: tryout.team_id } : {}
      const { data: r } = await api.post(`/tryouts/${tryout.id}/bulk-register`, payload)
      toast(`${r.registered} players registered`, 'success')
      await reload()
      onUpdated()
    } catch (err) { toast('Bulk register failed', 'error') }
  }

  const attendees = data?.attendees || []
  const attendeeIds = new Set(attendees.map(a => a.player_id))
  const unregistered = players.filter(p => !attendeeIds.has(p.id) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase())))

  const filtered = attendees.filter(a =>
    !search || a.player_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div>
            <span className="modal-title">Check-In — {tryout.name}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(tryout.date).toLocaleDateString()} · {attendees.filter(a => a.status === 'present').length} present / {attendees.length} registered
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '0 0 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="search-input" style={{ flex: 1 }} placeholder="Search players…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-secondary btn-sm" onClick={bulkRegister}>+ Bulk Register</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!data ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : (
            <>
              {/* Registered attendees */}
              {filtered.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                      {['Player','Position','Status','Actions'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(a => (
                      <tr key={a.player_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{a.player_name}</div>
                          {a.player_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.player_email}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12 }}>{POS_LABELS[a.position] || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {['present','absent','excused'].map(s => (
                              <button key={s} disabled={working === a.player_id || a.status === s}
                                onClick={() => checkin(a.player_id, s)}
                                style={{
                                  padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                  border: '1px solid var(--border)', background: a.status === s ? 'var(--purple)' : 'var(--surface2)',
                                  color: a.status === s ? '#fff' : 'var(--text-muted)', opacity: working === a.player_id ? .5 : 1,
                                }}>
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Players not yet registered — quick add */}
              {unregistered.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '8px 14px', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                    Not Yet Registered ({unregistered.length})
                  </div>
                  {unregistered.slice(0, 20).map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{POS_LABELS[p.position] || ''}</span>
                      </div>
                      <button onClick={() => checkin(p.id, 'registered')} disabled={working === p.id}
                        className="btn btn-secondary btn-sm">+ Add</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Tryouts() {
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'admin'
  const isPlayer = user?.role === 'player'
  const canCreateTryouts = user?.role === 'coach' || isAdmin
  const canManageCheckIn = ['admin', 'coach', 'assistant_coach'].includes(user?.role)

  const [tryouts, setTryouts] = useState([])
  const [teams,   setTeams]   = useState([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [checkinTarget, setCheckinTarget] = useState(null)
  const [filterOpen, setFilterOpen]   = useState('all') // 'all'|'1'|'0'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, tm] = await Promise.all([
        api.get('/tryouts'),
        api.get('/teams'),
      ])
      setTryouts(t.data.tryouts || [])
      setTeams(tm.data.teams || [])
    } catch { toast('Failed to load', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function registerForTryout(tryout) {
    setRegistering(tryout.id)
    try {
      await api.post(`/tryouts/${tryout.id}/register`)
      toast('You are registered for this tryout', 'success')
      await load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to register', 'error')
    } finally {
      setRegistering(null)
    }
  }

  const displayed = tryouts.filter(t =>
    filterOpen === 'all' || String(t.is_open) === filterOpen
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{isPlayer ? 'Tryouts' : 'Tryout Check-In'}</div>
          <div className="page-subtitle">
            {isPlayer ? 'Register for open tryouts and track your status' : 'Manage tryout sessions and track player attendance'}
          </div>
        </div>
        {canCreateTryouts && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Tryout</button>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['all','All'],['1','Open'],['0','Closed']].map(([val, label]) => (
          <button key={val} onClick={() => setFilterOpen(val)}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: '1.5px solid', transition: 'all .15s',
              background: filterOpen === val ? 'rgba(124,58,237,.1)' : 'var(--surface)',
              borderColor: filterOpen === val ? 'var(--purple)' : 'var(--border)',
              color: filterOpen === val ? 'var(--purple-light)' : 'var(--text)',
            }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <p>{isPlayer ? 'No open tryouts are available for you yet.' : 'No tryout sessions yet. Create one to start tracking check-ins.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px,1fr))', gap: 16 }}>
          {displayed.map(t => (
            <div key={t.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {new Date(t.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    {t.location && ` · ${t.location}`}
                  </div>
                </div>
                <span className={`badge ${t.is_open ? 'badge-green' : 'badge-dim'}`}>
                  {t.is_open ? 'Open' : 'Closed'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple-light)' }}>{t.total_registered}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Registered</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{t.total_present}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Present</div>
                </div>
                {t.team_name && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)' }}>{t.team_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Team</div>
                  </div>
                )}
              </div>

              {t.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t.notes}</div>}

              {isPlayer ? (
                <button
                  className={t.current_user_status ? 'btn btn-secondary' : 'btn btn-primary'}
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={!t.is_open || Boolean(t.current_user_status) || registering === t.id}
                  onClick={() => registerForTryout(t)}
                >
                  {registering === t.id
                    ? 'Registering...'
                    : t.current_user_status
                      ? STATUS_LABEL[t.current_user_status] || 'Registered'
                      : t.is_open ? 'Register for Tryout' : 'Closed'}
                </button>
              ) : canManageCheckIn ? (
                <button className="btn btn-primary" style={{ width: '100%' }}
                  onClick={() => setCheckinTarget(t)}>
                  Open Check-In Board
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal teams={teams} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
      {checkinTarget && (
        <CheckInPanel tryout={checkinTarget} onClose={() => setCheckinTarget(null)} onUpdated={load} />
      )}
    </div>
  )
}
