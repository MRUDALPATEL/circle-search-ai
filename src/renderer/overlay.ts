/// <reference path="../types/global.d.ts" />

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const hint = document.getElementById('hint') as HTMLDivElement
const analyzingOverlay = document.getElementById('analyzing-overlay') as HTMLDivElement
const screenshotBg = document.getElementById('screenshot-bg') as HTMLImageElement

// State
let isDrawing = false
let points: { x: number; y: number }[] = []
let screenshotDataUrl: string | null = null
let animationFrame: number | null = null
let isSelecting = false
let startX = 0
let startY = 0

const box = document.createElement('div')
box.className = 'selection-box'
document.body.appendChild(box)

// Sizing
function resizeCanvas(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

resizeCanvas()
window.addEventListener('resize', resizeCanvas)

// Smooth the path using Catmull-Rom spline
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

function drawPath(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (points.length < 2) return

  // Marching ants dash offset for animation
  const time = Date.now() / 50

  // Draw selection mask - punch hole through dim layer effect
  // First draw the lasso stroke
  ctx.save()
  ctx.beginPath()

  if (points.length < 4) {
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
  } else {
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]

      for (let t = 0; t <= 1; t += 0.05) {
        const pt = getCatmullRomPoint(p0, p1, p2, p3, t)
        ctx.lineTo(pt.x, pt.y)
      }
    }
  }

  if (isDrawing) {
    ctx.closePath()
  } else {
    ctx.closePath()
  }

  // Filled semi-transparent selection
  ctx.fillStyle = 'rgba(124, 111, 247, 0.15)'
  ctx.fill()

  // Outer glow
  ctx.strokeStyle = 'rgba(124, 111, 247, 0.6)'
  ctx.lineWidth = 2
  ctx.shadowColor = '#7c6ff7'
  ctx.shadowBlur = 8
  ctx.setLineDash([8, 4])
  ctx.lineDashOffset = -time % 12
  ctx.stroke()

  // Inner stroke
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 1.5
  ctx.shadowBlur = 0
  ctx.setLineDash([8, 4])
  ctx.lineDashOffset = -time % 12
  ctx.stroke()

  ctx.restore()
}

function animateLoop(): void {
  if (isDrawing) {
    drawPath()
    animationFrame = requestAnimationFrame(animateLoop)
  }
}

// Extract cropped image from the freehand selection
function extractSelection(): string | null {
  if (points.length < 3 || !screenshotDataUrl) return null

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  const padX = 12
  const padY = 12
  minX = Math.max(0, minX - padX)
  minY = Math.max(0, minY - padY)
  maxX = Math.min(canvas.width, maxX + padX)
  maxY = Math.min(canvas.height, maxY + padY)

  const cropWidth = maxX - minX
  const cropHeight = maxY - minY

  if (cropWidth < 10 || cropHeight < 10) return null

  // Draw on offscreen canvas with clipping mask
  const offscreen = document.createElement('canvas')
  offscreen.width = cropWidth
  offscreen.height = cropHeight
  const offCtx = offscreen.getContext('2d')!

  // Build clip path translated to offscreen coords
  offCtx.save()
  offCtx.beginPath()

  const translated = points.map(p => ({ x: p.x - minX, y: p.y - minY }))

  if (translated.length < 4) {
    offCtx.moveTo(translated[0].x, translated[0].y)
    for (let i = 1; i < translated.length; i++) {
      offCtx.lineTo(translated[i].x, translated[i].y)
    }
  } else {
    offCtx.moveTo(translated[0].x, translated[0].y)
    for (let i = 0; i < translated.length - 1; i++) {
      const p0 = translated[Math.max(0, i - 1)]
      const p1 = translated[i]
      const p2 = translated[i + 1]
      const p3 = translated[Math.min(translated.length - 1, i + 2)]

      for (let t = 0; t <= 1; t += 0.05) {
        const pt = getCatmullRomPoint(p0, p1, p2, p3, t)
        offCtx.lineTo(pt.x, pt.y)
      }
    }
  }

  offCtx.closePath()
  offCtx.clip()

  // Draw the screenshot onto the offscreen canvas, cropped to bounding box
  const img = new Image()
  img.src = screenshotDataUrl

  // Since img is already loaded (we set screenshotBg.src earlier), draw synchronously
  offCtx.drawImage(img, -minX, -minY, canvas.width, canvas.height)
  offCtx.restore()

  return offscreen.toDataURL('image/png')
}

// Mouse events
canvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0) return
  isDrawing = true
  points = [{ x: e.clientX, y: e.clientY }]
  hint.classList.add('hidden')
  animationFrame = requestAnimationFrame(animateLoop)
})

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isDrawing) return
  const last = points[points.length - 1]
  const dx = e.clientX - last.x
  const dy = e.clientY - last.y
  // Throttle: only add point if moved enough
  if (dx * dx + dy * dy > 16) {
    points.push({ x: e.clientX, y: e.clientY })
  }
})

canvas.addEventListener('mouseup', async () => {
  if (!isDrawing) return
  isDrawing = false

  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  // Close the path visually
  drawPath()

  if (points.length < 5) {
    // Too small a selection, reset
    reset()
    hint.classList.remove('hidden')
    return
  }

  // Show analyzing state
  analyzingOverlay.classList.add('visible')

  const croppedDataUrl = extractSelection()

  if (!croppedDataUrl) {
    analyzingOverlay.classList.remove('visible')
    reset()
    hint.classList.remove('hidden')
    return
  }

  try {
    await window.electronAPI.captureAndAnalyze(croppedDataUrl)
  } catch (err) {
    console.error('captureAndAnalyze failed:', err)
  }

  analyzingOverlay.classList.remove('visible')
  reset()
})

function reset(): void {
  points = []
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// ESC key
window.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    isDrawing = false
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    reset()
    hint.classList.remove('hidden')
    await window.electronAPI.closeOverlay()
  }
})

// Listen for overlay open signal
window.electronAPI.onOverlayOpen((dataUrl: string | null) => {
  screenshotDataUrl = dataUrl

  if (dataUrl) {
    screenshotBg.src = dataUrl
  }

  reset()
  hint.classList.remove('hidden')
  analyzingOverlay.classList.remove('visible')
})