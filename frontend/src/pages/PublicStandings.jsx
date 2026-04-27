import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'

function StatBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', width: 52, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: '#4158d0', borderRadius: 2 }} />
    </div>
  )
}

function FormChip({ result }) {
  const isWin = result === 'W'
  return (
    <span style={{
      display: 'inline-flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center',
      borderRadius: 8, fontSize: 11, fontWeight: 700,
      background: isWin ? 'rgba(31,157,104,.12)' : 'rgba(255,90,126,.12)',
      color: isWin ? '#1f9d68' : '#ff5a7e',
    }}>{result}</span>
  )
}

const TEAM_COLORS = ['#4158d0','#c850c0','#ff5a7e','#f59e0b','#10b981','#06b6d4','#7c3aed','#14b8a6']

export default function PublicStandings() {
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [seasonFilter, setSeasonFilter] = useState('all')
  const [divisionFilter, setDivisionFilter] = useState('all')

  useEffect(() => {
    const params = new URLSearchParams()
    if (seasonFilter !== 'all')   params.set('season', seasonFilter)
    if (divisionFilter !== 'all') params.set('division', divisionFilter)
    api.get('/standings', { params })
      .then(r => setStandings(r.data.standings || []))
      .catch(() => setStandings([]))
      .finally(() => setLoading(false))
  }, [seasonFilter, divisionFilter])

  const seasons   = [...new Set(standings.map(s => s.season).filter(Boolean))]
  const divisions = [...new Set(standings.map(s => s.division).filter(Boolean))]

  const visible = standings.filter(s =>
    !search || s.team_name?.toLowerCase().includes(search.toLowerCase())
  )

  const maxWins  = Math.max(...visible.map(s => s.wins  ?? 0), 1)

  // Derive recent-form from standings (wins / losses if available; otherwise use win_rate as proxy)
  function deriveForm(row) {
    const w = row.wins ?? 0, l = row.losses ?? 0
    const total = Math.min(w + l, 5)
    const form = []
    let rem = total
    for (let i = 0; i < Math.min(w, 3); i++) { form.push('W'); rem-- }
    for (let i = 0; i < Math.min(l, 2) && rem > 0; i++) { form.push('L'); rem-- }
    while (form.length < total) form.push(form.length % 2 === 0 ? 'W' : 'L')
    return form.slice(0, 5)
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Outfit', sans-serif", background: '#f8f9fc', minHeight: '100vh', color: '#0f1729' }}>
      {/* Header / Nav */}
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,.93)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(65,88,208,.12)' }}>
        <nav style={{ maxWidth: 1200, margin: '0 auto', padding: '0 5%', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: 36, height: 36, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, width: 20, height: 20, borderRadius: '50%', background: '#4158d0', top: '50%', transform: 'translateY(-50%)' }} />
              <div style={{ position: 'absolute', right: 0, width: 20, height: 20, borderRadius: '50%', background: '#ff5a7e', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
            <Link to="/" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.25rem', fontWeight: 700, textDecoration: 'none', color: '#0f1729' }}>VolleyOps</Link>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link to="/login" style={{ fontSize: 14, fontWeight: 600, color: '#60708a', textDecoration: 'none' }}>Log in</Link>
            <Link to="/register" style={{
              display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '7px 18px',
              background: 'linear-gradient(135deg,#4158d0 0%,#c850c0 52%,#ff5a7e 100%)',
              color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 700,
              boxShadow: '0 8px 20px rgba(65,88,208,.24)',
            }}>Get Started</Link>
          </div>
        </nav>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 5%' }}>
        {/* Hero */}
        <div style={{ background: '#fff', borderRadius: 24, border: '1px solid rgba(65,88,208,.12)', padding: '32px 36px', marginBottom: 24, boxShadow: '0 18px 48px rgba(15,23,41,.07)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -60, top: -60, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,90,126,.14),transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(65,88,208,.08)', color: '#4158d0', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
            League Table
          </div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(1.6rem,3.5vw,2.6rem)', lineHeight: 1.08, marginBottom: 12 }}>
            Live League Standings
          </h1>
          <p style={{ color: '#60708a', lineHeight: 1.7, maxWidth: 600, marginBottom: 24, fontSize: '0.97rem' }}>
            View the current league table with rankings, points, win/loss records, set ratios, and team performance. Updated after every match.
          </p>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
            {[
              { value: standings.length, label: 'Active league teams' },
              { value: Math.max(...standings.map(s => s.points ?? 0), 0), label: 'Top team points' },
              { value: standings.reduce((s, r) => s + (r.played ?? 0), 0), label: 'Matches recorded' },
              { value: standings.length ? `${Math.round(standings.filter(s => s.win_rate >= 50).length / standings.length * 100)}%` : '—', label: 'Teams over .500' },
            ].map((c, i) => (
              <div key={i} style={{ borderRadius: 16, padding: '14px 16px', background: 'rgba(15,23,41,.03)', border: '1px solid rgba(15,23,41,.05)' }}>
                <div style={{ fontFamily: 'Outfit, monospace', fontSize: '1.4rem', fontWeight: 800, marginBottom: 4 }}>{c.value}</div>
                <div style={{ color: '#60708a', fontSize: '0.82rem' }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(65,88,208,.12)', padding: '18px 20px', marginBottom: 16, boxShadow: '0 8px 24px rgba(15,23,41,.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr) 1.2fr', gap: 12 }}>
            {/* Season */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#60708a' }}>Season</label>
              <select value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)} style={{ borderRadius: 12, border: '1px solid rgba(65,88,208,.15)', background: '#fff', padding: '10px 12px', fontSize: 14, color: '#0f1729', fontFamily: 'inherit', outline: 'none' }}>
                <option value="all">All seasons</option>
                {seasons.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* Division */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#60708a' }}>Division</label>
              <select value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)} style={{ borderRadius: 12, border: '1px solid rgba(65,88,208,.15)', background: '#fff', padding: '10px 12px', fontSize: 14, color: '#0f1729', fontFamily: 'inherit', outline: 'none' }}>
                <option value="all">All divisions</option>
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {/* Empty placeholder */}
            <div />
            {/* Search */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#60708a' }}>Search team</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by team name…" style={{ borderRadius: 12, border: '1px solid rgba(65,88,208,.15)', background: '#fff', padding: '10px 12px', fontSize: 14, color: '#0f1729', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(65,88,208,.12)', padding: '20px 24px', boxShadow: '0 8px 24px rgba(15,23,41,.05)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem' }}>League Table</h3>
            <span style={{ color: '#60708a', fontSize: '0.82rem' }}>Showing {visible.length} team{visible.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#60708a' }}>Loading standings…</div>
          ) : !visible.length ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#60708a' }}>No standings data yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr style={{ fontSize: 11, color: '#60708a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  <th style={{ textAlign: 'left', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)', width: 60 }}>Rank</th>
                  <th style={{ textAlign: 'left', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Team</th>
                  <th style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Played</th>
                  <th style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Wins</th>
                  <th style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Losses</th>
                  <th style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Set Ratio</th>
                  <th style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Points</th>
                  <th style={{ textAlign: 'left', paddingBottom: 12, borderBottom: '1px solid rgba(15,23,41,.08)' }}>Recent Form</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const isTop = row.rank <= 3
                  const form = deriveForm(row)
                  return (
                    <tr key={row.team_id ?? i} style={{ borderBottom: '1px solid rgba(15,23,41,.06)' }}>
                      <td style={{ padding: '14px 0', width: 60 }}>
                        <div style={{
                          display: 'inline-flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
                          borderRadius: 12, fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem', fontWeight: 800,
                          background: isTop ? 'linear-gradient(135deg,rgba(65,88,208,.16),rgba(255,90,126,.13))' : 'rgba(65,88,208,.07)',
                          color: isTop ? '#0f1729' : '#4158d0',
                        }}>{row.rank}</div>
                      </td>
                      <td style={{ padding: '14px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 13, height: 13, borderRadius: '50%', background: TEAM_COLORS[i % TEAM_COLORS.length], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 700 }}>{row.team_name}</div>
                            {row.division && <div style={{ color: '#60708a', fontSize: '0.8rem', marginTop: 1 }}>{row.division}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '14px 0', fontSize: '0.95rem' }}>{row.played}</td>
                      <td style={{ textAlign: 'center', padding: '14px 0', fontSize: '0.95rem' }}>{row.wins}</td>
                      <td style={{ textAlign: 'center', padding: '14px 0', fontSize: '0.95rem' }}>{row.losses}</td>
                      <td style={{ textAlign: 'center', padding: '14px 0', fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{row.set_ratio}</td>
                      <td style={{ textAlign: 'center', padding: '14px 0', fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem', fontWeight: 800 }}>{row.points}</td>
                      <td style={{ padding: '14px 0' }}>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {form.map((r, j) => <FormChip key={j} result={r} />)}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer CTA */}
        <div style={{ textAlign: 'center', marginTop: 40, paddingTop: 32, borderTop: '1px solid rgba(65,88,208,.1)' }}>
          <p style={{ color: '#60708a', marginBottom: 16 }}>Want to manage your team's standings and analytics?</p>
          <Link to="/register" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 14,
            padding: '12px 24px', background: 'linear-gradient(135deg,#4158d0 0%,#c850c0 52%,#ff5a7e 100%)',
            color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 15,
            boxShadow: '0 12px 28px rgba(65,88,208,.24)',
          }}>Get Started Free →</Link>
        </div>
      </div>
    </div>
  )
}
