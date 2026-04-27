import { createContext, useContext, useState, useEffect } from 'react'
import api, {
  clearSessionTokens,
  clearSharedTokens,
  getAccessToken,
  getRefreshToken,
  setSessionTokens,
} from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Restore this tab's session. sessionStorage keeps separate browser tabs independent.
  useEffect(() => {
    clearSharedTokens()
    const token = getAccessToken()
    if (token) {
      api.get('/auth/me')
        .then(({ data }) => setUser(data))
        .catch(() => { clearSessionTokens(); setUser(null) })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password })
    setSessionTokens(data)
    // Fetch full profile so player_status is included
    const { data: me } = await api.get('/auth/me')
    setUser(me)
    return me
  }

  // Called right after player self-registration to set state without a round-trip
  function setUserFromTokens(userData) {
    setUser(userData)
  }

  async function logout() {
    const refreshToken = getRefreshToken()
    try { await api.post('/auth/logout', { refreshToken }) } catch {}
    clearSessionTokens()
    setUser(null)
  }

  const isAdmin        = user?.role === 'admin'
  const isCoach        = user?.role === 'coach'
  const isAssistant    = user?.role === 'assistant_coach'
  const canManage      = isAdmin || isCoach
  const canManageFixtures = isAdmin || isCoach
  // Assistant coaches can schedule practices but not matches or lineup assignments
  const canSchedulePractice = isAdmin || isCoach || isAssistant
  // Only the head coach (not assistant) makes starter/sub lineup decisions
  const canManageLineups = isCoach
  // Only coaches can add/remove players from team rosters; admins are view-only for rosters
  const canManageRoster = isCoach
  const isPlayer       = user?.role === 'player'
  const playerStatus   = user?.player_status ?? null   // 'pending' | 'approved' | 'rejected' | 'waitlisted' | null
  // Players need registration_status=approved; coaches/asst_coaches need is_active=1; admins always pass
  const isApproved     = isPlayer
    ? playerStatus === 'approved'
    : (isCoach || isAssistant)
      ? user?.is_active === 1
      : true

  return (
    <AuthContext.Provider value={{
      user, loading,
      login, logout, setUserFromTokens,
      isAdmin, isCoach, isAssistant, canManage, canManageRoster,
      canManageFixtures, canSchedulePractice, canManageLineups,
      isPlayer, playerStatus, isApproved,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
