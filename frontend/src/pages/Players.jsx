import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const STATUS_OPTS = ['', 'pending', 'approved', 'rejected', 'waitlisted']
const POSITION_LABELS = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'Outside Hitter',
  opposite: 'Opposite', middle_blocker: 'Middle Blocker', defensive_specialist: 'Def. Specialist',
}
const STATUS_BADGE = {
  pending:    'badge-yellow',
  approved:   'badge-green',
  rejected:   'badge-pink',
  waitlisted: 'badge-cyan',
}

const PAGE_SIZE = 20

// ── Stats Edit Modal ──────────────────────────────────────────────────────────
function StatsModal({ player, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    season: '2024-2025',
    matches_played: '', sets_played: '', points: '',
    kills: '', aces: '', blocks: '', digs: '', errors: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get(`/players/stats`, { params: { team_id: player.team_id } })
      .then(({ data }) => {
        const existing = data.players?.find(p => p.id === player.id)
        if (existing) {
          setForm({
            season:         existing.season         || '2024-2025',
            matches_played: existing.matches_played ?? '',
            sets_played:    existing.sets_played    ?? '',
            points:         existing.points         ?? '',
            kills:          existing.kills          ?? '',
            aces:           existing.aces           ?? '',
            blocks:         existing.blocks         ?? '',
            digs:           existing.digs           ?? '',
            errors:         existing.errors         ?? '',
          })
        }
      })
      .catch(() => {})
  }, [player.id, player.team_id])

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { season: form.season }
      const fields = ['matches_played','sets_played','points','kills','aces','blocks','digs','errors']
      fields.forEach(f => { if (form[f] !== '') payload[f] = Number(form[f]) })
      await api.put(`/players/${player.id}/stats`, payload)
      toast('Stats saved', 'success')
      onSaved()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save stats', 'error')
    } finally {
      setLoading(false)
    }
  }

  const f = (field) => ({ value: form[field], onChange: e => setForm(s => ({ ...s, [field]: e.target.value })) })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">Edit Stats — {player.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Season</label>
            <input className="input" value={form.season} onChange={e => setForm(s => ({ ...s, season: e.target.value }))} placeholder="2024-2025" required />
          </div>
          <div className="form-grid">
            {[['Matches Played','matches_played'],['Sets Played','sets_played'],['Points','points'],
              ['Kills','kills'],['Aces','aces'],['Blocks','blocks'],['Digs','digs'],['Errors','errors']
            ].map(([label, field]) => (
              <div className="form-row" key={field}>
                <label>{label}</label>
                <input className="input" type="number" min="0" placeholder="0" {...f(field)} />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Stats'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Pagination control ────────────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {page} of {pages}</span>
      <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next ›</button>
    </div>
  )
}

export default function Players() {
  const { isAdmin, canManage } = useAuth()
  const toast = useToast()
  const [players,  setPlayers]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [filters,  setFilters]  = useState({ status: 'pending', search: '', page: 1 })
  const [selected, setSelected] = useState(null)
  const [working,  setWorking]  = useState(false)
  const [statsPlayer, setStatsPlayer] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: PAGE_SIZE, page: filters.page }
      if (filters.status) params.status = filters.status
      if (filters.search) params.search = filters.search
      const { data } = await api.get('/players', { params })
      setPlayers(data.players || [])
      setTotal(data.total || 0)
    } catch { toast('Failed to load players', 'error') }
    finally { setLoading(false) }
  }, [filters])

  useEffect(() => { load() }, [load])

  async function updateStatus(id, status) {
    setWorking(true)
    try {
      await api.patch(`/players/${id}/status`, { status })
      toast(`Player ${status}`, 'success')
      load()
      setSelected(null)
    } catch { toast('Failed to update status', 'error') }
    finally { setWorking(false) }
  }

  const selectedPlayer = players.find((p) => p.id === selected)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Player Registrations</div>
          <div className="page-subtitle">{total} total · manage registration status and team assignments</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-row">
        {STATUS_OPTS.map((s) => (
          <button key={s || 'all'} className={`filter-btn ${filters.status === s ? 'active' : ''}`}
            onClick={() => setFilters((f) => ({ ...f, status: s, page: 1 }))}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
        <div className="search-wrap" style={{ marginLeft: 'auto' }}>
          <input className="search-input" placeholder="Search players…" value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        {/* Table */}
        <div className="card" style={{ flex: 1 }}>
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : players.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <p>No players found</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Position</th>
                      <th>Team</th>
                      <th>Season</th>
                      <th>Status</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p) => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(p.id)}>
                        <td>
                          <div className="cell-name">
                            <div className="avatar">{p.name.charAt(0)}</div>
                            <div>
                              <div style={{ fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>{POSITION_LABELS[p.position] || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                        <td>{p.team_name || <span style={{ color: 'var(--text-dim)' }}>Unassigned</span>}</td>
                        <td>{p.season || '—'}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[p.registration_status] || 'badge-dim'}`}>
                            {p.registration_status}
                          </span>
                        </td>
                        {canManage && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {isAdmin && p.registration_status === 'pending' && (
                                <>
                                  <button className="btn btn-green btn-sm" disabled={working}
                                    onClick={() => updateStatus(p.id, 'approved')}>Approve</button>
                                  <button className="btn btn-pink btn-sm" disabled={working}
                                    onClick={() => updateStatus(p.id, 'rejected')}>Reject</button>
                                  <button className="btn btn-yellow btn-sm" disabled={working}
                                    onClick={() => updateStatus(p.id, 'waitlisted')}>Waitlist</button>
                                </>
                              )}
                              {isAdmin && p.registration_status !== 'pending' && (
                                <button className="btn btn-secondary btn-sm" disabled={working}
                                  onClick={() => updateStatus(p.id, 'pending')}>Reset</button>
                              )}
                              <button className="btn btn-secondary btn-sm"
                                onClick={() => setStatsPlayer(p)}>Stats</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={filters.page} total={total} pageSize={PAGE_SIZE}
                onChange={p => setFilters(f => ({ ...f, page: p }))} />
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedPlayer && (
          <div className="card" style={{ width: 260, flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Player Detail</span>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--grad1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff', margin: '0 auto 8px' }}>
                {selectedPlayer.name.charAt(0)}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedPlayer.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedPlayer.email}</div>
            </div>
            {[
              ['Phone',    selectedPlayer.phone],
              ['DOB',      selectedPlayer.date_of_birth],
              ['Position', POSITION_LABELS[selectedPlayer.position]],
              ['Jersey',   selectedPlayer.jersey_number != null ? `#${selectedPlayer.jersey_number}` : null],
              ['Season',   selectedPlayer.season],
              ['Team',     selectedPlayer.team_name],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{val}</span>
              </div>
            ) : null)}
            {selectedPlayer.notes && (
              <div style={{ marginTop: 12, background: 'var(--surface2)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {selectedPlayer.notes}
              </div>
            )}
            {canManage && (
              <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
                onClick={() => setStatsPlayer(selectedPlayer)}>📊 Edit Stats</button>
            )}
            {isAdmin && selectedPlayer.registration_status === 'pending' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <button className="btn btn-green" disabled={working} onClick={() => updateStatus(selectedPlayer.id, 'approved')} style={{ justifyContent: 'center' }}>✓ Approve</button>
                <button className="btn btn-yellow" disabled={working} onClick={() => updateStatus(selectedPlayer.id, 'waitlisted')} style={{ justifyContent: 'center' }}>⏳ Waitlist</button>
                <button className="btn btn-pink" disabled={working} onClick={() => updateStatus(selectedPlayer.id, 'rejected')} style={{ justifyContent: 'center' }}>✕ Reject</button>
              </div>
            )}
          </div>
        )}
      </div>

      {statsPlayer && (
        <StatsModal player={statsPlayer} onClose={() => setStatsPlayer(null)} onSaved={load} />
      )}
    </div>
  )
}
