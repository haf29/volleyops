import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const STATUS_BADGE = { pending: 'badge-yellow', paid: 'badge-green', overdue: 'badge-pink', cancelled: 'badge-dim' }
const TX_BADGE = { pending: 'badge-yellow', approved: 'badge-green', rejected: 'badge-pink', applied: 'badge-purple' }

function CreatePlanModal({ onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', description: '', total_amount: '', installment_count: 1, interval_days: 30 })
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/payments/plans', {
        ...form,
        total_amount: Number(form.total_amount),
        installment_count: Number(form.installment_count),
        interval_days: Number(form.interval_days),
      })
      toast('Plan created', 'success')
      onCreated(data)
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Create Payment Plan</span>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Plan Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full Season Fee" /></div>
          <div className="form-row"><label>Description</label><textarea className="textarea" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description..." /></div>
          <div className="form-grid">
            <div className="form-row"><label>Total Amount ($) *</label><input className="input" type="number" required min="1" step="0.01" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} placeholder="500" /></div>
            <div className="form-row"><label>Installments</label><input className="input" type="number" min="1" max="24" value={form.installment_count} onChange={e => setForm(f => ({ ...f, installment_count: e.target.value }))} /></div>
          </div>
          <div className="form-row"><label>Days Between Installments</label><input className="input" type="number" min="1" value={form.interval_days} onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Plan'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignPlanModal({ onClose, onAssigned }) {
  const toast = useToast()
  const [players, setPlayers] = useState([])
  const [plans, setPlans] = useState([])
  const [playerId, setPlayerId] = useState('')
  const [planId, setPlanId] = useState('')
  const [firstDue, setFirstDue] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/players?status=approved&limit=100'),
      api.get('/payments/plans?active=true'),
    ]).then(([p, pl]) => {
      setPlayers(p.data.players || [])
      setPlans(pl.data.plans || [])
    }).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/payments/assign-plan', {
        playerId: Number(playerId),
        planId: Number(planId),
        firstDueDate: firstDue || undefined,
      })
      toast(`Plan assigned - ${data.payments.length} installment(s) ready`, 'success')
      onAssigned()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span className="modal-title">Assign Payment Plan</span><button className="modal-close" onClick={onClose}>x</button></div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Player *</label>
            <select className="select" required value={playerId} onChange={e => setPlayerId(e.target.value)}>
              <option value="">Select player...</option>
              {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Payment Plan *</label>
            <select className="select" required value={planId} onChange={e => setPlanId(e.target.value)}>
              <option value="">Select plan...</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name} - ${Number(p.total_amount).toLocaleString()} ({p.installment_count} installment{p.installment_count > 1 ? 's' : ''})</option>)}
            </select>
          </div>
          <div className="form-row"><label>First Due Date</label><input className="input" type="date" value={firstDue} onChange={e => setFirstDue(e.target.value)} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Assigning...' : 'Assign Plan'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function WalletTopUpModal({ onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({ amount: '', note: '' })
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/payments/wallet/top-up', {
        amount: Number(form.amount),
        note: form.note || undefined,
      })
      toast('Wallet funded successfully', 'success')
      onCreated()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add funds', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add Funds</span>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Amount ($) *</label>
            <input className="input" type="number" min="1" step="0.01" required value={form.amount} onChange={e => setForm(v => ({ ...v, amount: e.target.value }))} placeholder="100" />
          </div>
          <div className="form-row"><label>Note</label>
            <textarea className="textarea" rows={2} value={form.note} onChange={e => setForm(v => ({ ...v, note: e.target.value }))} placeholder="Optional note for your wallet history..." />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            This adds funds directly to your wallet. After that, you can purchase a payment plan using your balance.
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Adding...' : 'Add Funds'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function WalletPanel({ wallet, onAddFunds }) {
  if (!wallet) return null

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Wallet Balance</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Add money first, then choose a plan and pay for it from your wallet.
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAddFunds}>Add Funds</button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: wallet.transactions?.length ? 16 : 0 }}>
        <div className="kpi-card"><div className="kpi-icon green">W</div><div className="kpi-value">${Number(wallet.balance || 0).toLocaleString()}</div><div className="kpi-label">Available</div></div>
        <div className="kpi-card"><div className="kpi-icon yellow">D</div><div className="kpi-value">${Number(wallet.approved_deposits || 0).toLocaleString()}</div><div className="kpi-label">Deposited</div></div>
        <div className="kpi-card"><div className="kpi-icon purple">U</div><div className="kpi-value">${Number(wallet.spent_amount || 0).toLocaleString()}</div><div className="kpi-label">Used</div></div>
      </div>

      {wallet.transactions?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Recent Wallet Activity
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {wallet.transactions.slice(0, 6).map(tx => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {tx.type === 'deposit' ? (tx.note || 'Wallet top-up') : tx.payment_description || 'Wallet payment'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(tx.created_at).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: Number(tx.amount) >= 0 ? 'var(--green)' : 'var(--text)' }}>
                    {Number(tx.amount) >= 0 ? '+' : '-'}${Math.abs(Number(tx.amount)).toLocaleString()}
                  </div>
                  <span className={`badge ${TX_BADGE[tx.status] || 'badge-dim'}`}>{tx.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PlanStore({ plans, walletBalance, canPurchase, purchasingPlanId, onPurchase }) {
  if (!plans.length) return null

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Purchase a Plan</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Choose a plan and apply your wallet balance to its installments. Any unpaid installments stay in the regular payments flow for reminders and admin tracking.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {plans.map(plan => {
          const perInstallment = Number(plan.total_amount) / Math.max(1, Number(plan.installment_count))
          return (
            <div key={plan.id} style={{ padding: 16, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{plan.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{plan.description || 'Club payment plan'}</div>
                </div>
                <span className="badge badge-purple">${Number(plan.total_amount).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                {plan.installment_count} installment{plan.installment_count > 1 ? 's' : ''} · about ${perInstallment.toFixed(2)} each
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={!canPurchase || walletBalance <= 0 || purchasingPlanId === plan.id}
                onClick={() => onPurchase(plan.id)}
              >
                {purchasingPlanId === plan.id ? 'Purchasing...' : 'Purchase From Wallet'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Payments() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [payments, setPayments] = useState([])
  const [summary, setSummary] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [plans, setPlans] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ status: '', overdue_only: false, page: 1 })
  const [showPlan, setShowPlan] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)
  const [working, setWorking] = useState(false)
  const [purchasingPlanId, setPurchasingPlanId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: 50, page: filters.page }
      if (filters.status) params.status = filters.status
      if (filters.overdue_only) params.overdue_only = 'true'

      const requestsToLoad = [
        api.get('/payments', { params }),
        api.get('/payments/summary'),
      ]

      if (!isAdmin) {
        requestsToLoad.push(api.get('/payments/wallet'))
        requestsToLoad.push(api.get('/payments/plans?active=true'))
      }

      const [pay, sum, extraA, extraB] = await Promise.all(requestsToLoad)
      setPayments(pay.data.payments || [])
      setTotal(pay.data.total || 0)
      setSummary(sum.data)

      if (!isAdmin) {
        setWallet(extraA?.data || null)
        setPlans(extraB?.data?.plans || [])
      }
    } catch {
      toast('Failed to load payments', 'error')
    } finally {
      setLoading(false)
    }
  }, [filters, isAdmin, toast])

  useEffect(() => { load() }, [load])

  async function markPaid(id) {
    setWorking(true)
    try {
      await api.patch(`/payments/${id}/status`, { status: 'paid' })
      toast('Payment marked as paid', 'success')
      load()
    } catch {
      toast('Failed', 'error')
    } finally {
      setWorking(false)
    }
  }

  async function sendReminder(id) {
    try {
      await api.post(`/payments/${id}/remind`)
      toast('Reminder sent', 'success')
    } catch {
      toast('Failed to send reminder', 'error')
    }
  }

  async function purchasePlan(planId) {
    setPurchasingPlanId(planId)
    try {
      const { data } = await api.post('/payments/wallet/purchase-plan', { planId })
      toast(
        data.applied_payments
          ? `Plan linked and ${data.applied_payments} payment(s) were paid from wallet`
          : 'Plan linked to your account. Add more wallet funds to cover installments.',
        'success',
      )
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to purchase plan', 'error')
    } finally {
      setPurchasingPlanId(null)
    }
  }

  const canPurchasePlan = Boolean(wallet?.can_request_purchase)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Payments</div>
          <div className="page-subtitle">
            {isAdmin
              ? `${total} records - manage fees, plans, and reminders`
              : `${total} records - add wallet funds, purchase plans, and track dues`}
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowPlan(true)}>+ New Plan</button>
            <button className="btn btn-primary" onClick={() => setShowAssign(true)}>Assign Plan</button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <>
          <WalletPanel wallet={wallet} onAddFunds={() => setShowTopUp(true)} />
          <PlanStore plans={plans} walletBalance={Number(wallet?.balance || 0)} canPurchase={canPurchasePlan} purchasingPlanId={purchasingPlanId} onPurchase={purchasePlan} />
        </>
      )}

      {summary && (
        <div className="kpi-grid mb-6">
          <div className="kpi-card"><div className="kpi-icon green">$</div><div className="kpi-value">${Number(summary.paid_amount || 0).toLocaleString()}</div><div className="kpi-label">Collected</div></div>
          <div className="kpi-card"><div className="kpi-icon yellow">P</div><div className="kpi-value">${Number(summary.pending_amount || 0).toLocaleString()}</div><div className="kpi-label">Pending</div></div>
          <div className="kpi-card"><div className="kpi-icon pink">!</div><div className="kpi-value">${Number(summary.overdue_amount || 0).toLocaleString()}</div><div className="kpi-label">Overdue</div></div>
          <div className="kpi-card"><div className="kpi-icon purple">%</div><div className="kpi-value">{summary.completion_rate}%</div><div className="kpi-label">Collection Rate</div>
            <div style={{ marginTop: 8, height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${summary.completion_rate}%`, background: 'var(--grad2)', borderRadius: 3 }} />
            </div>
          </div>
        </div>
      )}

      <div className="filter-row">
        {['', 'pending', 'paid', 'overdue', 'cancelled'].map(s => (
          <button key={s || 'all'} className={`filter-btn ${filters.status === s && !filters.overdue_only ? 'active' : ''}`}
            onClick={() => setFilters(f => ({ ...f, status: s, overdue_only: false, page: 1 }))}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
        <button className={`filter-btn ${filters.overdue_only ? 'active' : ''}`}
          onClick={() => setFilters(f => ({ ...f, overdue_only: !f.overdue_only, status: '', page: 1 }))}>
          Overdue Only
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : payments.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">$</div><p>No payments found</p></div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>{isAdmin ? 'Player' : 'Member'}</th><th>Description</th><th>Amount</th><th>Due Date</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-name">
                          <div className="avatar">{(p.player_name || '?').charAt(0)}</div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{p.player_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.team_name || 'No team'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{p.description || '-'}</div>
                        {p.plan_name && <div style={{ fontSize: 11, color: 'var(--purple-light)' }}>Plan: {p.plan_name}</div>}
                        {p.installment_number && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Installment {p.installment_number}</div>}
                      </td>
                      <td style={{ fontWeight: 700, color: p.status === 'paid' ? 'var(--green)' : p.overdue ? 'var(--pink)' : 'var(--text)' }}>
                        ${Number(p.amount).toLocaleString()}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {p.due_date ? new Date(p.due_date).toLocaleDateString() : '-'}
                        {p.overdue && <div style={{ fontSize: 11, color: 'var(--pink)', fontWeight: 600 }}>OVERDUE</div>}
                      </td>
                      <td><span className={`badge ${STATUS_BADGE[p.status] || 'badge-dim'}`}>{p.status}</span></td>
                      {isAdmin && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {p.status !== 'paid' && p.status !== 'cancelled' && (
                              <button className="btn btn-green btn-sm" disabled={working} onClick={() => markPaid(p.id)}>Mark Paid</button>
                            )}
                            {p.status !== 'paid' && (
                              <button className="btn btn-secondary btn-sm" onClick={() => sendReminder(p.id)}>Remind</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(() => {
              const pages = Math.ceil(total / 50)
              if (pages <= 1) return null
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-secondary btn-sm" disabled={filters.page <= 1}
                    onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>‹ Prev</button>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {filters.page} of {pages}</span>
                  <button className="btn btn-secondary btn-sm" disabled={filters.page >= pages}
                    onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>Next ›</button>
                </div>
              )
            })()}
          </>
        )}
      </div>

      {showPlan && <CreatePlanModal onClose={() => setShowPlan(false)} onCreated={() => { setShowPlan(false); load() }} />}
      {showAssign && <AssignPlanModal onClose={() => setShowAssign(false)} onAssigned={() => { setShowAssign(false); load() }} />}
      {showTopUp && <WalletTopUpModal onClose={() => setShowTopUp(false)} onCreated={() => { setShowTopUp(false); load() }} />}
    </div>
  )
}
