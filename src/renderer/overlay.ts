/// <reference path="../types/global.d.ts" />

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const hint = document.getElementById('hint') as HTMLDivElement
const screenshotBg = document.getElementById('screenshot-bg') as HTMLImageElement
const rippleLayer = document.getElementById('ripple-layer') as HTMLDivElement

const MAX_ANALYSIS_PX = 1024
const JPEG_QUALITY = 0.82

// Apple-style iridescent palette
const IRIS_STROKES = [
  { color: 'rgba(0, 122, 255, 0.95)', blur: 14 },
  { color: 'rgba(175, 82, 222, 0.85)', blur: 10 },
  { color: 'rgba(255, 45, 85, 0.75)', blur: 8 },
  { color: 'rgba(255, 255, 255, 0.92)', blur: 0 },
]

let isDrawing = false
let points: { x: number; y: number }[] = []
let screenshotDataUrl: string | null = null
let animationFrame: number | null = null
let pulseScale = 1
let pulseGlow = 0
let sceneActive = false

function resizeCanvas(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

resizeCanvas()
window.addEventListener('resize', resizeCanvas)

function getCatmullRomPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  }
}

function tracePath(path: Path2D, smooth: boolean): void {
  if (points.length < 2) return

  if (!smooth || points.length < 4) {
    path.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y)
    }
    return
  }

  path.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    for (let t = 0; t <= 1; t += 0.05) {
      const pt = getCatmullRomPoint(p0, p1, p2, p3, t)
      path.lineTo(pt.x, pt.y)
    }
  }
}

function buildSelectionPath(smooth: boolean): Path2D | null {
  if (points.length < 2) return null
  const path = new Path2D()
  tracePath(path, smooth)
  path.closePath()
  return path
}

