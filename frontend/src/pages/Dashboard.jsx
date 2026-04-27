import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const POS_LABELS = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'Outside Hitter',
  opposite: 'Opposite', middle_blocker: 'Middle Blocker', defensive_specialist: 'Def. Specialist',
}

function KpiCard({ icon, iconClass, value, label, delta, deltaUp }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon ${iconClass}`}>{icon}</div>
      <div className="kpi-value">{value ?? '—'}</div>
      <div className="kpi-label">{label}</div>
      {delta != null && (
        <div className={`kpi-delta ${deltaUp ? 'up' : 'down'}`}>
          {deltaUp ? '↑' : '↓'} {delta}
        </div>
      )}
    </div>
  )
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
function daysUntil(iso) {
  const diff = new Date(iso) - Date.now()
  if (diff < 0) return null
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today!'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

// ─── Shared payment section ────────────────────────────────────────────────────
function PaymentSection({ payments, summary }) {
  if (!summary && payments.length === 0) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          My Payments
        </div>
        <Link to="/payments" style={{ fontSize: 12, color: 'var(--purple-light)', fontWeight: 600, textDecoration: 'none' }}>
          View all →
        </Link>
      </div>
      <div className="card">
        {summary && (
          <div style={{ display: 'flex', gap: 10, marginBottom: payments.length > 0 ? 16 : 0, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 80, textAlign: 'center', padding: '10px 8px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>${(summary.paid_amount || 0).toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>PAID</div>
            </div>
            <div style={{ flex: 1, minWidth: 80, textAlign: 'center', padding: '10px 8px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--yellow)' }}>${(summary.pending_amount || 0).toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>PENDING</div>
            </div>
            {summary.overdue_amount > 0 && (
              <div style={{ flex: 1, minWidth: 80, textAlign: 'center', padding: '10px 8px', background: 'rgba(236,72,153,.08)', borderRadius: 10, border: '1px solid rgba(236,72,153,.2)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--pink)' }}>${(summary.overdue_amount || 0).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: 'var(--pink)', fontWeight: 600 }}>OVERDUE</div>
              </div>
            )}
          </div>
        )}
        {payments.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, padding: '12px 0' }}>No payment records</div>
        ) : payments.slice(0, 4).map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.description || p.plan_name || 'Payment'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {p.due_date ? `Due ${new Date(p.due_date).toLocaleDateString()}` : 'No due date'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: p.status === 'paid' ? 'var(--green)' : (p.overdue || p.status === 'overdue') ? 'var(--pink)' : 'var(--text)' }}>
                ${Number(p.amount).toLocaleString()}
              </div>
              <span className={`badge ${p.status === 'paid' ? 'badge-green' : (p.overdue || p.status === 'overdue') ? 'badge-pink' : 'badge-yellow'}`} style={{ fontSize: 10 }}>
                {p.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Player dashboard ─────────────────────────────────────────────────────────
function PlayerDashboard({ user }) {
  const [myMatch,    setMyMatch]    = useState(undefined) // undefined=loading, null=none
  const [myTeams,    setMyTeams]    = useState([])
  const [upcomingMatches, setUpcomingMatches] = useState([])
  const [payments,   setPayments]   = useState([])
  const [paymentSummary, setPaymentSummary] = useState(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/matches/my')
        .then(({ data }) => setMyMatch(data.match ? data : null))
        .catch(() => setMyMatch(null)),
      api.get('/teams')
        .then(({ data }) => setMyTeams(data.teams || []))
        .catch(() => {}),
      api.get('/matches?upcoming=true')
        .then(({ data }) => setUpcomingMatches(data.matches || []))
        .catch(() => {}),
      api.get('/payments?limit=4')
        .then(({ data }) => setPayments(data.payments || []))
        .catch(() => {}),
      api.get('/payments/summary')
        .then(({ data }) => setPaymentSummary(data))
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [user])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  const roleConfig = {
    starter:    { icon: '🟢', label: 'Starting',     color: '#10b981', bg: 'rgba(16,185,129,.12)', border: 'rgba(16,185,129,.3)' },
    substitute: { icon: '🔵', label: 'Substitute',   color: '#06b6d4', bg: 'rgba(6,182,212,.12)',  border: 'rgba(6,182,212,.3)' },
    null:       { icon: '❓', label: 'Not Set Yet',  color: 'var(--text-muted)', bg: 'var(--surface2)', border: 'var(--border)' },
  }

  const rc = myMatch ? (roleConfig[myMatch.role] ?? roleConfig[null]) : null
  const until = myMatch?.match ? daysUntil(myMatch.match.match_date) : null

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Dashboard</div>
          <div className="page-subtitle">Welcome back, {user?.name?.split(' ')[0]} 👋</div>
        </div>
      </div>

      {/* ── Next Match ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
          Next Match
        </div>

        {myMatch === null ? (
          <div className="card" style={{ padding: '28px 24px' }}>
            <div className="empty-state" style={{ padding: 0 }}>
              <div className="empty-icon">📅</div>
              <p>No upcoming matches scheduled yet</p>
            </div>
          </div>
        ) : myMatch === undefined ? (
          <div className="card"><div className="loading-center"><div className="spinner" /></div></div>
        ) : (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '24px 28px',
            backgroundImage: 'linear-gradient(135deg, rgba(124,58,237,.06), rgba(236,72,153,.04))',
          }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between' }}>

              {/* Left: match info */}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {myMatch.match.competition && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(124,58,237,.2)', color: 'var(--purple-light)' }}>
                      {myMatch.match.competition}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {myMatch.match.home_away === 'home' ? '🏠 Home' : myMatch.match.home_away === 'away' ? '✈️ Away' : '⚖️ Neutral'}
                  </span>
                  {until && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: until.includes('Today') ? 'var(--pink)' : 'var(--purple-light)', marginLeft: 'auto' }}>
                      {until}
                    </span>
                  )}
                </div>

                <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
                  {myMatch.match.team_name}
                  <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 18, margin: '0 10px' }}>vs</span>
                  {myMatch.match.opponent}
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
                  <span>📅 {formatDate(myMatch.match.match_date)}</span>
                  <span>🕐 {formatTime(myMatch.match.match_date)}</span>
                  {myMatch.match.location && <span>📍 {myMatch.match.location}</span>}
                </div>
              </div>

              {/* Right: lineup status */}
              <div style={{
                flexShrink: 0, padding: '18px 24px', borderRadius: 14, textAlign: 'center', minWidth: 160,
                background: rc.bg, border: `1px solid ${rc.border}`,
              }}>
                <div style={{ fontSize: 36, marginBottom: 6 }}>{rc.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: rc.color, marginBottom: 2 }}>
                  {rc.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {myMatch.role ? 'Your lineup role' : 'Lineup not released yet'}
                </div>
                {myMatch.position && (
                  <div style={{ fontSize: 11, color: rc.color, fontWeight: 700, marginTop: 4 }}>
                    {POS_LABELS[myMatch.position] || myMatch.position}
                  </div>
                )}
              </div>
            </div>

            {/* Lineup progress bar */}
            {myMatch.match.lineup_count != null && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lineup completion</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {myMatch.match.lineup_count} / {myMatch.match.roster_size} players assigned
                  </span>
                </div>
                <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, transition: 'width .6s',
                    width: `${Math.min(100, (myMatch.match.lineup_count / Math.max(1, myMatch.match.roster_size)) * 100)}%`,
                    background: myMatch.match.lineup_count >= myMatch.match.roster_size ? '#10b981' : 'var(--grad2)' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── My Team(s) ── */}
      {myTeams.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            My Team{myTeams.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 14 }}>
            {myTeams.map(t => (
              <div key={t.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '20px 22px',
                backgroundImage: 'linear-gradient(135deg,rgba(124,58,237,.05),transparent)',
              }}>
                {/* Team header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                    background: 'var(--grad1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, fontWeight: 800, color: '#fff',
                  }}>
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {[t.division, t.season].filter(Boolean).join(' · ') || 'No division'}
                    </div>
                  </div>
                </div>

                {/* Coach */}
                {t.coach_name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8 }}>
                    <span style={{ fontSize: 14 }}>🎽</span>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Head Coach</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{t.coach_name}</div>
                    </div>
                    {t.assistant_coach_name && (
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Asst. Coach</div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t.assistant_coach_name}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Badges */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge badge-purple">{t.player_count || 0} / {t.max_players} players</span>
                  {t.roster_published
                    ? <span className="badge badge-green">✓ Roster Published</span>
                    : t.is_finalized
                      ? <span className="badge badge-cyan">Finalized</span>
                      : <span className="badge badge-dim">Draft</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upcoming matches ── */}
      {upcomingMatches.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Upcoming Matches
            </div>
            <Link to="/schedule" style={{ fontSize: 12, color: 'var(--purple-light)', fontWeight: 600, textDecoration: 'none' }}>
              View full schedule →
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcomingMatches.slice(0, 4).map((m, i) => {
              const isNext   = i === 0
              const until    = daysUntil(m.match_date)
              // Find this player's role in this match lineup (from myMatch if same match)
              const myRole   = myMatch?.match?.id === m.id ? myMatch.role : null
              const roleStyle = myRole === 'starter'
                ? { color: '#10b981', bg: 'rgba(16,185,129,.1)', label: '🟢 Starting' }
                : myRole === 'substitute'
                  ? { color: '#06b6d4', bg: 'rgba(6,182,212,.1)', label: '🔵 Sub' }
                  : null

              return (
                <Link to="/schedule" key={m.id} style={{ textDecoration: 'none' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    background: isNext ? 'var(--surface)' : 'var(--surface)',
                    border: `1px solid ${isNext ? 'rgba(124,58,237,.3)' : 'var(--border)'}`,
                    borderRadius: 12, padding: '14px 18px', cursor: 'pointer',
                    transition: 'border-color .15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = isNext ? 'rgba(124,58,237,.3)' : 'var(--border)'}>

                    {/* Date column */}
                    <div style={{
                      flexShrink: 0, width: 48, height: 48, borderRadius: 10, textAlign: 'center',
                      background: isNext ? 'rgba(124,58,237,.15)' : 'var(--surface2)',
                      border: `1px solid ${isNext ? 'rgba(124,58,237,.3)' : 'var(--border)'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: isNext ? 'var(--purple-light)' : 'var(--text)', lineHeight: 1 }}>
                        {new Date(m.match_date).getDate()}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        {new Date(m.match_date).toLocaleString('default', { month: 'short' })}
                      </div>
                    </div>

                    {/* Match info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          {m.team_name} vs {m.opponent}
                        </span>
                        {isNext && until && (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
                            background: until.includes('Today') ? 'rgba(236,72,153,.2)' : 'rgba(124,58,237,.2)',
                            color: until.includes('Today') ? 'var(--pink)' : 'var(--purple-light)' }}>
                            {until}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatTime(m.match_date)}
                        {m.location && ` · 📍 ${m.location}`}
                        {m.home_away === 'home' ? ' · 🏠 Home' : m.home_away === 'away' ? ' · ✈️ Away' : ''}
                      </div>
                    </div>

                    {/* My role badge */}
                    {roleStyle ? (
                      <div style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                        background: roleStyle.bg, color: roleStyle.color }}>
                        {roleStyle.label}
                      </div>
                    ) : isNext ? (
                      <div style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                        background: 'var(--surface2)', color: 'var(--text-muted)' }}>
                        ❓ TBA
                      </div>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── My Payments ── */}
      <PaymentSection payments={payments} summary={paymentSummary} />

      {/* ── Quick links ── */}
      <div className="row-3">
        {[
          { to: '/schedule',  icon: '📅', title: 'Schedule',   desc: 'View upcoming matches & your lineup' },
          { to: '/messages',  icon: '💬', title: 'Messages',   desc: 'Team chat and conversations' },
          { to: '/standings', icon: '🏆', title: 'Standings',  desc: 'League table and rankings' },
        ].map(item => (
          <Link key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'border-color .2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--text)' }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Team Stats Panel (coaches only) ─────────────────────────────────────────
function TeamStatsPanel({ players, standings, tab, onTab }) {
  const BAR_COLOR = { scorers: '#7c3aed', servers: '#06b6d4', blockers: '#f59e0b', diggers: '#10b981' }
  const tabs = [
    { id: 'scorers',  label: '🏐 Top Scorers',  key: 'points', perMatch: 'points_per_match', unit: 'pts' },
    { id: 'servers',  label: '💨 Top Servers',  key: 'aces',   perMatch: 'aces_per_match',   unit: 'aces'  },
    { id: 'blockers', label: '🛡 Top Blockers', key: 'blocks', perMatch: 'blocks_per_match', unit: 'blocks'},
    { id: 'diggers',  label: '🤿 Top Diggers',  key: 'digs',   perMatch: 'digs_per_match',   unit: 'digs'  },
  ]
  const active = tabs.find(t => t.id === tab)
  const sorted = [...players].sort((a, b) => (b[active.key] || 0) - (a[active.key] || 0)).slice(0, 5)
  const max = sorted[0]?.[active.key] || 1
  const color = BAR_COLOR[tab]

  const POS_SHORT = { setter:'SET', libero:'LIB', outside_hitter:'OH', opposite:'OPP', middle_blocker:'MB', defensive_specialist:'DS' }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title">Player Statistics</div>
          <div className="card-sub">2024-2025 season leaderboard</div>
        </div>
        {standings.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            {standings.map(s => (
              <div key={s.team_id} style={{ textAlign: 'center', padding: '6px 14px', background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: s.win_pct >= 60 ? '#10b981' : s.win_pct >= 40 ? 'var(--yellow)' : 'var(--pink)' }}>{s.win_pct ?? 0}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>WIN RATE</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{s.wins}W – {s.losses}L</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--surface2)', borderRadius: 10, padding: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onTab(t.id)}
            style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'DM Sans, sans-serif', transition: 'all .15s',
              background: tab === t.id ? 'var(--surface)' : 'transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Leaderboard */}
      {sorted.length === 0 ? (
        <div className="empty-state" style={{ padding: '16px 0' }}><div className="empty-icon">📊</div><p>No stats yet</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Rank */}
              <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0,
                background: i === 0 ? 'rgba(245,158,11,.2)' : i === 1 ? 'rgba(148,163,184,.2)' : i === 2 ? 'rgba(180,120,80,.15)' : 'var(--surface2)',
                color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b47850' : 'var(--text-muted)' }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
              </div>
              {/* Name + team + position */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                  {p.position && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text-muted)', flexShrink: 0 }}>{POS_SHORT[p.position] || p.position}</span>}
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>{p.team_name}</span>
                </div>
                {/* Bar */}
                <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(p[active.key] / max) * 100}%`, borderRadius: 3, background: color, transition: 'width .4s' }} />
                </div>
              </div>
              {/* Stat value */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color }}>{p[active.key]}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p[active.perMatch]}/match</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All players grid */}
      {players.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>All Players</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 10 }}>
            {players.map(p => (
              <div key={p.id} style={{ background: 'var(--surface2)', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--grad1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{p.name.charAt(0)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{POS_SHORT[p.position] || '—'} · #{p.jersey_number ?? '—'}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[['Kills', p.kills, '#7c3aed'], ['Aces', p.aces, '#06b6d4'], ['Blocks', p.blocks, '#f59e0b'], ['Digs', p.digs, '#10b981']].map(([label, val, c]) => (
                    <div key={label} style={{ textAlign: 'center', padding: '5px 4px', background: 'var(--surface)', borderRadius: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: c }}>{val ?? 0}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>{p.matches_played} matches · {p.points} pts</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Staff dashboard ──────────────────────────────────────────────────────────
function StaffDashboard({ user, isAdmin, isCoach }) {
  const [stats,         setStats]         = useState(null)
  const [pending,       setPending]       = useState([])
  const [pendingStaff,  setPendingStaff]  = useState([])
  const [overdue,       setOverdue]       = useState([])
  const [teams,         setTeams]         = useState([])
  const [nextMatches,   setNextMatches]   = useState([])
  const [myPayments,    setMyPayments]    = useState([])
  const [myPaySummary,  setMyPaySummary]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [activating,    setActivating]    = useState(null)
  const [playerStats,  setPlayerStats]  = useState([])
  const [teamStandings, setTeamStandings] = useState([])
  const [statsTab,     setStatsTab]     = useState('scorers')
  const [smtpOk,       setSmtpOk]       = useState(true)
  const [smtpDismissed, setSmtpDismissed] = useState(false)
  const toast = useToast()

  async function activateStaff(staffUser) {
    setActivating(staffUser.id)
    try {
      await api.put(`/users/${staffUser.id}`, { is_active: true })
      setPendingStaff(prev => prev.filter(s => s.id !== staffUser.id))
      toast(`${staffUser.name} activated`, 'success')
    } catch {
      toast('Failed to activate', 'error')
    } finally {
      setActivating(null)
    }
  }

  useEffect(() => {
    const all = [
      api.get('/players?status=pending&limit=5').then(({ data }) => setPending(data.players || [])).catch(() => {}),
      api.get('/matches?upcoming=true').then(({ data }) => setNextMatches((data.matches || []).slice(0, 3))).catch(() => {}),
    ]

    if (isAdmin) {
      all.push(
        api.get('/auth/smtp-status').then(({ data }) => setSmtpOk(data.configured)).catch(() => {}),
        api.get('/users?is_active=false&limit=10').then(({ data }) => {
          // filter to only coach / assistant_coach roles
          setPendingStaff((data.users || []).filter(u => u.role === 'coach' || u.role === 'assistant_coach'))
        }).catch(() => {}),
        api.get('/payments?overdue_only=true&limit=5').then(({ data }) => setOverdue(data.payments || [])).catch(() => {}),
        Promise.all([
          api.get('/players'),
          api.get('/teams'),
          api.get('/payments/summary'),
        ]).then(([p, t, pay]) => {
          setStats({ players: p.data.total, teams: t.data.teams?.length, ...pay.data })
          setTeams(t.data.teams?.slice(0, 6) || [])
        }).catch(() => {})
      )
    } else {
      // Coach / assistant coach: load their teams + their own payments
      all.push(
        api.get('/teams').then(({ data }) => setTeams(data.teams || [])).catch(() => {}),
        api.get('/payments?limit=4').then(({ data }) => setMyPayments(data.payments || [])).catch(() => {}),
        api.get('/payments/summary').then(({ data }) => setMyPaySummary(data)).catch(() => {}),
      )
      all.push(
        api.get('/players/stats').then(({ data }) => {
          setPlayerStats(data.players || [])
          setTeamStandings(data.standings || [])
        }).catch(() => {})
      )
    }

    Promise.all(all).finally(() => setLoading(false))
  }, [isAdmin, isCoach])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {isAdmin && !smtpOk && !smtpDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', background: 'rgba(245,158,11,.1)',
          border: '1px solid rgba(245,158,11,.35)', borderRadius: 12, marginBottom: 20,
          fontSize: 13, color: 'var(--text)',
        }}>
          <span>
            <strong style={{ color: '#f59e0b' }}>⚠️ Email disabled.</strong>{' '}
            Password reset emails won't be sent. Configure{' '}
            <code style={{ fontSize: 12, background: 'rgba(0,0,0,.2)', padding: '1px 5px', borderRadius: 4 }}>SMTP_HOST</code>,{' '}
            <code style={{ fontSize: 12, background: 'rgba(0,0,0,.2)', padding: '1px 5px', borderRadius: 4 }}>SMTP_USER</code>,{' '}
            <code style={{ fontSize: 12, background: 'rgba(0,0,0,.2)', padding: '1px 5px', borderRadius: 4 }}>SMTP_PASS</code>{' '}
            to enable it.
          </span>
          <button onClick={() => setSmtpDismissed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
        </div>
      )}
      <div className="page-header">
        <div>
          <div className="page-title">{isAdmin ? 'Admin Dashboard' : 'Coach Dashboard'}</div>
          <div className="page-subtitle">Welcome back, {user?.name?.split(' ')[0]} 👋</div>
        </div>
      </div>

      {isAdmin && stats && (
        <div className="kpi-grid mb-6">
          <KpiCard icon="👥" iconClass="purple" value={stats.players} label="Total Players" />
          <KpiCard icon="🏐" iconClass="cyan"   value={stats.teams}   label="Active Teams" />
          <KpiCard icon="💰" iconClass="green"  value={`$${(stats.paid_amount || 0).toLocaleString()}`} label="Revenue Collected" deltaUp delta={`${stats.completion_rate || 0}% collected`} />
          <KpiCard icon="⚠️" iconClass="pink"   value={stats.status_counts?.overdue || 0} label="Overdue Payments" />
        </div>
      )}

      {/* Upcoming matches row */}
      {nextMatches.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div>
              <div className="card-title">Upcoming Matches</div>
              <div className="card-sub">Next scheduled fixtures</div>
            </div>
            <Link to="/schedule" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>View schedule</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 10 }}>
            {nextMatches.map(m => {
              const until = daysUntil(m.match_date)
              const lineupPct = Math.min(100, (m.lineup_count / Math.max(1, m.roster_size)) * 100)
              return (
                <Link to="/schedule" key={m.id} style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'border-color .15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>vs {m.opponent}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{m.team_name} · {formatDate(m.match_date)}</div>
                    {until && <div style={{ fontSize: 10, fontWeight: 700, color: until.includes('Today') ? 'var(--pink)' : 'var(--purple-light)', marginBottom: 6 }}>{until}</div>}
                    <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${lineupPct}%`, borderRadius: 2, background: lineupPct >= 100 ? '#10b981' : 'var(--purple)', transition: 'width .3s' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>Lineup: {m.lineup_count}/{m.roster_size}</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div className="row-2">
        {/* Pending Registrations */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Pending Registrations</div>
              <div className="card-sub">
                {pending.length + pendingStaff.length} awaiting review
              </div>
            </div>
            <Link to="/players" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>View players</Link>
          </div>

          {/* Pending staff */}
          {pendingStaff.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                Coaching Staff
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingStaff.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(6,182,212,.06)', borderRadius: 10, border: '1px solid rgba(6,182,212,.2)' }}>
                    <div className="cell-name">
                      <div className="avatar" style={{ background: 'rgba(6,182,212,.25)', color: 'var(--cyan)' }}>{s.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {s.role === 'coach' ? 'Head Coach' : 'Assistant Coach'} · {s.email}
                        </div>
                        {s.requested_team_name && (
                          <div style={{ fontSize: 11, marginTop: 2 }}>
                            <span style={{ color: 'var(--cyan)' }}>Wants to coach:</span>
                            <span style={{ fontWeight: 600, marginLeft: 4 }}>{s.requested_team_name}</span>
                            {s.requested_team_status === 'pending' && (
                              <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(6,182,212,.15)', color: 'var(--cyan)' }}>new team</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm"
                      disabled={activating === s.id}
                      onClick={() => activateStaff(s)}
                      style={{ background: 'rgba(6,182,212,.2)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,.4)', fontSize: 11, padding: '4px 12px', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}>
                      {activating === s.id ? '…' : 'Activate'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending players */}
          {pending.length > 0 && (
            <div>
              {pendingStaff.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Players
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pending.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="cell-name">
                      <div className="avatar">{p.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.position?.replace(/_/g, ' ') || 'No position'}</div>
                      </div>
                    </div>
                    <span className="badge badge-yellow">Pending</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pending.length === 0 && pendingStaff.length === 0 && (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <div className="empty-icon">✅</div><p>No pending registrations</p>
            </div>
          )}
        </div>

        {/* Overdue Payments (admin) / Teams (coach) */}
        {isAdmin ? (
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Overdue Payments</div><div className="card-sub">Require follow-up</div></div>
              <Link to="/payments" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>View all</Link>
            </div>
            {overdue.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div className="empty-icon">💳</div><p>No overdue payments</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {overdue.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.player_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>${p.amount} · {p.description}</div>
                    </div>
                    <span className="badge badge-pink">Overdue</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">My Teams</div><div className="card-sub">Your assigned teams</div></div>
              <Link to="/teams" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>Manage</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {teams.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.division} · {t.player_count} players</div>
                  </div>
                  <span className={`badge ${t.roster_published ? 'badge-green' : t.is_finalized ? 'badge-cyan' : 'badge-dim'}`}>
                    {t.roster_published ? 'Published' : t.is_finalized ? 'Finalized' : 'Draft'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Player Stats (coach / assistant coach) ── */}
      {!isAdmin && (
        <TeamStatsPanel
          players={playerStats}
          standings={teamStandings}
          tab={statsTab}
          onTab={setStatsTab}
        />
      )}

      {/* Teams grid (admin) */}
      {isAdmin && teams.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div><div className="card-title">Teams</div><div className="card-sub">All teams this season</div></div>
            <Link to="/teams" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>Manage</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {teams.map(t => (
              <div key={t.id} style={{ background: 'var(--surface2)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t.division || '—'} · {t.season || '—'}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="badge badge-purple">{t.player_count || 0} players</span>
                  {t.roster_published ? <span className="badge badge-green">Published</span>
                   : t.is_finalized   ? <span className="badge badge-cyan">Finalized</span>
                   : <span className="badge badge-dim">Draft</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Payments (coach / assistant coach) ── */}
      {!isAdmin && <PaymentSection payments={myPayments} summary={myPaySummary} />}

      <div className="row-3" style={{ marginTop: 20 }}>
        {[
          { to: '/schedule',  icon: '📅', title: 'Schedule',    desc: 'Manage fixtures and lineups' },
          { to: '/tactics',   icon: '🎯', title: 'Tactics',     desc: 'AI-powered tactics board', roles: ['coach','assistant_coach'] },
          { to: '/standings', icon: '🏆', title: 'Standings',   desc: 'League table' },
        ].filter(item => !item.roles || !isAdmin).map(item => (
          <Link key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'border-color .2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--text)' }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isAdmin, isCoach, isPlayer } = useAuth()
  if (isPlayer) return <PlayerDashboard user={user} />
  return <StaffDashboard user={user} isAdmin={isAdmin} isCoach={isCoach} />
}
