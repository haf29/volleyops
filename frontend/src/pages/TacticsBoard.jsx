import { useEffect, useRef, useState, useCallback } from 'react'
import api from '../api/client'
import { useToast } from '../context/ToastContext'

// ─── Mock AI engine ────────────────────────────────────────────────────────────

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }

const AI_POOL = {
  greeting: [
    "Hello Coach! Ready to build some winning tactics? Tell me what you're working on — rotations, serve-receive, blocking schemes — I've got you covered.",
    "Hey! What tactical challenge are we solving today? Drop your players on the court and describe the situation.",
    "Hi there! How can I help you today? Ask me about formations, countering opponents, or optimizing your lineup.",
    "Hello! Great to have you here. What formation or game scenario would you like to break down?",
  ],
  serve_receive: [
    "**Serve-Receive Optimization**\n\nFor a solid serve-receive, anchor your libero at the seam between zones 1 and 6:\n\n• Use a W-formation — libero center-back, two passers flanking\n• Passers call the ball early — communication cuts errors by ~30%\n• Against float serves: stay low, platform early\n• Against jump-serves: shift formation 1 meter toward the server's dominant side",
    "**3-Person Receive System**\n\nMost reliable at club level — libero plus two outside hitters:\n\n• Left-back covers zones 5–6, libero covers 6, right-back covers 1\n• Setter stays near zone 2 — never receives, always ready to set\n• If the opponent targets the seam, call a switch before the serve\n• Narrow each passer's zone of responsibility under serve pressure",
    "**Reading the Serve**\n\nAnticipation beats reaction in serve-receive:\n\n• Watch the server's toss — high toss usually means float, low toss means jump-serve\n• Aggressive diagonal (zones 1 & 6 crossover) is the most targeted area — libero owns it\n• If you lose 3 consecutive points on receive, call a time-out and reset mentally\n• Simplify your system under pressure — smaller zones, clearer responsibilities",
  ],
  blocking: [
    "**Blocking Scheme**\n\nEffective blocking starts with reading the setter:\n\n• Middle blocker must move by the time the setter contacts the ball — not after\n• Against a 6-2, expect the opposite when the setter is front-row\n• Use a soft block (hands angled down) on hard cross-court shots to redirect out-of-bounds\n• Commit-block the outside only when you've scouted their preferred angle",
    "**Counter-Blocking Tactics**\n\nMaximizing your block effectiveness:\n\n• Middle starts in zone 3, shuffles left for OH, right for opposite\n• Outside blockers: stay 30cm off net until the final step — reduces net violations\n• Against a pipe attack, your middle must stop penetrating and drop back into defense\n• Call 'line' or 'angle' pre-serve so blockers and back-row defense are coordinated",
    "**Building a Strong Block Wall**\n\nKey principles for shutting down attacks:\n\n• Penetrate the net — aim 30cm past the net on contact\n• Against a sharp cross-court attacker, close your outside blocker to the antenna earlier\n• Double-block on the outside; leave pipe for your libero and back-row\n• If the opponent scores twice from the same position, call a block-coverage switch",
  ],
  rotation: [
    "**Rotation Planning (6-2)**\n\nYour two setters alternate front/back row:\n\n• Rotation 1: Setter in P1 (back-row) — opposite + two outsides are front-row attackers\n• Rotation 3: Setter in P6 — strongest attacking rotation; use it to close tight sets\n• Rotation 5: Setter in P4 — weakest blocking alignment; consider double-substituting\n• Libero always replaces the middle blocker in back row to stabilize defense",
    "**5-1 Rotation Breakdown**\n\nWith a single setter:\n\n• Rotations 1–3 (setter back-row): all three front-row players attack — most offensive\n• Rotations 4–6 (setter front-row): setter participates in blocking — plan pipe coverage\n• Overlap rule: setter must stay right of zone-1 player until serve contact\n• In high-pressure rotations, simplify — one quick set + two audible options only",
    "**Fixing Rotation Errors**\n\nCommon mistakes and corrections:\n\n• Overlap violations: draw exact starting positions on the board and drill them\n• Setter not in position: designate a clear lane — no player crosses it before serve\n• Wrong libero switch: libero can only replace at the 3-meter line after the ball is served\n• When confused mid-match, default to your strongest rotation and call a time-out",
  ],
  attack: [
    "**Attack Pattern Optimization**\n\nKeep the opponent's block off-balance:\n\n• Run a quick ball to your middle blocker when they're front-row\n• Follow with a shoot-set to the opposite — the middle will be late closing\n• Mix in a back-row pipe attack — highest-percentage attack in modern volleyball\n• If the opponent reads your setter's shoulders, use a play-set to disguise direction",
    "**Maximizing Attack Efficiency**\n\nHigh-percentage attacking principles:\n\n• Cross-court wins rallies; line shots win points — use line when the block seals cross\n• Outside hitter: swing at 70% power with topspin — control beats power at most levels\n• When the block is late, attack sharp cross-court at the 3-meter line\n• Tooling the block (wiping off the blocker's hands) is always legal — practice it",
    "**Building Multi-Option Attacks**\n\nA good offense keeps the block guessing:\n\n• Design 3-option plays: quick middle + shoot opposite + back-row pipe\n• Use all 3 options equally in set 1 — find out which the opponent can't handle\n• In sets 4 and 5, go back to your highest-percentage option relentlessly\n• Against a taller block, use roll shots and tips into zones 2 and 4",
  ],
  setter: [
    "**Setting Strategy**\n\nThe setter is the quarterback — their decisions win or lose matches:\n\n• Establish the quick middle early — forces the block to commit, opens the outsides\n• Read the block: if both blockers commit outside, set the opposite or run a back-row attack\n• Under pressure (poor pass), go to your most reliable hitter — no creativity needed\n• Use a back-set when the opponent's left-side blocker is slow",
    "**Optimizing Setter Decisions**\n\nKey habits for consistent offense:\n\n• Always set from the same hand position — deceptive setters keep consistent technique\n• Pre-set communication: setter calls 'go' or 'wait' so hitters know the tempo\n• Against a strong middle blocker, mix 2-ball and 4-ball sets to keep them guessing\n• A bad set to a good hitter beats a great set that arrives late — prioritize rhythm",
    "**Advanced Setting Concepts**\n\nTaking offense to the next level:\n\n• Use a dump (setter attack) when zone 2 is unguarded — keeps defense honest\n• Combination plays (cross + shoot simultaneously) create traffic for the block\n• When hitters are out of system, a high outside set at the antenna buys them time\n• Film study: find where the opponent's libero cheats — set away from their comfort zone",
  ],
  defense: [
    "**Perimeter Defense System**\n\nMost common at club level:\n\n• Zones 1 and 5 dig line shots; libero covers cross-court in zone 6\n• Middle back reads the hitter's shoulder — move before contact, not after\n• If the block takes away cross-court, shift back-row defense to cover the line\n• Transition rule: after a dig, all front-row players sprint to the net",
    "**Reading the Attack for Better Defense**\n\nAnticipation beats reaction every time:\n\n• Study opponent hitters during warm-up — note their preferred attack angle\n• A hitter approaching outside-in almost always hits cross-court\n• Tipping is most common when the hitter is off-balance — libero should stay shallow\n• If the opponent has a strong right-side attacker, shade libero toward zone 1",
    "**Defensive Adjustments Mid-Match**\n\nWhen your defense is getting beaten:\n\n• Scoring on tips? Bring libero in closer, tell zone 5 to cover deep line\n• Pipe attack killing you? Send a second blocker — one blocker never stops a trained back-row attacker\n• Assign a 'shadow' defender to follow their best hitter's approach angle every rally\n• If down 3+ in a set, call time-out and change ONE defensive assignment — don't rebuild everything",
  ],
  formation: [
    "**Choosing the Right Formation**\n\nThe best system depends on your roster:\n\n• **6-2**: Two strong setters needed — maximizes front-row attackers in every rotation\n• **5-1**: One elite setter — consistent offense, slightly weaker in setter's front-row rotations\n• **4-2**: Best for beginners — setters always front-row, simple to teach\n\nFor most club teams, a 5-1 with a versatile opposite has the highest ceiling.",
    "**Making Your Formation Work**\n\nFormations succeed through execution, not complexity:\n\n• Drill your system for 4 weeks before changing — teams lose points switching mid-season\n• Build the system around your best player's strengths\n• A 6-2 needs two setters of near-equal quality; a mismatch creates exploitable rotations\n• Hybrid approach: run 5-1 in sets 1–2 to scout the opponent, switch to 6-2 in set 3 if needed",
    "**Formation Adjustment vs Opponent**\n\nMatchup-based thinking:\n\n• Vs strong middle blocker: run fast-tempo 5-1 offense — minimize their closing time\n• Vs weak outside blocker: exploit with your opposite in a 6-2 every rotation\n• When winning: stick to your system. When losing by 5+: switch and force them to adjust\n• The best formation is the one your players believe in — confidence beats tactics every time",
  ],
  general: [
    "**Tactical Principles That Win Matches**\n\n• **Serve pressure**: 68% of errors start with a tough serve — invest in serving practice\n• **Side-out efficiency**: Win 55%+ of side-outs and you'll win most sets\n• **Transition attack**: Every dig should end in a transition kill — train the full cycle\n• **Rotation strength**: Identify your best rotation and engineer subs to spend more time in it",
    "**Match-Winning Habits**\n\nWhat separates good teams from great teams:\n\n• Call a time-out after 3 consecutive opponent points — stop the momentum\n• Your libero's passing percentage is the best predictor of set wins — develop them\n• Score checkpoints to target: lead 8-5, 15-12, and 20-17 in a 25-point set\n• Film the opponent's last 2 matches — knowing their serve targets is worth 3–5 points per set",
    "**Quick Situational Tactics**\n\nAdjustments for common scenarios:\n\n• **Down 0-7 in a set**: Switch to aggressive serving — break their rhythm\n• **5th set, 8-8**: Call a time-out and run your highest-percentage play — no experiments\n• **Opponent on a 5-point run**: Sub in your best server and change the court energy\n• **Your hitters are cold**: Drop to a 2-ball system and let the setter run quick sets",
    "**Coaching Philosophy for Tactics**\n\nBuilding a tactically smart team:\n\n• Teach players WHY they're in each position, not just where — understanding beats memorization\n• Run 'chaos drills' (random multi-ball) to build decision-making under pressure\n• Debrief after every match: one thing done well, one adjustment for next time\n• The best tactic is the one your team executes with confidence — simplicity beats complexity",
  ],
}

