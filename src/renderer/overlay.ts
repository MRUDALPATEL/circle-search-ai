/// <reference path="../types/global.d.ts" />

// ─── Elements ────────────────────────────────────────────────────────────────
const canvas        = document.getElementById('canvas')         as HTMLCanvasElement
const ctx           = canvas.getContext('2d')!
const hint          = document.getElementById('hint')           as HTMLDivElement
const hintSub       = hint.querySelector('.hint-subtitle')      as HTMLElement
const screenshotBg  = document.getElementById('screenshot-bg')  as HTMLImageElement
const questionBar   = document.getElementById('question-bar')   as HTMLDivElement
const questionInput = document.getElementById('question-input') as HTMLInputElement
const qbarCounter   = document.getElementById('qbar-counter')   as HTMLSpanElement
const qbarSubmit    = document.getElementById('qbar-submit')    as HTMLButtonElement
const qbarSkipBtn   = document.getElementById('qbar-skip-btn')  as HTMLSpanElement

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_ANALYSIS_PX = 1536
const JPEG_QUALITY    = 0.88
const MIN_DIST_SQ     = 16
const MAX_QUESTION    = 300

const LASSO_STROKES = [
  { blur: 18, lw: 5.0, alpha: 0.18, color: [160, 140, 255] as [number,number,number] },
  { blur:  8, lw: 3.2, alpha: 0.45, color: [140, 180, 255] as [number,number,number] },
  { blur:  3, lw: 2.0, alpha: 0.75, color: [200, 190, 255] as [number,number,number] },
  { blur:  0, lw: 1.2, alpha: 1.00, color: [255, 255, 255] as [number,number,number] },
]

// ─── Types ───────────────────────────────────────────────────────────────────
interface Pt { x: number; y: number }

// ─── State ───────────────────────────────────────────────────────────────────
let screenshotDataUrl : string | null = null
let annotatedCache    : string | null = null  // built once after circle, reused on submit
let isDrawing    = false
let points: Pt[] = []
let scrimAlpha   = 0
let pulsePhase   = 0
let closingLoop  = false
let closeProgress = 0
let sceneActive  = false
let waitingForQ  = false   // true while question bar is shown
let animFrame: number | null = null

// ─── Canvas sizing ────────────────────────────────────────────────────────────
function resizeCanvas(): void {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
}
resizeCanvas()
window.addEventListener('resize', resizeCanvas)

// ─── Catmull-Rom ─────────────────────────────────────────────────────────────
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t, t3 = t2 * t
  return {
    x: 0.5*(2*p1.x+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5*(2*p1.y+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
  }
}

function tracePath(path: Path2D, pts: Pt[], close = false): void {
  if (pts.length < 2) return
  if (pts.length < 4) {
    path.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y)
    if (close) path.closePath()
    return
  }
  const wrap   = close ? [...pts.slice(-2), ...pts, ...pts.slice(0, 2)] : pts
  const offset = close ? 2 : 0
  path.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - (close ? 0 : 1); i++) {
    const p0 = wrap[Math.max(0, i - 1 + offset)]
    const p1 = wrap[i + offset]
    const p2 = wrap[(i + 1) % pts.length + offset]
    const p3 = wrap[(i + 2) % pts.length + offset]
    for (let t = 0.05; t <= 1; t += 0.05) {
      const pt = catmullRom(p0, p1, p2, p3, t)
      path.lineTo(pt.x, pt.y)
    }
  }
  if (close) path.closePath()
}

function buildOpenPath(pts: Pt[])   { const p = new Path2D(); tracePath(p, pts, false); return p }
function buildClosedPath(pts: Pt[]) { const p = new Path2D(); tracePath(p, pts, true);  return p }