function drawIdleDim(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function drawScene(smooth: boolean): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const path = buildSelectionPath(smooth)
  const time = Date.now() / 1000
  const dashOffset = (Date.now() / 40) % 24

  // Dim everything except selection (Apple cutout)
  ctx.save()
  ctx.fillStyle = `rgba(0, 0, 0, ${0.42 + pulseGlow * 0.08})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (path) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0, 0, 0, 1)'
    ctx.fill(path)
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()

  if (!path) return

  // Lift selected region — subtle brightening
  ctx.save()
  ctx.clip(path)
  ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + pulseGlow * 0.06})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.restore()

  // Scale path around centroid for completion pulse
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(pulseScale, pulseScale)
  ctx.translate(-cx, -cy)

  // Iridescent animated strokes
  IRIS_STROKES.forEach((stroke, i) => {
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = i === IRIS_STROKES.length - 1 ? 2 : 3.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = stroke.color
    ctx.shadowBlur = stroke.blur + pulseGlow * 16
    ctx.setLineDash([10, 6])
    ctx.lineDashOffset = dashOffset + i * 6 + time * 30
    ctx.stroke(path)
    ctx.restore()
  })

  ctx.restore()
}

function startSceneLoop(): void {
  if (sceneActive) return
  sceneActive = true

  const loop = (): void => {
    if (!sceneActive) return
    drawScene(isDrawing ? false : true)
    animationFrame = requestAnimationFrame(loop)
  }
  loop()
}

function stopSceneLoop(): void {
  sceneActive = false
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function spawnRipple(x: number, y: number): void {
  const ripple = document.createElement('div')
  ripple.className = 'ripple'
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  rippleLayer.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove())
}

function playCompletionPulse(): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now()
    const duration = 340

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      // Springy ease-out
      const eased = 1 - Math.pow(1 - t, 3)
      pulseScale = 1 + eased * 0.045
      pulseGlow = Math.sin(t * Math.PI) * (1 - t * 0.3)

      if (t < 1) {
        requestAnimationFrame(tick)
      } else {
        pulseScale = 1
        pulseGlow = 0
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

function toAnalysisPayload(source: HTMLCanvasElement): string {
  const longEdge = Math.max(source.width, source.height)
  if (longEdge <= MAX_ANALYSIS_PX) {
    return source.toDataURL('image/jpeg', JPEG_QUALITY)
  }

  const scale = MAX_ANALYSIS_PX / longEdge
  const resized = document.createElement('canvas')
  resized.width = Math.round(source.width * scale)
  resized.height = Math.round(source.height * scale)
  resized.getContext('2d')!.drawImage(source, 0, 0, resized.width, resized.height)
  return resized.toDataURL('image/jpeg', JPEG_QUALITY)
}

function extractSelection(): string | null {
  if (points.length < 3 || !screenshotDataUrl || !screenshotBg.complete) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  const pad = 12
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(canvas.width, maxX + pad)
  maxY = Math.min(canvas.height, maxY + pad)

  const cropWidth = maxX - minX
  const cropHeight = maxY - minY
  if (cropWidth < 10 || cropHeight < 10) return null

  const offscreen = document.createElement('canvas')
  offscreen.width = cropWidth
  offscreen.height = cropHeight
  const offCtx = offscreen.getContext('2d')!

  offCtx.save()
  const clipPath = new Path2D()
  const translated = points.map(p => ({ x: p.x - minX, y: p.y - minY }))
  const savedPoints = points
  points = translated
  tracePath(clipPath, true)
  points = savedPoints
  clipPath.closePath()
  offCtx.clip(clipPath)

  offCtx.drawImage(screenshotBg, -minX, -minY, canvas.width, canvas.height)
  offCtx.restore()

  return toAnalysisPayload(offscreen)
}

canvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0 || !screenshotDataUrl) return
  isDrawing = true
  points = [{ x: e.clientX, y: e.clientY }]
  hint.classList.remove('visible')
  hint.classList.add('hidden')
  spawnRipple(e.clientX, e.clientY)
  startSceneLoop()
})

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isDrawing) return
  const last = points[points.length - 1]
  const dx = e.clientX - last.x
  const dy = e.clientY - last.y
  if (dx * dx + dy * dy > 25) {
    points.push({ x: e.clientX, y: e.clientY })
  }
})

canvas.addEventListener('mouseup', async () => {
  if (!isDrawing) return
  isDrawing = false

  if (points.length < 5) {
    stopSceneLoop()
    reset()
    hint.classList.remove('hidden')
    hint.classList.add('visible')
    return
  }

  await playCompletionPulse()

  const croppedDataUrl = extractSelection()
  if (!croppedDataUrl) {
    stopSceneLoop()
    reset()
    hint.classList.remove('hidden')
    hint.classList.add('visible')
    return
  }

  stopSceneLoop()
  reset()

  try {
    await window.electronAPI.captureAndAnalyze(croppedDataUrl)
  } catch (err) {
    console.error('captureAndAnalyze failed:', err)
  }
})

function reset(): void {
  points = []
  pulseScale = 1
  pulseGlow = 0
  if (screenshotDataUrl) drawIdleDim()
  else ctx.clearRect(0, 0, canvas.width, canvas.height)
}

window.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    isDrawing = false
    stopSceneLoop()
    reset()
    hint.classList.remove('hidden')
    hint.classList.add('visible')
    await window.electronAPI.closeOverlay()
  }
})

function applyScreenshot(dataUrl: string): void {
  screenshotDataUrl = dataUrl
  screenshotBg.classList.remove('ready')
  void screenshotBg.offsetWidth
  screenshotBg.src = dataUrl
  screenshotBg.onload = () => {
    screenshotBg.classList.add('ready')
    hint.classList.remove('hidden')
    hint.classList.add('visible')
    drawIdleDim()
  }
}

window.electronAPI.onOverlayOpen(() => {
  screenshotDataUrl = null
  screenshotBg.classList.remove('ready')
  screenshotBg.removeAttribute('src')
  stopSceneLoop()
  reset()
  rippleLayer.innerHTML = ''
  hint.classList.remove('hidden', 'visible')
  void hint.offsetWidth
  hint.classList.add('visible')
  hint.querySelector('.hint-subtitle')!.textContent =
    'Capturing screen… draw once the background appears'
})

window.electronAPI.onOverlayBgReady((dataUrl: string) => {
  applyScreenshot(dataUrl)
  hint.querySelector('.hint-subtitle')!.textContent =
    'Draw around text, code, products, images, charts, documents, or anything on screen'
})
