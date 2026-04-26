import axios from 'axios'

// Detect backend URL at runtime so Railway cache never causes issues.
// On any *.railway.app domain → use the known backend URL.
// Locally → use the Vite proxy (/api).
function getBaseURL() {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.railway.app')) {
    return 'https://volleyops-production.up.railway.app/api'
  }
  return import.meta.env.VITE_API_URL || '/api'
}

const api = axios.create({ baseURL: getBaseURL() })

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
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
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken })
          localStorage.setItem('accessToken',  data.accessToken)
          localStorage.setItem('refreshToken', data.refreshToken)
          original.headers.Authorization = `Bearer ${data.accessToken}`
          return api(original)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      } else {
        localStorage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
