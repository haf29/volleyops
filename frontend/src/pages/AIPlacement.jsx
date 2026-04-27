import { useState, useEffect } from 'react'
import api from '../api/client'
import { useToast } from '../context/ToastContext'

const CONFIDENCE_STYLE = {
  high:   { badge: 'badge-green', label: 'High' },
  medium: { badge: 'badge-cyan',  label: 'Medium' },
  low:    { badge: 'badge-dim',   label: 'Low' },
}

const POS_LABELS = {
  setter: 'Setter',
  libero: 'Libero',
  outside_hitter: 'Outside Hitter',
  opposite: 'Opposite',
  middle_blocker: 'Middle Blocker',
  defensive_specialist: 'Defensive Specialist',
}

const STAT_LABELS = [
  ['matches_played', 'Matches'],
  ['sets_played', 'Sets'],
  ['points', 'Points'],
  ['kills', 'Kills'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['digs', 'Digs'],
  ['errors', 'Errors'],
]

const EVAL_LABELS = [
  ['serving', 'Serving'],
  ['passing', 'Passing'],
  ['setting', 'Setting'],
  ['hitting', 'Hitting'],
  ['blocking', 'Blocking'],
  ['defense', 'Defense'],
  ['athleticism', 'Athleticism'],
  ['coachability', 'Coachability'],
]

function confidenceStyle(confidence) {
  return CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.low
}

function topFits(fitScores = {}) {
  return Object.entries(fitScores)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 3)
}

function sourceLabel(source, model) {
  if (source === 'openai') return model ? `OpenAI - ${model}` : 'OpenAI'
  if (source === 'fallback') return 'Algorithmic fallback'
  return null
}

export default function AIPlacement() {
  const toast = useToast()
  const [tryouts, setTryouts] = useState([])
  const [teams, setTeams] = useState([])
  const [selTryout, setSelTryout] = useState('')
  const [selTeam, setSelTeam] = useState('')
  const [recommendations, setRecommendations] = useState(null)
  const [source, setSource] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    Promise.all([api.get('/tryouts'), api.get('/teams')])
      .then(([t, tm]) => {
        const nextTryouts = t.data.tryouts || []
        const nextTeams = tm.data.teams || []
        setTryouts(nextTryouts)
        setTeams(nextTeams)
        if (!selTryout && nextTryouts.length) setSelTryout(String(nextTryouts[0].id))
        if (!selTeam && nextTeams.length) setSelTeam(String(nextTeams[0].id))
      })
      .catch(() => toast('Failed to load AI inputs', 'error'))
  }, [])

  async function generate() {
    if (!selTryout) { toast('Please select a tryout first', 'error'); return }
    if (!selTeam) { toast('Please select your team first', 'error'); return }

    setLoading(true)
    setRecommendations(null)
    setMeta(null)
    try {
      const { data } = await api.post('/ai/position-recommendations', {
        tryout_id: Number(selTryout),
        team_id: Number(selTeam),
      })
      setRecommendations(data.recommendations || [])
      setSource(data.source)
      setMeta({ team: data.team, tryout: data.tryout, season: data.season, model: data.model })
      if (!data.recommendations?.length) {
        toast('No evaluated players found for this tryout', 'error')
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to generate recommendations', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">AI Position Recommendations</div>
          <div className="page-subtitle">
            Suggest positions inside your team using coach evaluations plus match stats
          </div>
        </div>
        {source && (
          <span className="badge badge-dim">
            {sourceLabel(source, meta?.model)}
          </span>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span style={{ fontWeight: 700 }}>Configure Position Run</span>
        </div>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="form-row">
            <label>Tryout / evaluation set *</label>
            <select className="input" value={selTryout} onChange={e => setSelTryout(e.target.value)}>
              <option value="">Select tryout</option>
              {tryouts.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({new Date(t.date).toLocaleDateString()})</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Coach team *</label>
            <select className="input" value={selTeam} onChange={e => setSelTeam(e.target.value)}>
              <option value="">Select team</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={loading || !selTryout || !selTeam}
          style={{ minWidth: 220 }}>
          {loading
            ? <><span className="spinner" style={{ width: 14, height: 14, marginRight: 8 }} />Analyzing...</>
            : 'Generate Position Recommendations'}
        </button>
      </div>

      {loading && (
        <div className="loading-center" style={{ height: 200 }}>
          <div className="spinner" style={{ width: 40, height: 40 }} />
          <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 14 }}>
            Reading evaluations, player stats, and position fit...
          </div>
        </div>
      )}

      {!loading && recommendations !== null && recommendations.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">AI</div>
          <p>No recommendations generated. Add coach evaluations for this tryout first.</p>
        </div>
      )}

      {!loading && recommendations?.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {recommendations.length} position recommendation{recommendations.length !== 1 ? 's' : ''} for {meta?.team?.name}
              {meta?.season ? ` - ${meta.season}` : ''}
            </div>
            <span className="badge badge-dim" style={{ fontSize: 11 }}>
              Uses evaluations + all recorded stat categories
              {sourceLabel(source, meta?.model) ? ` - ${sourceLabel(source, meta?.model)}` : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
            {recommendations.map(rec => {
              const cs = confidenceStyle(rec.confidence)
              const fits = topFits(rec.fit_scores)
              const maxFit = Math.max(...fits.map(([, score]) => Number(score || 0)), 1)

              return (
                <div key={rec.player_id} className="card" style={{ borderLeft: '3px solid var(--cyan)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>{rec.player_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Current: {POS_LABELS[rec.current_position] || rec.current_position || 'Not set'}
                      </div>
                    </div>
                    <span className={`badge ${cs.badge}`}>{cs.label} confidence</span>
                  </div>

                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      Recommended position
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 20, color: 'var(--cyan)', marginTop: 3 }}>
                      {rec.recommended_position_label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      Secondary: {rec.secondary_position_label} - {rec.role_focus} - Fit {rec.fit_score}
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                      Position fit
                    </div>
                    {fits.map(([position, score]) => (
                      <div key={position} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 118, fontSize: 11, color: 'var(--text-muted)' }}>{POS_LABELS[position]}</div>
                        <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${(Number(score || 0) / maxFit) * 100}%`, height: '100%', background: 'var(--cyan)', borderRadius: 3 }} />
                        </div>
                        <div style={{ width: 34, textAlign: 'right', fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--cyan)' }}>{score}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                        Evaluations
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                        {EVAL_LABELS.map(([key, label]) => (
                          <div key={key} style={{ background: 'var(--surface2)', borderRadius: 7, padding: '6px 7px' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</div>
                            <div style={{ fontSize: 13, fontWeight: 800 }}>{rec.evaluation_scores?.[key] != null ? Number(rec.evaluation_scores[key]).toFixed(1) : '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                        Match stats
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                        {STAT_LABELS.map(([key, label]) => (
                          <div key={key} style={{ background: 'var(--surface2)', borderRadius: 7, padding: '6px 7px' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</div>
                            <div style={{ fontSize: 13, fontWeight: 800 }}>{rec.season_stats?.[key] ?? 0}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, fontStyle: 'italic' }}>
                    "{rec.reasoning}"
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
