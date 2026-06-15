/// <reference path="../types/global.d.ts" />

// ─── Elements ────────────────────────────────────────────────────────────────
const appShell      = document.getElementById('app-shell')     as HTMLDivElement
const loadingState  = document.getElementById('loading-state') as HTMLDivElement
const chatThread    = document.getElementById('chat-thread')   as HTMLDivElement
const errorState    = document.getElementById('error-state')   as HTMLDivElement
const errorMessage  = document.getElementById('error-message') as HTMLDivElement
const followupBar   = document.getElementById('followup-bar')  as HTMLDivElement
const followupInput = document.getElementById('followup-input')as HTMLTextAreaElement
const followupSend  = document.getElementById('followup-send') as HTMLButtonElement
const copyBtn       = document.getElementById('copy-btn')      as HTMLButtonElement
const closeBtn      = document.getElementById('close-btn')     as HTMLButtonElement
const timestampEl   = document.getElementById('timestamp')     as HTMLSpanElement

// ─── Ensure shell is visible immediately (no opacity flicker) ────────────────
// Remove reliance on animation for visibility — just make it visible right away
appShell.style.opacity   = '1'
appShell.style.transform = 'none'

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMarkdown(raw: string): string {
  let html = escHtml(raw)

  // fenced code blocks (do first, before other replacements touch content)
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
    `<pre><code>${code.trimEnd()}</code></pre>`)

  // headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>')

  // bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>')

  // inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')

  // blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // hr
  html = html.replace(/^---$/gm, '<hr>')

  // lists — collect consecutive li lines
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[-*] /, '')}</li>`)
      .join('')
    return `<ul>${items}</ul>`
  })
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`)
      .join('')
    return `<ol>${items}</ol>`
  })

  // paragraphs — split on blank lines, wrap non-block-element lines
  const blocks = html.split(/\n{2,}/)
  html = blocks.map(b => {
    b = b.trim()
    if (!b) return ''
    if (/^<(h[1-6]|ul|ol|pre|hr|blockquote)/.test(b)) return b
    return `<p>${b.replace(/\n/g, '<br>')}</p>`
  }).join('\n')

  return html
}

// ─── State ───────────────────────────────────────────────────────────────────
let lastAiText = ''

// ─── Bubble builders ─────────────────────────────────────────────────────────
function appendUserMsg(question: string): void {
  if (!question) return
  const msg = document.createElement('div')
  msg.className = 'msg msg-user'
  msg.innerHTML = `<div class="bubble">${escHtml(question)}</div>`
  chatThread.appendChild(msg)
  scrollBottom()
}

function appendAiMsg(text: string): void {
  lastAiText = text
  const msg = document.createElement('div')
  msg.className = 'msg msg-ai'
  msg.innerHTML = `
    <div class="msg-ai-header">
      <div class="msg-ai-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="rgba(150,135,255,0.85)" stroke-width="1.2"/>
        </svg>
      </div>
      <span class="msg-ai-label">Circle Search AI</span>
    </div>
    <div class="bubble">${renderMarkdown(text)}</div>`
  chatThread.appendChild(msg)
  scrollBottom()
}

function appendTypingIndicator(): void {
  removeTypingIndicator()
  const msg = document.createElement('div')
  msg.className = 'msg msg-ai msg-loading'
  msg.id = 'typing-indicator'
  msg.innerHTML = `
    <div class="msg-ai-header">
      <div class="msg-ai-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="rgba(150,135,255,0.85)" stroke-width="1.2"/>
        </svg>
      </div>
      <span class="msg-ai-label">Circle Search AI</span>
    </div>
    <div class="bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`
  chatThread.appendChild(msg)
  scrollBottom()
}

function removeTypingIndicator(): void {
  document.getElementById('typing-indicator')?.remove()
}

function scrollBottom(): void {
  requestAnimationFrame(() => { chatThread.scrollTop = chatThread.scrollHeight })
}