function buildClosingSegment(pts: Pt[], progress: number): Path2D {
  const p     = new Path2D()
  const start = pts[pts.length - 1]
  const end   = pts[0]
  const mx    = start.x + (end.x - start.x) * progress
  const my    = start.y + (end.y - start.y) * progress
  const cpx   = (start.x + end.x) / 2
  const cpy   = (start.y + end.y) / 2 - 20 * Math.sin(progress * Math.PI)
  p.moveTo(start.x, start.y)
  p.quadraticCurveTo(
    start.x + (cpx - start.x) * progress,
    start.y + (cpy - start.y) * progress,
    mx, my
  )
  return p
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// ─── Glow stroke ─────────────────────────────────────────────────────────────
function strokeGlow(path: Path2D, now: number, alpha = 1): void {
  const hueShift = (now / 3000) * 30
  for (const s of LASSO_STROKES) {
    ctx.save()
    const [r, g, b] = s.color
    ctx.strokeStyle = `rgba(${Math.min(255,Math.round(r+hueShift))},${Math.min(255,Math.round(g-hueShift*0.3))},${b},${s.alpha * alpha})`
    ctx.lineWidth   = s.lw
    if (s.blur > 0) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = s.blur }
    ctx.lineCap  = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    ctx.stroke(path)
    ctx.restore()
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function frame(): void {
  if (!sceneActive) return
  const now = performance.now()
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Keep scrim while question bar is visible so selection stays framed
  const scrimTarget = (closingLoop || pulsePhase > 0 || waitingForQ)
    ? 0.55
    : Math.min(0.42, scrimAlpha)
  ctx.fillStyle = `rgba(0,0,0,${scrimTarget})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (points.length < 2) { animFrame = requestAnimationFrame(frame); return }

  // Closed path (after release or while question bar is shown)
  if (!isDrawing && !closingLoop) {
    const selPath = buildClosedPath(points)

    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.fill(selPath)
    ctx.restore()

    ctx.save()
    ctx.clip(selPath)
    ctx.fillStyle = `rgba(255,255,255,${0.04 + pulsePhase * 0.08})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()

    if (pulsePhase > 0) {
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length
      const sc = 1 + Math.sin(pulsePhase * Math.PI) * 0.035
      ctx.save()
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy)
      strokeGlow(selPath, now, 0.7 + pulsePhase * 0.3)
      ctx.restore()
    } else {
      // Gentle idle glow while question bar is open
      const idleAlpha = waitingForQ ? 0.7 + Math.sin(now / 900) * 0.15 : 1
      strokeGlow(selPath, now, idleAlpha)
    }

    animFrame = requestAnimationFrame(frame)
    return
  }

  // Closing snap animation
  if (closingLoop) {
    strokeGlow(buildOpenPath(points), now)
    strokeGlow(buildClosingSegment(points, closeProgress), now, easeInOutQuad(closeProgress))
    animFrame = requestAnimationFrame(frame)
    return
  }

  // Live drawing
  const openPath = buildOpenPath(points)

  if (points.length > 8) {
    const first = points[0], last = points[points.length - 1]
    const preview = new Path2D()
    preview.moveTo(last.x, last.y)
    preview.lineTo(first.x, first.y)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 6])
    ctx.lineCap = 'round'
    ctx.stroke(preview)
    ctx.restore()
  }

  strokeGlow(openPath, now)

  if (points.length > 6) {
    const start = points[0]
    ctx.save()
    ctx.beginPath()
    ctx.arc(start.x, start.y, 5, 0, Math.PI * 2)
    ctx.fillStyle   = 'rgba(255,255,255,0.9)'
    ctx.shadowColor = 'rgba(160,140,255,0.8)'
    ctx.shadowBlur  = 10
    ctx.fill()
    ctx.restore()
  }

  animFrame = requestAnimationFrame(frame)
}

function startScene(): void {
  if (sceneActive) return
  sceneActive = true
  scrimAlpha  = 0
  frame()
}

function stopScene(): void {
  sceneActive = false
  if (animFrame !== null) { cancelAnimationFrame(animFrame); animFrame = null }
}

// ─── Animations ───────────────────────────────────────────────────────────────
function playCloseSnap(): Promise<void> {
  return new Promise(resolve => {
    closingLoop = true; closeProgress = 0
    const start = performance.now(), dur = 220
    const tick = (now: number) => {
      closeProgress = Math.min(1, (now - start) / dur)
      closeProgress < 1 ? requestAnimationFrame(tick) : (closingLoop = false, closeProgress = 0, resolve())
    }
    requestAnimationFrame(tick)
  })
}

