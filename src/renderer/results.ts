/// <reference path="../types/global.d.ts" />

const loadingState = document.getElementById('loading-state') as HTMLDivElement
const resultState = document.getElementById('result-state') as HTMLDivElement
const errorState = document.getElementById('error-state') as HTMLDivElement
const resultContent = document.getElementById('result-content') as HTMLDivElement
const errorMessage = document.getElementById('error-message') as HTMLDivElement
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement
const timestampEl = document.getElementById('timestamp') as HTMLSpanElement

let currentResultText = ''

function showLoading(): void {
  loadingState.style.display = 'flex'
  resultState.classList.remove('visible')
  errorState.classList.remove('visible')
  copyBtn.style.display = 'none'
  currentResultText = ''
  timestampEl.textContent = ''
  resultContent.innerHTML = ''
  errorMessage.textContent = ''
}

function showResult(result: AnalysisResult): void {
  loadingState.style.display = 'none'
  resultState.classList.add('visible')
  errorState.classList.remove('visible')
  copyBtn.style.display = 'inline-block'
  copyBtn.textContent = 'Copy'
  copyBtn.classList.remove('copied')

  currentResultText = result.text
  resultContent.innerHTML = renderMarkdown(result.text)

  const date = new Date(result.timestamp)
  timestampEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function showError(error: string): void {
  loadingState.style.display = 'none'
  resultState.classList.remove('visible')
  errorState.classList.add('visible')
  copyBtn.style.display = 'none'

  if (
    error.toLowerCase().includes('api_key') ||
    error.toLowerCase().includes('api key') ||
    error.toLowerCase().includes('authentication') ||
    error.toLowerCase().includes('invalid key') ||
    error.toLowerCase().includes('your_gemini')
  ) {
    errorMessage.textContent =
      'Gemini API key is missing or invalid. Set the GEMINI_API_KEY environment variable before launching, or edit src/main/main.ts.'
  } else if (error.toLowerCase().includes('quota')) {
    errorMessage.textContent = 'Gemini API quota exceeded. Try again later or check your Google AI usage limits.'
  } else if (error.toLowerCase().includes('network') || error.toLowerCase().includes('fetch')) {
    errorMessage.textContent = 'Network error — check your internet connection and try again.'
  } else {
    errorMessage.textContent = error
  }
}

// Minimal Markdown → safe HTML renderer
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarkdown(text: string): string {
  // Split out code blocks first to protect them
  const codeBlocks: string[] = []
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    return `%%CODE_BLOCK_${idx}%%`
  })

  // Escape remaining HTML
  html = escapeHtml(html)

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Lists
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Paragraphs (wrap non-tag lines)
  const lines = html.split('\n')
  const processed = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    if (/^<(h[1-3]|li|ul|ol|pre|blockquote)/.test(trimmed)) return trimmed
    if (/^%%CODE_BLOCK_/.test(trimmed)) return trimmed
    return `<p>${trimmed}</p>`
  })

  html = processed.join('\n')

  // Restore code blocks
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`%%CODE_BLOCK_${idx}%%`, block)
  })

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  return html
}

// Copy button
copyBtn.addEventListener('click', async () => {
  if (!currentResultText) return
  try {
    await navigator.clipboard.writeText(currentResultText)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = currentResultText
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copyBtn.textContent = 'Copied ✓'
  copyBtn.classList.add('copied')
  setTimeout(() => {
    copyBtn.textContent = 'Copy'
    copyBtn.classList.remove('copied')
  }, 2000)
})

// Close
closeBtn.addEventListener('click', () => window.electronAPI.closeResults())
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') window.electronAPI.closeResults()
})

// IPC
window.electronAPI.onAnalysisLoading(() => showLoading())
window.electronAPI.onAnalysisResult((result: AnalysisResult) => showResult(result))
window.electronAPI.onAnalysisError((error: string) => showError(error))

// Initial state
showLoading()