function getMockAIReply(prompt, stats = []) {
  // Build player context string from stats
  function statsCtx() {
    if (!stats.length) return ''
    const top = [...stats].sort((a,b) => b.kills - a.kills).slice(0,3)
    const topDig = [...stats].sort((a,b) => b.digs - a.digs)[0]
    const topBlock = [...stats].sort((a,b) => b.blocks - a.blocks)[0]
    const topAce = [...stats].sort((a,b) => b.aces - a.aces)[0]
    return `\n\n**Your squad this season:**\n` +
      top.map((p,i) => `• ${['Top scorer','2nd scorer','3rd scorer'][i]}: ${p.name} (${p.kills} kills, ${p.aces} aces, ${p.blocks} blocks)`).join('\n') +
      `\n• Best digger: ${topDig?.name} (${topDig?.digs} digs)` +
      `\n• Best blocker: ${topBlock?.name} (${topBlock?.blocks} blocks)` +
      `\n• Best server: ${topAce?.name} (${topAce?.aces} aces)`
  }

  const t = prompt.toLowerCase().trim()
  const greetWords = ['hi','hello','hey','sup','howdy','hola','greetings','morning','afternoon','evening','good morning','good afternoon','good evening',"what's up"]
  if (greetWords.some(w => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!') || t.startsWith(w + ',')))
    return { text: pickRandom(AI_POOL.greeting), delay: 600 }
  if (/serve.?receiv|reception|libero|pass/.test(t))  return { text: pickRandom(AI_POOL.serve_receive) + statsCtx(), delay: 1100 }
  if (/block/.test(t))                                 return { text: pickRandom(AI_POOL.blocking) + statsCtx(), delay: 1000 }
  if (/rotat|lineup|position/.test(t))                return { text: pickRandom(AI_POOL.rotation) + statsCtx(), delay: 1200 }
  if (/attack|spike|hit|kill|smash|swing/.test(t))    return { text: pickRandom(AI_POOL.attack) + statsCtx(), delay: 1000 }
  if (/setter?|setting/.test(t))                      return { text: pickRandom(AI_POOL.setter) + statsCtx(), delay: 1100 }
  if (/defens|dig|back.?row|floor/.test(t))           return { text: pickRandom(AI_POOL.defense) + statsCtx(), delay: 1000 }
  if (/formation|6-2|5-1|4-2|system/.test(t))        return { text: pickRandom(AI_POOL.formation) + statsCtx(), delay: 900 }
  return { text: pickRandom(AI_POOL.general) + statsCtx(), delay: 1300 }
}

// ─── Canvas drawing helpers (ported from volleyops-tactics-board.html) ─────────

function drawCourt(ctx, CX, CY, CW, CH) {
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30
  ctx.fillStyle = '#1d6b47'; roundRect(ctx, CX, CY, CW, CH / 2, [8,8,0,0]); ctx.fill()
  ctx.fillStyle = '#1a5c3d'; roundRect(ctx, CX, CY + CH / 2, CW, CH / 2, [0,0,8,8]); ctx.fill()
  ctx.shadowBlur = 0

  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5
  ctx.strokeRect(CX, CY, CW, CH)
  ctx.beginPath(); ctx.moveTo(CX, CY + CH / 2); ctx.lineTo(CX + CW, CY + CH / 2); ctx.stroke()
  const al = CH / 9 * 3
  ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.beginPath(); ctx.moveTo(CX, CY + al); ctx.lineTo(CX + CW, CY + al); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(CX, CY + CH - al); ctx.lineTo(CX + CW, CY + CH - al); ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1
  ;[1/3, 2/3].forEach(f => {
    ctx.beginPath(); ctx.moveTo(CX + CW * f, CY); ctx.lineTo(CX + CW * f, CY + CH); ctx.stroke()
  })

  const ny = CY + CH / 2
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'
  ctx.beginPath(); ctx.moveTo(CX - 10, ny); ctx.lineTo(CX + CW + 10, ny); ctx.stroke()
  ctx.lineWidth = 3
  ;[CX - 10, CX + CW + 10].forEach(px => {
    ctx.beginPath(); ctx.moveTo(px, ny - CH * 0.09); ctx.lineTo(px, ny + CH * 0.09); ctx.stroke()
  })
  ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(CX + CW / 8 * i, ny - CH * 0.04); ctx.lineTo(CX + CW / 8 * i, ny + CH * 0.04); ctx.stroke() }
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(CX, ny + i * CH * 0.015); ctx.lineTo(CX + CW, ny + i * CH * 0.015); ctx.stroke() }

  ctx.font = `bold ${CW * 0.025}px Outfit, sans-serif`
  ctx.fillStyle = 'rgba(100,150,255,0.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('OUR TEAM', CX + CW / 2, CY + CH * 0.07)
  ctx.fillStyle = 'rgba(255,100,130,0.55)'
  ctx.fillText('OPPONENT', CX + CW / 2, CY + CH * 0.93)
}