function playCompletionPulse(): Promise<void> {
  return new Promise(resolve => {
    pulsePhase = 0
    const start = performance.now(), dur = 380
    const tick = (now: number) => {
      pulsePhase = Math.min(1, (now - start) / dur)
      pulsePhase < 1 ? requestAnimationFrame(tick) : (pulsePhase = 0, resolve())
    }
    requestAnimationFrame(tick)
  })
}

// ─── Question bar positioning ─────────────────────────────────────────────────
// Place the bar below the selection centroid (or above if selection is low)
function positionQuestionBar(): void {
  if (points.length === 0) return
  const cy  = points.reduce((s, p) => s + p.y, 0) / points.length
  const maxY = Math.max(...points.map(p => p.y))
  const minY = Math.min(...points.map(p => p.y))

  // Prefer below the circle, but flip to above if too close to bottom
  const barH  = 90   // approx bar height
  const gap   = 20
  let top: number

  if (maxY + gap + barH < window.innerHeight - 20) {
    top = maxY + gap
  } else if (minY - gap - barH > 20) {
    top = minY - gap - barH
  } else {
    // fallback: vertically centred below mid-screen
    top = Math.min(window.innerHeight - barH - 24, cy + gap)
  }

  questionBar.style.top    = `${top}px`
  questionBar.style.bottom = 'auto'
}

// ─── Show / hide question bar ─────────────────────────────────────────────────
function showQuestionBar(): void {
  waitingForQ = true
  positionQuestionBar()
  questionInput.value = ''
  updateCounter()
  questionBar.classList.add('visible')
  // Allow text selection inside the input
  canvas.style.pointerEvents = 'none'
  // Focus after transition
  setTimeout(() => questionInput.focus(), 60)
}

function hideQuestionBar(): void {
  waitingForQ = false
  questionBar.classList.remove('visible')
  canvas.style.pointerEvents = ''
  questionInput.value = ''
}

function updateCounter(): void {
  const len  = questionInput.value.length
  const rem  = MAX_QUESTION - len
  qbarCounter.textContent = len > 0 ? `${rem}` : ''
  qbarCounter.classList.toggle('warn', rem < 40)
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitSearch(question: string): Promise<void> {
  hideQuestionBar()
  stopScene()

  if (!annotatedCache) {
    showHint('Could not capture that selection — try again')
    reset()
    return
  }

  // Encode the question into a wrapper so main.ts can read it
  // We send JSON: { image: <dataUrl>, question: <string> }
  // main.ts already receives a string — we'll update it to parse this
  const payload = JSON.stringify({ image: annotatedCache, question })

  reset()

  try {
    await window.electronAPI.captureAndAnalyze(payload)
  } catch (err) {
    console.error('captureAndAnalyze failed:', err)
  }
}

// ─── Annotated screenshot builder ─────────────────────────────────────────────
function buildAnnotatedScreenshot(): string | null {
  if (points.length < 3 || !screenshotDataUrl || !screenshotBg.complete) return null

  const off   = document.createElement('canvas')
  off.width   = canvas.width
  off.height  = canvas.height
  const oCtx  = off.getContext('2d')!

  oCtx.drawImage(screenshotBg, 0, 0, off.width, off.height)
  oCtx.fillStyle = 'rgba(0,0,0,0.45)'
  oCtx.fillRect(0, 0, off.width, off.height)

  const selPath = buildClosedPath(points)
  oCtx.save()
  oCtx.globalCompositeOperation = 'destination-out'
  oCtx.fillStyle = 'rgba(0,0,0,0.45)'
  oCtx.fill(selPath)
  oCtx.restore()

  oCtx.save()
  oCtx.strokeStyle = 'rgba(160,140,255,0.95)'
  oCtx.lineWidth   = 3
  oCtx.shadowColor = 'rgba(140,120,255,0.8)'
  oCtx.shadowBlur  = 8
  oCtx.lineCap  = 'round'
  oCtx.lineJoin = 'round'
  oCtx.stroke(selPath)
  oCtx.restore()

  const long = Math.max(off.width, off.height)
  if (long <= MAX_ANALYSIS_PX) return off.toDataURL('image/jpeg', JPEG_QUALITY)

  const scale = MAX_ANALYSIS_PX / long
  const small = document.createElement('canvas')
  small.width  = Math.round(off.width  * scale)
  small.height = Math.round(off.height * scale)
  small.getContext('2d')!.drawImage(off, 0, 0, small.width, small.height)
  return small.toDataURL('image/jpeg', JPEG_QUALITY)
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showHint(text?: string): void {
  if (text && hintSub) hintSub.textContent = text
  hint.classList.remove('hidden')
  void hint.offsetWidth
  hint.classList.add('visible')
}

function hideHint(): void {
  hint.classList.remove('visible')
  hint.classList.add('hidden')
}

function reset(): void {
  points        = []
  scrimAlpha    = 0
  pulsePhase    = 0
  closingLoop   = false
  closeProgress = 0
  waitingForQ   = false
  annotatedCache = null
}

// ─── Question bar events ──────────────────────────────────────────────────────
questionInput.addEventListener('input', updateCounter)

questionInput.addEventListener('keydown', (e: KeyboardEvent) => {
  e.stopPropagation()   // prevent canvas keydown listeners firing
  if (e.key === 'Enter') {
    e.preventDefault()
    submitSearch(questionInput.value.trim())
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    hideQuestionBar()
    stopScene()
    reset()
    showHint()
  }
})

qbarSubmit.addEventListener('click', () => {
  submitSearch(questionInput.value.trim())
})

qbarSkipBtn.addEventListener('click', () => {
  submitSearch('')
})

// ─── Mouse events ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0 || !screenshotDataUrl) return
  // If question bar is up, a click outside it resets
  if (waitingForQ) {
    hideQuestionBar()
    stopScene()
    reset()
    showHint()
    return
  }
  isDrawing = true
  points    = [{ x: e.clientX, y: e.clientY }]
  hideHint()
  startScene()
})

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isDrawing) return
  scrimAlpha = Math.min(0.42, scrimAlpha + 0.012)
  const last = points[points.length - 1]
  const dx = e.clientX - last.x, dy = e.clientY - last.y
  if (dx * dx + dy * dy > MIN_DIST_SQ) points.push({ x: e.clientX, y: e.clientY })
})

