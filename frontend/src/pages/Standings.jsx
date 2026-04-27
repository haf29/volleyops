import { useState, useEffect } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useSocket } from '../context/SocketContext'

function StatBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden', width: 60 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .6s' }} />
    </div>
  )
}

function UpdateModal({ teams, onClose, onSaved }) {
  const toast = useToast()
  const [teamId, setTeamId] = useState('')
  const [season, setSeason] = useState(new Date().getFullYear() + '-' + (new Date().getFullYear() + 1))
  const [form, setForm] = useState({ played: 0, wins: 0, losses: 0, sets_won: 0, sets_lost: 0, points: 0 })
  const [loading, setLoading] = useState(false)
  const set = (f) => (e) => setForm((v) => ({ ...v, [f]: Number(e.target.value) }))
  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/standings', { team_id: Number(teamId), season, ...form })
      toast('Standings updated', 'success')
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span className="modal-title">Update Standing</span><button className="modal-close" onClick={onClose}>✕</button></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row"><label>Team *</label>
              <select className="select" required value={teamId} onChange={e => setTeamId(e.target.value)}>
                <option value="">Select team…</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div className="form-row"><label>Season *</label>
              <input className="input" required value={season} onChange={e => setSeason(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Played</label><input className="input" type="number" min="0" value={form.played} onChange={set('played')} /></div>
            <div className="form-row"><label>Points</label><input className="input" type="number" min="0" value={form.points} onChange={set('points')} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Wins</label><input className="input" type="number" min="0" value={form.wins} onChange={set('wins')} /></div>
            <div className="form-row"><label>Losses</label><input className="input" type="number" min="0" value={form.losses} onChange={set('losses')} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Sets Won</label><input className="input" type="number" min="0" value={form.sets_won} onChange={set('sets_won')} /></div>
            <div className="form-row"><label>Sets Lost</label><input className="input" type="number" min="0" value={form.sets_lost} onChange={set('sets_lost')} /></div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Standing'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

export default function Standings() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const { socket } = useSocket()
  const [standings, setStandings] = useState([])
  const [allTeams,  setAllTeams]  = useState([])
  const [seasons,   setSeasons]   = useState([])
  const [season,    setSeason]    = useState('')
  const [division,  setDivision]  = useState('')
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    api.get('/teams').then(({ data }) => setAllTeams(data.teams || [])).catch(() => {})
  }, [])

  // Auto-refresh when admin updates standings from any device
  useEffect(() => {
    if (!socket) return
    socket.on('standings_updated', () => loadStandings())
    return () => socket.off('standings_updated')
  }, [socket, season, division])

  async function loadStandings() {
    setLoading(true)
    try {
      const params = {}
      if (season)   params.season   = season
      if (division) params.division = division
      const { data } = await api.get('/standings', { params })
      const rows = data.standings || []
      setStandings(rows)
      // use backend-supplied seasons list (includes seasons with no entries for current team set)
      const s = data.seasons?.length ? data.seasons : [...new Set(rows.map(r => r.season).filter(Boolean))].sort().reverse()
      if (s.length && !season) { setSeasons(s); setSeason(s[0]) }
      else setSeasons(s)
    } catch { toast('Failed to load standings', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadStandings() }, [season, division])

  const maxWins = Math.max(1, ...standings.map(s => s.wins))
  const divisions = [...new Set(allTeams.map(t => t.division).filter(Boolean))].sort()

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">League Standings</div>
          <div className="page-subtitle">{standings.length} teams · ranked by points</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowModal(true)}>Update Standing</button>}
      </div>

      {/* Season filter */}
      <div className="filter-row">
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Season:</span>
        {seasons.map(s => (
          <button key={s} className={`filter-btn ${season === s ? 'active' : ''}`} onClick={() => setSeason(s)}>{s}</button>
        ))}
        {seasons.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No seasons recorded yet</span>}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 12 }}>Division:</span>
        <select className="select" value={division} onChange={(e) => setDivision(e.target.value)} style={{ width: 180, height: 36 }}>
          <option value="">All divisions</option>
          {divisions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : standings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏆</div>
            <p>No standings recorded for this season</p>
            {isAdmin && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowModal(true)}>Add First Standing</button>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>Rank</th>
                  <th>Team</th>
                  <th style={{ textAlign: 'center' }}>P</th>
                  <th style={{ textAlign: 'center' }}>W</th>
                  <th style={{ textAlign: 'center' }}>L</th>
                  <th style={{ textAlign: 'center' }}>Sets</th>
                  <th style={{ textAlign: 'center' }}>Ratio</th>
                  <th style={{ textAlign: 'center' }}>Win %</th>
                  <th style={{ textAlign: 'center', fontWeight: 800 }}>PTS</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.team_id} style={{ background: s.rank <= 3 ? `rgba(124,58,237,${0.04 * (4 - s.rank)})` : '' }}>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: s.rank <= 3 ? 20 : 13, fontWeight: 700, color: s.rank <= 3 ? '' : 'var(--text-muted)' }}>
                        {MEDALS[s.rank] || s.rank}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--grad1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>
                          {s.team_name?.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{s.team_name}</div>
                          {s.division && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.division}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{s.played}</td>
                    <td style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 700 }}>{s.wins}</td>
                    <td style={{ textAlign: 'center', color: 'var(--pink)'  }}>{s.losses}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>{s.sets_won}</span>
                        <span style={{ color: 'var(--text-dim)' }}>–</span>
                        <span style={{ color: 'var(--pink)', fontSize: 12 }}>{s.sets_lost}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: s.set_ratio >= 1 ? 'var(--green)' : 'var(--pink)' }}>
                        {s.set_ratio}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{s.win_rate}%</span>
                        <StatBar value={s.wins} max={maxWins} color="var(--grad2)" />
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 18, fontWeight: 800, background: 'var(--grad1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        {s.points}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <UpdateModal
          teams={allTeams}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadStandings() }}
        />
      )}
    </div>
  )
}