function drawMarker(ctx, m, CW, CH) {
  const r = Math.min(CW, CH) * 0.046
  const color = m.team === 'our' ? '#4158D0' : '#FF5A7E'
  const glow  = m.team === 'our' ? 'rgba(65,88,208,0.4)' : 'rgba(255,90,126,0.4)'
  ctx.shadowColor = glow; ctx.shadowBlur = 18
  ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill(); ctx.shadowBlur = 0
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke()
  ctx.font = `800 ${r * 0.9}px Outfit, sans-serif`
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(m.num, m.x, m.y + 1); ctx.shadowBlur = 0
}

function drawArrow(ctx, a) {
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 5) return
  const angle = Math.atan2(dy, dx)
  const hl = 18
  ctx.save()
  ctx.strokeStyle = a.color || 'rgba(255,255,255,0.75)'; ctx.lineWidth = a.dash ? 2 : 2.5
  ctx.lineCap = 'round'
  if (a.dash) ctx.setLineDash([7, 5])
  ctx.shadowColor = a.color || 'rgba(255,255,255,0.3)'; ctx.shadowBlur = 8
  ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = a.color || 'rgba(255,255,255,0.75)'; ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.moveTo(a.x2, a.y2)
  ctx.lineTo(a.x2 - hl * Math.cos(angle - 0.45), a.y2 - hl * Math.sin(angle - 0.45))
  ctx.lineTo(a.x2 - hl * Math.cos(angle + 0.45), a.y2 - hl * Math.sin(angle + 0.45))
  ctx.closePath(); ctx.fill(); ctx.restore()
}

function drawZone(ctx, z) {
  ctx.save()
  ctx.fillStyle   = z.color  || 'rgba(255,215,0,0.18)'
  ctx.strokeStyle = z.border || 'rgba(255,215,0,0.6)'
  ctx.lineWidth = 1.5; ctx.setLineDash([5, 4])
  ctx.fillRect(z.x, z.y, z.w, z.h); ctx.strokeRect(z.x, z.y, z.w, z.h)
  ctx.setLineDash([]); ctx.restore()
}