window.addEventListener('mouseup', handleMouseUp)

async function handleMouseUp(): Promise<void> {
  if (!isDrawing) return
  isDrawing = false

  if (points.length < 8) {
    reset()
    showHint('Draw a bigger circle around what you want to search')
    setTimeout(() => showHint('Draw around anything on screen — text, images, code, charts'), 2400)
    return
  }

  await playCloseSnap()
  await playCompletionPulse()

  // Build annotated screenshot once and cache it
  annotatedCache = buildAnnotatedScreenshot()

  if (!annotatedCache) {
    stopScene()
    reset()
    showHint('Could not capture that selection — try again')
    return
  }

  // Show question bar — scene keeps rendering (idle glow)
  showQuestionBar()
}

// ─── Keyboard (global — fires when input NOT focused) ────────────────────────
window.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (waitingForQ) return   // handled by input's own keydown
  isDrawing = false
  stopScene()
  reset()
  hideQuestionBar()
  hint.classList.remove('visible')
  hint.classList.remove('hidden')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  await window.electronAPI.closeOverlay()
})

// ─── IPC ─────────────────────────────────────────────────────────────────────
window.electronAPI.onOverlayOpen(() => {
  screenshotDataUrl = null
  screenshotBg.classList.remove('ready')
  screenshotBg.removeAttribute('src')
  stopScene()
  reset()
  hideQuestionBar()
  showHint('Capturing screen…')
})

// Fired when user closes the results window — fully wipe the overlay
window.electronAPI.onOverlayReset(() => {
  isDrawing = false
  screenshotDataUrl = null
  screenshotBg.classList.remove('ready')
  screenshotBg.removeAttribute('src')
  stopScene()
  reset()
  hideQuestionBar()
  hint.classList.remove('visible')
  hint.classList.remove('hidden')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
})

window.electronAPI.onOverlayBgReady((dataUrl: string) => {
  screenshotDataUrl = dataUrl
  screenshotBg.classList.remove('ready')
  void screenshotBg.offsetWidth
  screenshotBg.src    = dataUrl
  screenshotBg.onload = () => {
    screenshotBg.classList.add('ready')
    showHint('Draw around anything on screen — text, images, code, charts')
  }
})