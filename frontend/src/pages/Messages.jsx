import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'

function Avatar({ name, size = 36, style: s = {} }) {
  const colors = ['#7c3aed','#ec4899','#06b6d4','#10b981','#f59e0b']
  const color  = colors[name?.charCodeAt(0) % colors.length] || '#7c3aed'
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0, ...s }}>
      {name?.charAt(0).toUpperCase()}
    </div>
  )
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  return new Date(iso).toLocaleDateString()
}

export default function Messages() {
  const { user, isAdmin } = useAuth()
  const { socket } = useSocket()
  const toast = useToast()

  const [convos,   setConvos]   = useState([])
  const [active,   setActive]   = useState(null)
  const [messages, setMessages] = useState([])
  const [text,     setText]     = useState('')
  const [sending,  setSending]  = useState(false)
  const [typing,   setTyping]   = useState(null)
  const [tab,      setTab]      = useState('All')
  const [search,   setSearch]   = useState('')

  // "New Direct Message" panel
  const [showNewMsg,    setShowNewMsg]    = useState(false)
  const [userSearch,    setUserSearch]    = useState('')
  const [userResults,   setUserResults]   = useState([])
  const [userSearching, setUserSearching] = useState(false)

  // "New Group" panel
  const [showNewGroup,    setShowNewGroup]    = useState(false)
  const [groupName,       setGroupName]       = useState('')
  const [groupSearch,     setGroupSearch]     = useState('')
  const [groupResults,    setGroupResults]    = useState([])
  const [groupSearching,  setGroupSearching]  = useState(false)
  const [selectedMembers, setSelectedMembers] = useState([])
  const [creatingGroup,   setCreatingGroup]   = useState(false)

  const messagesEndRef = useRef(null)
  const typingTimer    = useRef(null)
  const prevConvoId    = useRef(null)
  const searchTimer    = useRef(null)
  const groupTimer     = useRef(null)

  // Load conversations
  const loadConvos = useCallback(() => {
    api.get('/messages/conversations')
      .then(({ data }) => setConvos(data.conversations || []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadConvos() }, [loadConvos])

  // Live user search — scoped by role on the backend
  function handleUserSearch(e) {
    const q = e.target.value
    setUserSearch(q)
    clearTimeout(searchTimer.current)
    if (!q.trim()) { setUserResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setUserSearching(true)
      try {
        const { data } = await api.get(`/messages/users/search?mode=direct&q=${encodeURIComponent(q.trim())}`)
        setUserResults(data.users || [])
      } catch { setUserResults([]) }
      finally { setUserSearching(false) }
    }, 200)
  }

  async function startDirectConvo(targetUser) {
    try {
      const { data } = await api.post('/messages/conversations', { type: 'direct', memberIds: [targetUser.id] })
      setShowNewMsg(false)
      setUserSearch('')
      setUserResults([])
      loadConvos()
      openConvo({ ...data.conversation, display_name: targetUser.name })
    } catch { toast('Failed to open conversation', 'error') }
  }

  function handleGroupSearch(e) {
    const q = e.target.value
    setGroupSearch(q)
    clearTimeout(groupTimer.current)
    groupTimer.current = setTimeout(async () => {
      setGroupSearching(true)
      try {
        const { data } = await api.get(`/messages/users/search?mode=group&q=${encodeURIComponent(q.trim())}`)
        const alreadyIds = new Set(selectedMembers.map(m => m.id))
        setGroupResults((data.users || []).filter(u => !alreadyIds.has(u.id)))
      } catch { setGroupResults([]) }
      finally { setGroupSearching(false) }
    }, 200)
  }

  function toggleMember(u) {
    setSelectedMembers(prev => {
      const exists = prev.find(m => m.id === u.id)
      if (exists) return prev.filter(m => m.id !== u.id)
      return [...prev, u]
    })
    setGroupResults(prev => prev.filter(r => r.id !== u.id))
  }

  function removeMember(u) {
    setSelectedMembers(prev => prev.filter(m => m.id !== u.id))
  }

  async function createGroup() {
    if (!groupName.trim()) { toast('Enter a group name', 'error'); return }
    if (selectedMembers.length < 1) { toast('Add at least one member', 'error'); return }
    setCreatingGroup(true)
    try {
      const { data } = await api.post('/messages/conversations', {
        type: 'group',
        name: groupName.trim(),
        memberIds: selectedMembers.map(m => m.id),
      })
      setShowNewGroup(false)
      setGroupName('')
      setSelectedMembers([])
      setGroupSearch('')
      setGroupResults([])
      loadConvos()
      openConvo({ ...data.conversation, display_name: data.conversation.name })
    } catch { toast('Failed to create group', 'error') }
    finally { setCreatingGroup(false) }
  }

  function openNewMsgPanel() {
    setShowNewMsg(v => !v)
    setShowNewGroup(false)
    setUserSearch('')
    setUserResults([])
  }

  function openNewGroupPanel() {
    setShowNewGroup(v => !v)
    setShowNewMsg(false)
    setGroupName('')
    setGroupSearch('')
    setGroupResults([])
    setSelectedMembers([])
  }

  // Socket events
  useEffect(() => {
    if (!socket) return
    const onMsg = (msg) => {
      if (msg.conversation_id === active?.id && msg.sender_id !== user?.id) {
        // Only append messages from others — own messages are already added by send()
        setMessages((prev) => [...prev, msg])
      }
      loadConvos()
    }
    const onTyping = ({ userId: uid, isTyping }) => {
      if (uid !== user?.id) setTyping(isTyping ? uid : null)
    }
    socket.on('message_created', onMsg)
    socket.on('user_typing',     onTyping)
    return () => { socket.off('message_created', onMsg); socket.off('user_typing', onTyping) }
  }, [socket, active?.id, user?.id, loadConvos])

  // Join/leave conversation rooms
  useEffect(() => {
    if (!socket) return
    if (prevConvoId.current) socket.emit('leave_conversation', prevConvoId.current)
    if (active?.id) {
      socket.emit('join_conversation', active.id)
      prevConvoId.current = active.id
    }
  }, [socket, active?.id])

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function openConvo(c) {
    setActive(c)
    setMessages([])
    api.get(`/messages/conversations/${c.id}/messages`)
      .then(({ data }) => {
        setMessages(data.messages || [])
        // Mark as read
        api.post(`/messages/conversations/${c.id}/read`).catch(() => {})
        loadConvos()
      })
      .catch(() => {})
  }

  async function send() {
    if (!text.trim() || !active) return
    setSending(true)
    try {
      const { data } = await api.post(`/messages/conversations/${active.id}/messages`, { content: text.trim() })
      setMessages((prev) => [...prev, data.message])
      setText('')
      loadConvos()
    } catch { toast('Failed to send message', 'error') }
    finally { setSending(false) }
  }

  function handleTyping(e) {
    setText(e.target.value)
    if (!socket || !active) return
    socket.emit('typing', { conversationId: active.id, isTyping: true })
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      socket.emit('typing', { conversationId: active.id, isTyping: false })
    }, 1500)
  }

  function onKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  const filteredConvos = convos.filter((c) => {
    if (tab === 'Teams') return c.type === 'team'
    if (tab === 'Direct') return c.type === 'direct'
    return true
  }).filter((c) => !search || (c.display_name || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px - 56px)', gap: 0, margin: '-28px -32px', background: 'var(--bg)' }}>

      {/* ── Conversations panel ── */}
      <div style={{ width: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Messages</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={openNewMsgPanel}
                title="New direct message"
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${showNewMsg ? 'var(--purple)' : 'var(--border)'}`, background: showNewMsg ? 'rgba(124,58,237,.2)' : 'transparent', color: showNewMsg ? 'var(--purple-light)' : 'var(--text-muted)', fontFamily: 'DM Sans, sans-serif' }}>
                ✉
              </button>
              <button onClick={openNewGroupPanel}
                title="New group"
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${showNewGroup ? 'var(--purple)' : 'var(--border)'}`, background: showNewGroup ? 'rgba(124,58,237,.2)' : 'transparent', color: showNewGroup ? 'var(--purple-light)' : 'var(--text-muted)', fontFamily: 'DM Sans, sans-serif' }}>
                👥
              </button>
            </div>
          </div>

          {/* Panel: new direct message */}
          {showNewMsg && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12 }}>🔍</span>
                <input autoFocus
                  style={{ width: '100%', background: 'var(--surface2)', border: '1.5px solid var(--purple)', borderRadius: 8, padding: '7px 12px 7px 30px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
                  placeholder="Search by name or email…"
                  value={userSearch} onChange={handleUserSearch} />
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 200, overflowY: 'auto' }}>
                {userSearching && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
                {!userSearching && userSearch && userResults.length === 0 && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No users found</div>}
                {!userSearch && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-dim)' }}>Type to find someone to message…</div>}
                {userResults.map(u => (
                  <div key={u.id} onClick={() => startDirectConvo(u)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <Avatar name={u.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.role?.replace(/_/g, ' ')} · {u.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Panel: new group */}
          {showNewGroup && (
            <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                style={{ width: '100%', background: 'var(--surface2)', border: '1.5px solid var(--purple)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
                placeholder="Group name…"
                value={groupName} onChange={e => setGroupName(e.target.value)} />

              {/* Selected members chips */}
              {selectedMembers.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedMembers.map(m => (
                    <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: 'rgba(124,58,237,.2)', color: 'var(--purple-light)', border: '1px solid rgba(124,58,237,.3)' }}>
                      {m.name}
                      <span onClick={() => removeMember(m)} style={{ cursor: 'pointer', marginLeft: 2, opacity: .7 }}>✕</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Member search */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12 }}>🔍</span>
                <input
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px 7px 30px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
                  placeholder="Add members…"
                  value={groupSearch} onChange={handleGroupSearch} />
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 160, overflowY: 'auto' }}>
                {groupSearching && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
                {!groupSearching && groupSearch && groupResults.length === 0 && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No users found</div>}
                {!groupSearch && !groupSearching && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-dim)' }}>Type to find members to add…</div>}
                {groupResults.map(u => (
                  <div key={u.id} onClick={() => toggleMember(u)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <Avatar name={u.name} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.role?.replace(/_/g, ' ')}</div>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--purple-light)' }}>+</span>
                  </div>
                ))}
              </div>
              <button onClick={createGroup} disabled={creatingGroup || !groupName.trim() || selectedMembers.length < 1}
                style={{ padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'DM Sans, sans-serif', background: 'var(--grad1)', color: '#fff', opacity: (!groupName.trim() || selectedMembers.length < 1) ? .5 : 1 }}>
                {creatingGroup ? 'Creating…' : `Create Group${selectedMembers.length ? ` (${selectedMembers.length + 1})` : ''}`}
              </button>
            </div>
          )}

          {/* Conversation search */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12 }}>🔍</span>
            <input style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px 7px 30px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
              placeholder="Search conversations…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', padding: '10px 16px 0', gap: 6 }}>
          {['All','Teams','Direct'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${tab === t ? 'rgba(124,58,237,.3)' : 'transparent'}`, background: tab === t ? 'rgba(124,58,237,.2)' : 'transparent', color: tab === t ? 'var(--purple-light)' : 'var(--text-muted)', fontFamily: 'DM Sans, sans-serif' }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {filteredConvos.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, padding: '24px 16px' }}>No conversations</p>}
          {filteredConvos.map(c => (
            <div key={c.id} onClick={() => openConvo(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', borderLeft: `3px solid ${active?.id === c.id ? 'var(--purple)' : 'transparent'}`, background: active?.id === c.id ? 'var(--surface2)' : 'transparent', transition: 'background .15s' }}
              onMouseEnter={(e) => { if (active?.id !== c.id) e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={(e) => { if (active?.id !== c.id) e.currentTarget.style.background = '' }}>
              <Avatar name={c.display_name || c.name || '?'} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.display_name || c.name || 'Conversation'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                  {c.last_message || 'No messages yet'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
                {c.unread_count > 0 && (
                  <span style={{ background: 'var(--purple)', color: '#fff', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {c.unread_count}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat panel ── */}
      {active ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', flexShrink: 0 }}>
            <Avatar name={active.display_name || active.name || '?'} size={40} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{active.display_name || active.name || 'Conversation'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {active.type === 'team' ? 'Team channel' : active.type === 'group' ? 'Group chat' : active.type === 'broadcast' ? 'Broadcast' : 'Direct message'}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {messages.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginTop: 40 }}>No messages yet. Start the conversation!</p>}
            {messages.map((m) => {
              const isMe = m.sender_id === user?.id
              return (
                <div key={m.id} style={{ display: 'flex', gap: 10, maxWidth: '75%', alignSelf: isMe ? 'flex-end' : 'flex-start', flexDirection: isMe ? 'row-reverse' : 'row' }}>
                  {!isMe && <Avatar name={m.sender_name} size={32} style={{ marginTop: 2 }} />}
                  <div>
                    {!isMe && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>{m.sender_name} · {m.sender_role}</div>}
                    <div style={{ padding: '10px 14px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, background: isMe ? 'linear-gradient(135deg,rgba(124,58,237,.5),rgba(236,72,153,.4))' : 'var(--surface2)', border: `1px solid ${isMe ? 'rgba(124,58,237,.4)' : 'var(--border)'}`, borderBottomRightRadius: isMe ? 4 : 14, borderBottomLeftRadius: isMe ? 14 : 4 }}>
                      {m.content}
                    </div>
                    {m.attachment_name && (
                      <div style={{ marginTop: 6, background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        📄 <span style={{ fontWeight: 600 }}>{m.attachment_name}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {isMe && ' ✓✓'}
                    </div>
                  </div>
                </div>
              )
            })}
            {typing && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 3, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 12, border: '1px solid var(--border)' }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--purple)', display: 'inline-block', animation: `bounce .9s ${i * .15}s infinite` }} />)}
              </div>
            </div>}
            <div ref={messagesEndRef} />
          </div>

          {/* Compose */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px', background: 'var(--surface)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: 'var(--text)', fontFamily: 'DM Sans, sans-serif', outline: 'none', resize: 'none', minHeight: 44, maxHeight: 120, lineHeight: 1.5 }}
                placeholder={`Message ${active.display_name || ''}…`}
                value={text} onChange={handleTyping} onKeyDown={onKeyDown} rows={1} />
              <button onClick={send} disabled={!text.trim() || sending}
                style={{ width: 44, height: 44, background: 'var(--grad1)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: !text.trim() || sending ? .5 : 1 }}>
                ➤
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>💬</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: 'var(--text)' }}>Select a conversation</div>
            <div style={{ fontSize: 13 }}>Choose from your conversations on the left</div>
          </div>
        </div>
      )}

      <style>{`@keyframes bounce { 0%,80%,100%{transform:scale(1)} 40%{transform:scale(1.5)} }`}</style>
    </div>
  )
}
