import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const POSITIONS = ['setter','libero','outside_hitter','opposite','middle_blocker','defensive_specialist']
const POSITION_LABELS = {
  setter: 'Setter', libero: 'Libero', outside_hitter: 'Outside Hitter',
  opposite: 'Opposite', middle_blocker: 'Middle Blocker', defensive_specialist: 'Defensive Specialist',
}

const ROLES = [
  { value: 'player',          label: 'Player',           icon: '🏐', desc: 'Join a team and compete this season' },
  { value: 'coach',           label: 'Head Coach',        icon: '🎽', desc: 'Coach and manage a team' },
  { value: 'assistant_coach', label: 'Assistant Coach',   icon: '📋', desc: 'Support your head coach' },
]

export default function Register() {
  const navigate = useNavigate()
  const { setUserFromTokens } = useAuth()

  const [teams,        setTeams]        = useState([])
  const [teamsError,   setTeamsError]   = useState('')
  const [role,         setRole]         = useState('player')
  const [newTeam,      setNewTeam]      = useState(false)   // "my team is not listed"
  const [form,         setForm]         = useState({
    name: '', email: '', password: '', confirmPassword: '',
    team_id: '', new_team_name: '', phone: '',
    date_of_birth: '', position: '', jersey_number: '', season: '', notes: '',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function loadTeams() {
    setTeamsError('')
    api.get('/teams/public')
      .then(({ data }) => setTeams(data.teams || []))
      .catch((err) => {
        console.error('Failed to load teams:', err)
        setTeamsError('Could not load teams. Check your connection and try again.')
      })
  }

  useEffect(() => { loadTeams() }, [])

  function set(field) { return (e) => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (role === 'player' && !form.team_id) { setError('Please select a team.'); return }
    if ((role === 'coach' || role === 'assistant_coach') && !newTeam && !form.team_id) {
      setError('Please select your team.'); return
    }
    if ((role === 'coach' || role === 'assistant_coach') && newTeam && !form.new_team_name.trim()) {
      setError('Please enter your team name.'); return
    }

    setLoading(true)
    try {
      const payload = {
        name:     form.name,
        email:    form.email,
        password: form.password,
        role,
        phone:    form.phone || undefined,
        notes:    form.notes || undefined,
      }

      if (role === 'player') {
        payload.team_id       = Number(form.team_id)
        payload.date_of_birth = form.date_of_birth || undefined
        payload.position      = form.position      || undefined
        payload.jersey_number = form.jersey_number ? Number(form.jersey_number) : undefined
        payload.season        = form.season        || undefined
      } else {
        if (newTeam) {
          payload.new_team_name = form.new_team_name.trim()
        } else {
          payload.team_id = Number(form.team_id)
        }
      }

      const { data } = await api.post('/auth/register', payload)
      localStorage.setItem('accessToken',  data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      setUserFromTokens(data.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const isStaff = role === 'coach' || role === 'assistant_coach'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 600 }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏐</div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.7rem', background: 'var(--grad1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Join VolleyOps
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Create your account to get started</p>
        </div>

        <div className="card">
          {error && (
            <div style={{ background: 'rgba(236,72,153,.1)', border: '1px solid rgba(236,72,153,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, color: 'var(--pink)', fontSize: 13 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>

            {/* ── Role selector ── */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              I am registering as a…
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 22 }}>
              {ROLES.map(r => (
                <button key={r.value} type="button"
                  onClick={() => { setRole(r.value); setNewTeam(false); setForm(f => ({ ...f, team_id: '', new_team_name: '' })) }}
                  style={{
                    padding: '14px 10px', borderRadius: 12,
                    border: `2px solid ${role === r.value ? 'var(--purple)' : 'var(--border)'}`,
                    background: role === r.value ? 'rgba(124,58,237,.12)' : 'var(--surface2)',
                    cursor: 'pointer', transition: 'all .15s', textAlign: 'center',
                  }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{r.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: role === r.value ? 'var(--purple-light)' : 'var(--text)', marginBottom: 3 }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>{r.desc}</div>
                </button>
              ))}
            </div>

            {/* ── Account details ── */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Account Details
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label>Full Name *</label>
                <input className="input" type="text" placeholder="Sara Hassan" value={form.name} onChange={set('name')} required />
              </div>
              <div className="form-row">
                <label>Email *</label>
                <input className="input" type="email" placeholder="sara@example.com" value={form.email} onChange={set('email')} required />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label>Password *</label>
                <input className="input" type="password" placeholder="Min. 8 characters" value={form.password} onChange={set('password')} required minLength={8} />
              </div>
              <div className="form-row">
                <label>Confirm Password *</label>
                <input className="input" type="password" placeholder="Repeat password" value={form.confirmPassword} onChange={set('confirmPassword')} required />
              </div>
            </div>

            <div className="form-row">
              <label>Phone</label>
              <input className="input" type="tel" placeholder="+961 71 000 000" value={form.phone} onChange={set('phone')} />
            </div>

            {/* ── Team section (shared for all roles) ── */}
            <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              {isStaff ? 'Your Team' : 'Player Details'}
            </div>

            {/* Team dropdown */}
            {!newTeam && (
              <div className="form-row">
                <label>{isStaff ? 'Team to Coach *' : 'Team *'}</label>
                {teamsError ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--pink)' }}>{teamsError}</span>
                    <button type="button" onClick={loadTeams}
                      style={{ fontSize: 12, color: 'var(--purple-light)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      Retry
                    </button>
                  </div>
                ) : null}
                <select className="select" value={form.team_id} onChange={set('team_id')}
                  required={!newTeam && (role === 'player' || isStaff)}>
                  <option value="">{teams.length === 0 && !teamsError ? 'Loading teams…' : 'Select a team…'}</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.division ? ` — ${t.division}` : ''}{t.season ? ` (${t.season})` : ''}
                      {role === 'player' ? ` · ${t.player_count}/${t.max_players} players` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* "My team is not listed" — staff only */}
            {isStaff && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={newTeam}
                    onChange={e => { setNewTeam(e.target.checked); setForm(f => ({ ...f, team_id: '', new_team_name: '' })) }}
                    style={{ accentColor: 'var(--purple)', width: 15, height: 15 }} />
                  My team is not listed — I want to register a new team
                </label>
              </div>
            )}

            {/* New team name input */}
            {isStaff && newTeam && (
              <div className="form-row">
                <label>New Team Name *</label>
                <input className="input" type="text" placeholder="e.g. Tripoli Eagles" value={form.new_team_name} onChange={set('new_team_name')} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Your team will appear on the platform once an admin approves your registration.
                </div>
              </div>
            )}

            {/* ── Player-only extra fields ── */}
            {role === 'player' && (
              <>
                <div className="form-grid">
                  <div className="form-row">
                    <label>Date of Birth</label>
                    <input className="input" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
                  </div>
                  <div className="form-row">
                    <label>Jersey Number</label>
                    <input className="input" type="number" placeholder="7" min="0" max="99" value={form.jersey_number} onChange={set('jersey_number')} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-row">
                    <label>Preferred Position</label>
                    <select className="select" value={form.position} onChange={set('position')}>
                      <option value="">Select position…</option>
                      {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Season</label>
                    <input className="input" type="text" placeholder="2025-2026" value={form.season} onChange={set('season')} />
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            <div className="form-row">
              <label>Notes / Additional Info</label>
              <textarea className="textarea"
                placeholder={isStaff ? 'Experience, certifications, or anything else for the admin…' : 'Any additional information for the coaching staff…'}
                value={form.notes} onChange={set('notes')} rows={2} />
            </div>

            {/* Staff approval notice */}
            {isStaff && (
              <div style={{ background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 4, fontSize: 12, color: 'var(--cyan)' }}>
                Coaching staff accounts require admin approval before you can access the platform.
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 14, marginTop: 16 }}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--purple-light)', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
