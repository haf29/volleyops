import axios from 'axios'

const ACCESS_TOKEN_KEY = 'accessToken'
const REFRESH_TOKEN_KEY = 'refreshToken'

// Detect backend URL at runtime so Railway cache never causes issues.
// On any *.railway.app domain → use the known backend URL.
// Locally → use the Vite proxy (/api).
function getBaseURL() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.railway.app')) {
    return 'https://volleyops-production.up.railway.app/api'
  }

  return '/api'
}

export const API_BASE_URL = getBaseURL().replace(/\/$/, '')
export const SOCKET_BASE_URL = API_BASE_URL.startsWith('http')
  ? API_BASE_URL.replace(/\/api$/, '')
  : null

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setSessionTokens({ accessToken, refreshToken }) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  clearSharedTokens()
}

export function clearSessionTokens() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  clearSharedTokens()
}

export function clearSharedTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

const api = axios.create({ baseURL: API_BASE_URL })

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401 try to refresh; on failure redirect to login
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = getRefreshToken()
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken })
          setSessionTokens(data)
          original.headers.Authorization = `Bearer ${data.accessToken}`
          return api(original)
        } catch {
          clearSessionTokens()
          window.location.href = '/login'
        }
      } else {
        clearSessionTokens()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
