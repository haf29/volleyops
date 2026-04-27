import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { section: 'Overview',    items: [
    { to: '/dashboard', icon: '🏠', label: 'Dashboard' },
    { to: '/schedule',  icon: '📅', label: 'Schedule' },
    { to: '/standings', icon: '📊', label: 'Standings' },
    { to: '/analytics', icon: '📈', label: 'Analytics', roles: ['admin','coach','assistant_coach'] },
  ]},
  { section: 'Management', items: [
    { to: '/users',    icon: '👤', label: 'Users',          roles: ['admin'] },
    { to: '/players',  icon: '📝', label: 'Registration',   roles: ['admin','coach'] },
    { to: '/teams',    icon: '👥', label: 'Team Rosters',   roles: ['admin','coach','assistant_coach'] },
    { to: '/payments', icon: '💳', label: 'Payments',       roles: ['admin','coach','assistant_coach','player'] },
  ]},
  { section: 'Tools', items: [
    { to: '/tactics',  icon: '🎯', label: 'Tactics Board', roles: ['coach','assistant_coach'] },
    { to: '/messages', icon: '💬', label: 'Communication' },
  ]},
  { section: 'Tryouts & Scouting', items: [
    { to: '/tryouts',      icon: '✅', label: 'Check-In', playerLabel: 'Tryouts', roles: ['coach','assistant_coach','player'] },
    { to: '/evaluations',  icon: '📊', label: 'Evaluations',   roles: ['coach','assistant_coach'] },
    { to: '/ai-placement', icon: '🤖', label: 'AI Positions',  roles: ['coach'] },
    { to: '/attendance',   icon: '📅', label: 'Attendance',    roles: ['coach','assistant_coach'] },
  ]},
  { section: 'Account', items: [
    { to: '/profile',  icon: '⚙️', label: 'My Profile' },
  ]},
]

export default function Sidebar() {
  const { user } = useAuth()

  return (
    <aside className="sidebar">
      {NAV.map(({ section, items }) => {
        const visible = items.filter(
          (item) => !item.roles || item.roles.includes(user?.role)
        )
        if (!visible.length) return null
        return (
          <div key={section}>
            <div className="sidebar-label">{section}</div>
            <div style={{ padding: '0 12px' }}>
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    'sidebar-item' + (isActive ? ' active' : '')
                  }
                >
                  <span className="s-icon">{item.icon}</span>
                  {user?.role === 'player' && item.playerLabel ? item.playerLabel : item.label}
                </NavLink>
              ))}
            </div>
          </div>
        )
      })}
    </aside>
  )
}