// ─── View states ─────────────────────────────────────────────────────────────
function showLoading(): void {
  loadingState.style.display = 'flex'
  chatThread.style.display   = 'none'
  chatThread.classList.remove('visible')
  errorState.style.display   = 'none'
  errorState.classList.remove('visible')
  followupBar.style.display  = 'none'
  followupBar.classList.remove('visible')
}

function showChat(): void {
  loadingState.style.display = 'none'
  errorState.style.display   = 'none'
  errorState.classList.remove('visible')
  chatThread.style.display   = 'flex'
  chatThread.classList.add('visible')
  followupBar.style.display  = 'block'
  followupBar.classList.add('visible')
}

function showError(msg: string): void {
  loadingState.style.display = 'none'
  chatThread.style.display   = 'none'
  chatThread.classList.remove('visible')
  followupBar.style.display  = 'none'
  followupBar.classList.remove('visible')
  errorMessage.textContent   = msg
  errorState.style.display   = 'flex'
  errorState.classList.add('visible')
}

// ─── IPC: initial analysis ────────────────────────────────────────────────────
window.electronAPI.onAnalysisLoading(() => {
  chatThread.innerHTML = ''
  lastAiText = ''
  showLoading()
})

window.electronAPI.onAnalysisResult((result) => {
  showChat()
  appendAiMsg(result.text)
  if (result.timestamp) {
    timestampEl.textContent = new Date(result.timestamp).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    })
  }
})

window.electronAPI.onAnalysisError((error) => {
  showError(error)
})

// ─── IPC: follow-up ───────────────────────────────────────────────────────────
window.electronAPI.onFollowupLoading((question) => {
  appendUserMsg(question)
  appendTypingIndicator()
  followupSend.disabled  = true
  followupInput.disabled = true
})

window.electronAPI.onFollowupResult(({ text }) => {
  removeTypingIndicator()
  appendAiMsg(text)
  followupInput.disabled = false
  followupSend.disabled  = !followupInput.value.trim()
  followupInput.focus()
})

window.electronAPI.onFollowupError((error) => {
  removeTypingIndicator()
  const msg = document.createElement('div')
  msg.className = 'msg msg-ai'
  msg.innerHTML = `<div class="bubble" style="color:rgba(252,165,165,0.8);font-size:12.5px;">⚠️ ${escHtml(error)}</div>`
  chatThread.appendChild(msg)
  scrollBottom()
  followupInput.disabled = false
  followupSend.disabled  = !followupInput.value.trim()
})

// ─── Follow-up input ──────────────────────────────────────────────────────────
followupInput.addEventListener('input', () => {
  followupInput.style.height = 'auto'
  followupInput.style.height = Math.min(followupInput.scrollHeight, 96) + 'px'
  followupSend.disabled = !followupInput.value.trim()
})

followupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendFollowup()
  }
})

followupSend.addEventListener('click', sendFollowup)

async function sendFollowup(): Promise<void> {
  const q = followupInput.value.trim()
  if (!q || followupInput.disabled) return
  followupInput.value = ''
  followupInput.style.height = 'auto'
  followupSend.disabled = true
  try {
    await window.electronAPI.followUpQuestion(q)
  } catch (err) {
    console.error('Follow-up IPC failed:', err)
  }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  if (!lastAiText) return
  await navigator.clipboard.writeText(lastAiText)
  copyBtn.textContent = 'Copied!'
  copyBtn.classList.add('copied')
  setTimeout(() => {
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="4" y="4" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
      <path d="M3 8H2.5A1.5 1.5 0 0 1 1 6.5v-4A1.5 1.5 0 0 1 2.5 1h4A1.5 1.5 0 0 1 8 2.5V3"
        stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
    </svg> Copy`
    copyBtn.classList.remove('copied')
  }, 1800)
})

// ─── Close ────────────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', async () => {
  await window.electronAPI.closeResults()
})