function roundRect(ctx, x, y, w, h, radii) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radii) }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }

function formatChatText(text) {
  const escaped = String(text || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
  return escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
}

const FORMATIONS = {
  '6-2': { our: [[0.5,0.18],[0.17,0.35],[0.83,0.35],[0.17,0.1],[0.83,0.1],[0.5,0.37]], opp: [[0.5,0.63],[0.17,0.75],[0.83,0.75],[0.17,0.9],[0.83,0.9],[0.5,0.82]] },
  '5-1': { our: [[0.5,0.15],[0.17,0.32],[0.83,0.32],[0.17,0.12],[0.83,0.12],[0.5,0.4]], opp: [[0.5,0.65],[0.17,0.75],[0.83,0.75],[0.17,0.9],[0.83,0.9],[0.5,0.85]] },
  '4-2': { our: [[0.5,0.18],[0.2,0.38],[0.8,0.38],[0.2,0.1],[0.8,0.1],[0.5,0.38]],   opp: [[0.5,0.63],[0.2,0.75],[0.8,0.75],[0.2,0.9],[0.8,0.9],[0.5,0.82]] },
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function TacticsBoard() {
  const toast = useToast()

  const canvasRef = useRef(null)
  const areaRef   = useRef(null)
  const stateRef  = useRef({ markers: [], arrows: [], zones: [], history: [] })

  const [tool,      setTool]      = useState('select')
  const [formation, setFormation] = useState('6-2')
  const [aiTab,     setAiTab]     = useState('ai')
  const [aiInput,   setAiInput]   = useState('')
  const [chatMsgs,  setChatMsgs]  = useState([{ role:'ai', text:'Hi Coach! Drop players on the court and tell me what you\'re working on. I can suggest rotations, serve-receive patterns, and counter-tactics.' }])
  const [aiLoading, setAiLoading] = useState(false)
  const [boardName, setBoardName] = useState('Untitled Board')
  const [boards,    setBoards]    = useState([])
  const [activeBoardId, setActiveBoardId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  // board-level notes (saved with the board)
  const [notes,  setNotes]  = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  // personal notes (My Notes — persisted per user)
  const [myNotes,        setMyNotes]        = useState([])
  const [activeNote,     setActiveNote]     = useState(null)  // {id, title, content} or null for new
  const [noteTitle,      setNoteTitle]      = useState('')
  const [noteContent,    setNoteContent]    = useState('')
  const [noteDirty,      setNoteDirty]      = useState(false)
  const [savingNote,     setSavingNote]     = useState(false)
  const chatBottomRef = useRef(null)

  // court dimensions stored in a ref so canvas callbacks can read them
  const courtRef = useRef({ CX: 0, CY: 0, CW: 0, CH: 0 })
  const mouseRef  = useRef({ x: 0, y: 0 })
  const drawDataRef = useRef({ arrowStart: null, zoneStart: null, dragTarget: null, dragOffX: 0, dragOffY: 0, dragData: null })

  // ── Sizing ──────────────────────────────────────────────────────────────────
  function resize() {
    const canvas = canvasRef.current
    const area   = areaRef.current
    if (!canvas || !area) return
    const W = area.clientWidth, H = area.clientHeight
    canvas.width = W; canvas.height = H
    const maxW = W * 0.86, maxH = H * 0.9
    const ratio = 18 / 9
    let cw = maxW, ch = maxW / ratio
    if (ch > maxH) { ch = maxH; cw = ch * ratio }
    courtRef.current = { CX: (W - cw) / 2, CY: (H - ch) / 2, CW: cw, CH: ch }
    drawAll()
  }

  function drawAll() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { CX, CY, CW, CH } = courtRef.current
    const { markers, arrows, zones } = stateRef.current
    const { arrowStart, zoneStart } = drawDataRef.current
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawCourt(ctx, CX, CY, CW, CH)
    zones.forEach(z => drawZone(ctx, z))
    arrows.forEach(a => drawArrow(ctx, a))
    if (tool === 'arrow' && arrowStart) drawArrow(ctx, { x1: arrowStart.x, y1: arrowStart.y, x2: mouseRef.current.x, y2: mouseRef.current.y, color: 'rgba(255,255,255,0.5)', dash: true })
    if (tool === 'zone'  && zoneStart)  drawZone(ctx, { x: zoneStart.x, y: zoneStart.y, w: mouseRef.current.x - zoneStart.x, h: mouseRef.current.y - zoneStart.y })
    markers.forEach(m => drawMarker(ctx, m, CW, CH))
  }

  // Use a ref for drawAll + tool so canvas listeners don't go stale
  const drawAllRef = useRef(drawAll)
  const toolRef    = useRef(tool)
  useEffect(() => { drawAllRef.current = drawAll }, )
  useEffect(() => { toolRef.current = tool; drawAll() }, [tool])

  function markerR() { const { CW, CH } = courtRef.current; return Math.min(CW, CH) * 0.046 }

  function canvasXY(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function saveHistory() {
    const s = stateRef.current
    s.history.push({ markers: JSON.parse(JSON.stringify(s.markers)), arrows: JSON.parse(JSON.stringify(s.arrows)), zones: JSON.parse(JSON.stringify(s.zones)) })
    if (s.history.length > 30) s.history.shift()
  }

  // ── Canvas events (attached once, read refs) ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function onMouseDown(e) {
      const { x, y } = canvasXY(e)
      const s = stateRef.current
      const dd = drawDataRef.current
      const t = toolRef.current
      if (t === 'select') {
        dd.dragTarget = s.markers.find(m => dist(m, { x, y }) < markerR() * 1.2) || null
        if (dd.dragTarget) { dd.dragOffX = x - dd.dragTarget.x; dd.dragOffY = y - dd.dragTarget.y }
      } else if (t === 'arrow') {
        dd.arrowStart = { x, y }
      } else if (t === 'zone') {
        dd.zoneStart = { x, y }
      } else if (t === 'erase') {
        eraseAt(x, y)
      }
    }

    function onMouseMove(e) {
      const { x, y } = canvasXY(e)
      mouseRef.current = { x, y }
      const dd = drawDataRef.current
      if (dd.dragTarget) { dd.dragTarget.x = x - dd.dragOffX; dd.dragTarget.y = y - dd.dragOffY }
      if (dd.arrowStart || dd.zoneStart || dd.dragTarget) drawAllRef.current()
    }

    function onMouseUp(e) {
      const { x, y } = canvasXY(e)
      const s  = stateRef.current
      const dd = drawDataRef.current
      const t  = toolRef.current
      if (dd.dragTarget) { saveHistory(); dd.dragTarget = null; drawAllRef.current() }
      if (t === 'arrow' && dd.arrowStart) {
        if (dist(dd.arrowStart, { x, y }) > 20) { saveHistory(); s.arrows.push({ x1: dd.arrowStart.x, y1: dd.arrowStart.y, x2: x, y2: y }) }
        dd.arrowStart = null; drawAllRef.current()
      }
      if (t === 'zone' && dd.zoneStart) {
        const w = x - dd.zoneStart.x, h = y - dd.zoneStart.y
        if (Math.abs(w) > 20 && Math.abs(h) > 20) { saveHistory(); s.zones.push({ x: dd.zoneStart.x, y: dd.zoneStart.y, w, h }) }
        dd.zoneStart = null; drawAllRef.current()
      }
    }

    function onMouseLeave() { const dd = drawDataRef.current; dd.arrowStart = null; dd.zoneStart = null; drawAllRef.current() }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup',   onMouseUp)
    canvas.addEventListener('mouseleave',onMouseLeave)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup',   onMouseUp)
      canvas.removeEventListener('mouseleave',onMouseLeave)
    }
  }, [])

  function eraseAt(x, y) {
    const s = stateRef.current
    const before = s.markers.length + s.arrows.length + s.zones.length
    s.markers = s.markers.filter(m => dist(m, { x, y }) > markerR() * 1.2)
    s.arrows  = s.arrows.filter(a => dist({ x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 }, { x, y }) > 30)
    s.zones   = s.zones.filter(z => !(x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h))
    if (s.markers.length + s.arrows.length + s.zones.length < before) { saveHistory(); drawAll() }
  }

  // ── Drag-drop from palette ────────────────────────────────────────────────────
  function onDragStart(team, num) { drawDataRef.current.dragData = { team, num } }

  function onDrop(e) {
    e.preventDefault()
    const dd = drawDataRef.current
    if (!dd.dragData) return
    const r = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    const s = stateRef.current
    s.markers = s.markers.filter(m => !(m.team === dd.dragData.team && m.num === dd.dragData.num))
    saveHistory()
    s.markers.push({ id: Date.now(), team: dd.dragData.team, num: dd.dragData.num, x, y })
    dd.dragData = null
    drawAll()
  }

  // ── Formation presets ──────────────────────────────────────────────────────────
  function applyFormation(f) {
    const { CX, CY, CW, CH } = courtRef.current
    const pos = FORMATIONS[f]
    if (!pos) return
    saveHistory()
    const s = stateRef.current
    s.markers = []
    pos.our.forEach((p, i) => s.markers.push({ id: Date.now() + i, team: 'our', num: i + 1, x: CX + CW * p[0], y: CY + CH * p[1] }))
    pos.opp.forEach((p, i) => s.markers.push({ id: Date.now() + 10 + i, team: 'opp', num: i + 1, x: CX + CW * p[0], y: CY + CH * p[1] }))
    setFormation(f)
    drawAll()
    toast(`Formation ${f} applied`, 'success')
  }

  function undo() {
    const s = stateRef.current
    if (!s.history.length) { toast('Nothing to undo'); return }
    const snap = s.history.pop()
    s.markers = snap.markers; s.arrows = snap.arrows; s.zones = snap.zones
    drawAll(); toast('Undo ✓')
  }

  function clearBoard() {
    saveHistory()
    const s = stateRef.current
    s.markers = []; s.arrows = []; s.zones = []
    drawAll(); toast('Board cleared')
  }

  // ── Init / resize ──────────────────────────────────────────────────────────────
  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    setTimeout(() => applyFormation('6-2'), 150)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // ── Load boards list ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/tactics').then(({ data }) => setBoards(data.boards || [])).catch(() => {})
  }, [])

  useEffect(() => {
    api.get('/teams')
      .then(({ data }) => {
        const nextTeams = data.teams || []
        setTeams(nextTeams)
        if (!selectedTeamId && nextTeams.length) setSelectedTeamId(String(nextTeams[0].id))
      })
      .catch(() => {})
  }, [])

  // ── Load personal notes ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/notes').then(({ data }) => setMyNotes(data.notes || [])).catch(() => {})
  }, [])

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMsgs, aiLoading])

  // ── Personal note helpers ────────────────────────────────────────────────────────
  function openNote(note) {
    setActiveNote(note)
    setNoteTitle(note.title)
    setNoteContent(note.content)
    setNoteDirty(false)
  }

  function newNote() {
    setActiveNote({ id: null })
    setNoteTitle('')
    setNoteContent('')
    setNoteDirty(false)
  }

  async function saveNote() {
    if (!noteContent.trim() && !noteTitle.trim()) return
    setSavingNote(true)
    try {
      const title = noteTitle.trim() || 'Untitled Note'
      const content = noteContent
      let saved
      if (activeNote?.id) {
        const { data } = await api.put(`/notes/${activeNote.id}`, { title, content })
        saved = data
        setMyNotes(prev => prev.map(n => n.id === saved.id ? saved : n))
      } else {
        const { data } = await api.post('/notes', { title, content })
        saved = data
        setMyNotes(prev => [saved, ...prev])
      }
      setActiveNote(saved)
      setNoteTitle(saved.title)
      setNoteDirty(false)
      toast('Note saved', 'success')
    } catch { toast('Failed to save note', 'error') }
    finally { setSavingNote(false) }
  }

  async function deleteNote(id) {
    try {
      await api.delete(`/notes/${id}`)
      setMyNotes(prev => prev.filter(n => n.id !== id))
      if (activeNote?.id === id) setActiveNote(null)
      toast('Note deleted')
    } catch { toast('Failed to delete', 'error') }
  }

  // ── Save board ──────────────────────────────────────────────────────────────────
  async function saveBoard() {
    setSaving(true)
    const { markers, arrows, zones } = stateRef.current
    const teamId = selectedTeamId ? Number(selectedTeamId) : null
    const payload = {
      name: boardName,
      team_id: teamId,
      formation,
      markers,
      arrows,
      zones,
      match_context: { team_id: teamId },
      notes,
    }
    try {
      let res
      if (activeBoardId) {
        res = await api.put(`/tactics/${activeBoardId}`, payload)
      } else {
        res = await api.post('/tactics', payload)
        setActiveBoardId(res.data.id)
      }
      setNotesSaved(true)
      toast('Board saved', 'success')
      api.get('/tactics').then(({ data }) => setBoards(data.boards || [])).catch(() => {})
    } catch { toast('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  async function saveNotes() {
    if (!activeBoardId) { await saveBoard(); return }
    setSaving(true)
    try {
      await api.put(`/tactics/${activeBoardId}`, { notes })
      setNotesSaved(true)
      toast('Notes saved', 'success')
    } catch { toast('Failed to save notes', 'error') }
    finally { setSaving(false) }
  }

  function loadBoard(b) {
    const s = stateRef.current
    s.markers = b.markers || []
    s.arrows  = b.arrows  || []
    s.zones   = b.zones   || []
    s.history = []
    setActiveBoardId(b.id)
    setBoardName(b.name)
    setFormation(b.formation || '6-2')
    setSelectedTeamId(b.team_id ? String(b.team_id) : '')
    setNotes(b.notes || '')
    setNotesSaved(true)
    drawAll()
    toast(`Loaded: ${b.name}`)
  }

  // ── AI suggestions ──────────────────────────────────────────────────────────────
  async function sendAI() {
    if (!aiInput.trim()) return
    const prompt = aiInput.trim()
    setChatMsgs(prev => [...prev, { role: 'user', text: prompt }])
    setAiInput('')
    setAiLoading(true)
    const { markers, arrows, zones } = stateRef.current
    const teamId = selectedTeamId ? Number(selectedTeamId) : null

    try {
      const { data } = await api.post('/ai/suggest', {
        prompt,
        boardId: activeBoardId,
        markers,
        arrows,
        zones,
        formation,
        matchContext: {
          team_id: teamId,
          board_name: boardName,
        },
      })

      const source = data.source === 'openai' && data.model
        ? `VolleyOps AI (${data.model})`
        : 'VolleyOps AI (fallback)'
      const context = data.context?.length
        ? `\n\n**Context used**\n${data.context.map(item => `- ${item}`).join('\n')}`
        : ''
      const suggestions = data.suggestions?.length
        ? `\n\n**Suggestions**\n${data.suggestions.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
        : ''
      const text = `**${source}**\n\n${data.summary || 'Here is the tactical read.'}${context}${suggestions}`
      setChatMsgs(prev => [...prev, { role: 'ai', text }])
    } catch (err) {
      toast(err.response?.data?.error || 'AI request failed', 'error')
      setChatMsgs(prev => [...prev, {
        role: 'ai',
        text: 'I could not reach the AI service for this request. Check the backend console and OpenAI key, then try again.',
      }])
    } finally {
      setAiLoading(false)
    }
  }

  const TOOLS = [
    { id: 'select', icon: '↖', label: 'Select / Move' },
    { id: 'arrow',  icon: '↗', label: 'Draw Arrow' },
    { id: 'zone',   icon: '⬡', label: 'Draw Zone' },
    { id: 'erase',  icon: '✕', label: 'Erase' },
  ]

  const CURSOR = { select: 'default', arrow: 'crosshair', zone: 'crosshair', erase: 'cell' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', margin: '-28px -32px', background: 'var(--light-bg)' }}>

      {/* ── Top bar ── */}
      <div style={{ background: '#0F1729', padding: '.9rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>🏐 Tactics Board</div>
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,.5)' }}>Drag markers · Draw arrows · Ask AI</div>
          </div>
          <input value={boardName} onChange={e => setBoardName(e.target.value)}
            style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: '4px 10px', color: '#fff', fontSize: 13, fontFamily: 'DM Sans, sans-serif', outline: 'none', width: 180 }} />
          {teams.length > 0 && (
            <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: '5px 10px', color: '#fff', fontSize: 13, fontFamily: 'DM Sans, sans-serif', outline: 'none', width: 170 }}>
              {teams.map(team => <option key={team.id} value={team.id} style={{ color: '#0F1729' }}>{team.name}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <button onClick={clearBoard} style={tbBtn}>🗑 Clear</button>
          <button onClick={undo}       style={tbBtn}>↩ Undo</button>
          <button onClick={() => setTool(t => t === 'arrow' ? 'select' : 'arrow')} style={{ ...tbBtn, ...(tool === 'arrow' ? tbBtnActive : {}) }}>↗ Arrow</button>
          <button onClick={() => setTool(t => t === 'zone' ? 'select' : 'zone')} style={{ ...tbBtn, ...(tool === 'zone' ? tbBtnActive : {}) }}>⬡ Zone</button>
          <button onClick={saveBoard} disabled={saving} style={tbBtnPrimary}>{saving ? 'Saving…' : '💾 Save'}</button>
          <button onClick={() => { setAiTab('ai'); sendAI() }} style={tbBtnPrimary}>✦ Ask AI</button>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr 300px', overflow: 'hidden' }}>

        {/* ── Left toolbar ── */}
        <div style={{ background: '#fff', borderRight: '1px solid rgba(65,88,208,.1)', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
          <div>
            <div style={sectionLabel}>Tools</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {TOOLS.map(t => (
                <button key={t.id} onClick={() => setTool(t.id)} style={{ ...toolBtn, ...(tool === t.id ? toolBtnActive : {}) }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(65,88,208,.08)' }} />

          {[{ team: 'our', label: 'Our Team', color: '#4158D0', bg: 'rgba(65,88,208,.1)', border: 'rgba(65,88,208,.25)' },
            { team: 'opp', label: 'Opponent',  color: '#FF5A7E', bg: 'rgba(255,90,126,.1)', border: 'rgba(255,90,126,.25)' }].map(({ team, label, color, bg, border }) => (
            <div key={team}>
              <div style={sectionLabel}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.4rem' }}>
                {[1,2,3,4,5,6].map(num => (
                  <div key={num} draggable onDragStart={() => onDragStart(team, num)}
                    style={{ padding: '.5rem .3rem', borderRadius: 10, border: `2px solid ${border}`, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'grab', fontSize: '.78rem', fontWeight: 600, color, transition: 'all .15s', userSelect: 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.1)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.72rem', fontWeight: 800, color: '#fff' }}>{num}</div>
                    #{num}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ height: 1, background: 'rgba(65,88,208,.08)' }} />

          <div>
            <div style={sectionLabel}>Formations</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {['6-2','5-1','4-2'].map(f => (
                <button key={f} onClick={() => applyFormation(f)}
                  style={{ padding: '.55rem .75rem', borderRadius: 10, background: formation === f ? 'rgba(65,88,208,.1)' : 'var(--light-bg)', border: `1.5px solid ${formation === f ? '#4158D0' : 'transparent'}`, cursor: 'pointer', fontSize: '.8rem', fontWeight: 600, color: formation === f ? '#4158D0' : '#0F1729', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'DM Sans, sans-serif' }}>
                  {f} <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#888' }}>{formation === f ? 'ACTIVE' : ''}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(65,88,208,.08)' }} />
          <div>
            <div style={sectionLabel}>Saved Boards</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', maxHeight: 160, overflowY: 'auto' }}>
              {boards.length === 0 && <p style={{ fontSize: 11, color: '#aaa' }}>No saved boards</p>}
              {boards.map(b => (
                <button key={b.id} onClick={() => loadBoard(b)}
                  style={{ padding: '6px 10px', borderRadius: 8, background: activeBoardId === b.id ? 'rgba(65,88,208,.1)' : 'var(--light-bg)', border: `1px solid ${activeBoardId === b.id ? '#4158D0' : 'rgba(65,88,208,.1)'}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, textAlign: 'left', color: '#0F1729', fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div ref={areaRef} style={{ background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}
          onDragOver={e => e.preventDefault()} onDrop={onDrop}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(65,88,208,.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <canvas ref={canvasRef} style={{ display: 'block', cursor: CURSOR[tool] || 'crosshair', borderRadius: 4, boxShadow: '0 0 60px rgba(0,0,0,.5)' }} />
        </div>

        {/* ── Right AI panel ── */}
        <div style={{ background: 'rgba(255,255,255,.97)', borderLeft: '1px solid rgba(65,88,208,.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(65,88,208,.1)', flexShrink: 0 }}>
            {[['ai','✦ AI Assist'],['notes','📋 My Notes']].map(([id, label]) => (
              <button key={id} onClick={() => setAiTab(id)}
                style={{ flex: 1, padding: '.9rem .5rem', fontSize: '.78rem', fontWeight: 600, textAlign: 'center', cursor: 'pointer', border: 'none', background: 'none', color: aiTab === id ? '#4158D0' : 'rgba(15,23,41,.45)', borderBottom: `2.5px solid ${aiTab === id ? '#4158D0' : 'transparent'}`, fontFamily: 'DM Sans, sans-serif', transition: 'all .2s' }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── AI chat tab ── */}
          {aiTab === 'ai' && (
            <>
              {/* Messages — scrollable, grows to fill space */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                {chatMsgs.map((m, i) => (
                  <div key={i} style={{ padding: '.65rem .85rem', borderRadius: 12, fontSize: '.8rem', lineHeight: 1.55, background: m.role === 'user' ? 'rgba(65,88,208,.1)' : '#F8F9FC', color: '#0F1729', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', border: m.role === 'ai' ? '1.5px solid rgba(65,88,208,.08)' : 'none' }}>
                    {m.role === 'ai' && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.68rem', fontWeight: 700, color: '#C850C0', marginBottom: '.3rem' }}>✦ VolleyOps AI</div>}
                    <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: formatChatText(m.text) }} />
                  </div>
                ))}
                {aiLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '.65rem .85rem', background: 'rgba(65,88,208,.07)', borderRadius: 12, border: '1.5px solid rgba(65,88,208,.12)', alignSelf: 'flex-start' }}>
                    {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#4158D0', display: 'inline-block', animation: `bounce .9s ${i * .15}s infinite` }} />)}
                    <span style={{ fontSize: '.78rem', color: '#4158D0', fontWeight: 600 }}>Analyzing…</span>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Input — fixed at bottom */}
              <div style={{ borderTop: '1px solid rgba(65,88,208,.1)', padding: '.85rem 1rem', flexShrink: 0, background: '#fff' }}>
                <textarea value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI() } }}
                  placeholder="Ask about tactics, rotations, or formations… (Enter to send)"
                  style={{ width: '100%', padding: '.65rem .75rem', border: '1.5px solid rgba(65,88,208,.2)', borderRadius: 10, fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', color: '#0F1729', background: '#fafbff', resize: 'none', outline: 'none', minHeight: 58, maxHeight: 110, lineHeight: 1.5, boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#4158D0'}
                  onBlur={e => e.target.style.borderColor = 'rgba(65,88,208,.2)'} />
                <button onClick={sendAI} disabled={!aiInput.trim() || aiLoading}
                  style={{ marginTop: 8, width: '100%', background: 'linear-gradient(135deg,#4158D0,#C850C0)', color: '#fff', border: 'none', padding: '.55rem', borderRadius: 10, fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', opacity: (!aiInput.trim() || aiLoading) ? .5 : 1 }}>
                  ✦ {aiLoading ? 'Analyzing…' : 'Send →'}
                </button>
              </div>
            </>
          )}

          {/* ── My Notes tab ── */}
          {aiTab === 'notes' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {activeNote === null ? (
                /* Notes list */
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(15,23,41,.4)' }}>My Notes</div>
                    <button onClick={newNote}
                      style={{ padding: '4px 12px', borderRadius: 8, background: 'linear-gradient(135deg,#4158D0,#C850C0)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      + New Note
                    </button>
                  </div>
                  {myNotes.length === 0 ? (
                    <div style={{ textAlign: 'center', paddingTop: 40, color: 'rgba(15,23,41,.35)' }}>
                      <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>No notes yet</div>
                      <div style={{ fontSize: 11, marginTop: 4 }}>Click "+ New Note" to get started</div>
                    </div>
                  ) : myNotes.map(n => (
                    <div key={n.id} onClick={() => openNote(n)}
                      style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid rgba(65,88,208,.1)', background: '#F8F9FC', cursor: 'pointer', transition: 'border-color .15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#4158D0'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(65,88,208,.1)'}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#0F1729', marginBottom: 4 }}>{n.title}</div>
                        <button onClick={e => { e.stopPropagation(); deleteNote(n.id) }}
                          style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'rgba(15,23,41,.3)', lineHeight: 1 }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--pink)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'rgba(15,23,41,.3)'}>✕</button>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(15,23,41,.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.content || 'No content'}</div>
                      <div style={{ fontSize: 10, color: 'rgba(15,23,41,.3)', marginTop: 6 }}>{new Date(n.updated_at).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Note editor */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Editor header */}
                  <div style={{ padding: '.75rem 1rem', borderBottom: '1px solid rgba(65,88,208,.1)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => setActiveNote(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'rgba(15,23,41,.4)', lineHeight: 1, padding: '0 4px' }}>←</button>
                    <input value={noteTitle} onChange={e => { setNoteTitle(e.target.value); setNoteDirty(true) }}
                      placeholder="Note title…"
                      style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 13, color: '#0F1729', background: 'transparent' }} />
                    {noteDirty && <span style={{ fontSize: '.65rem', color: '#f59e0b', fontWeight: 600, flexShrink: 0 }}>● Unsaved</span>}
                  </div>
                  {/* Text area — scrollable */}
                  <textarea value={noteContent}
                    onChange={e => { setNoteContent(e.target.value); setNoteDirty(true) }}
                    placeholder="Write your note here…"
                    style={{ flex: 1, padding: '1rem', border: 'none', outline: 'none', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#0F1729', resize: 'none', lineHeight: 1.6, background: '#fff' }} />
                  {/* Save button */}
                  <div style={{ padding: '.75rem 1rem', borderTop: '1px solid rgba(65,88,208,.1)', flexShrink: 0 }}>
                    <button onClick={saveNote} disabled={savingNote || (!noteDirty && activeNote?.id)}
                      style={{ width: '100%', padding: '.55rem', borderRadius: 10, background: (!noteDirty && activeNote?.id) ? 'rgba(16,185,129,.1)' : 'linear-gradient(135deg,#4158D0,#C850C0)', color: (!noteDirty && activeNote?.id) ? '#10b981' : '#fff', border: (!noteDirty && activeNote?.id) ? '1px solid rgba(16,185,129,.3)' : 'none', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', fontWeight: 600, cursor: (!noteDirty && activeNote?.id) ? 'default' : 'pointer', opacity: savingNote ? .6 : 1 }}>
                      {savingNote ? '…' : (!noteDirty && activeNote?.id) ? '✓ Saved' : '💾 Save Note'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes bounce { 0%,80%,100%{transform:scale(1)} 40%{transform:scale(1.5)} }`}</style>
    </div>
  )
}

// ── Inline style constants ──────────────────────────────────────────────────────
const tbBtn = { background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', color: '#fff', padding: '.45rem 1rem', borderRadius: 8, fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
const tbBtnActive = { background: 'rgba(255,255,255,.25)', borderColor: 'rgba(255,255,255,.4)' }
const tbBtnPrimary = { ...tbBtn, background: 'linear-gradient(135deg,#FF5A7E,#C850C0)', borderColor: 'transparent' }
const sectionLabel = { fontSize: '.68rem', fontWeight: 700, letterSpacing: '.1em', color: 'rgba(15,23,41,.35)', textTransform: 'uppercase', padding: '0 .25rem', marginBottom: '.5rem' }
const toolBtn = { display: 'flex', alignItems: 'center', gap: 10, padding: '.6rem .75rem', borderRadius: 10, border: '1.5px solid transparent', background: 'var(--light-bg)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', fontWeight: 500, color: '#0F1729', transition: 'all .15s', width: '100%' }
const toolBtnActive = { background: 'rgba(65,88,208,.12)', borderColor: '#4158D0', color: '#4158D0', fontWeight: 600 }
