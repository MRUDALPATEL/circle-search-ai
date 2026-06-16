/// <reference path="../types/global.d.ts" />

// ─── Elements ────────────────────────────────────────────────────────────────
const appShell      = document.getElementById('app-shell')      as HTMLDivElement
const loadingState  = document.getElementById('loading-state')  as HTMLDivElement
const chatThread    = document.getElementById('chat-thread')    as HTMLDivElement
const errorState    = document.getElementById('error-state')    as HTMLDivElement
const errorMessage  = document.getElementById('error-message')  as HTMLDivElement
const followupBar   = document.getElementById('followup-bar')   as HTMLDivElement
const followupInput = document.getElementById('followup-input') as HTMLTextAreaElement
const followupSend  = document.getElementById('followup-send')  as HTMLButtonElement
const copyBtn       = document.getElementById('copy-btn')       as HTMLButtonElement
const closeBtn      = document.getElementById('close-btn')      as HTMLButtonElement
const timestampEl   = document.getElementById('timestamp')      as HTMLSpanElement

// Make shell visible immediately — no animation dependency
appShell.style.opacity   = '1'
appShell.style.transform = 'none'

// ─── Markdown renderer ────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function renderMarkdown(raw: string): string {
  let h = escHtml(raw)
  // fenced code blocks first (before other rules touch content)
  h = h.replace(/```[\w]*\n([\s\S]*?)```/g, (_,c) => `<pre><code>${c.trimEnd()}</code></pre>`)
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  h = h.replace(/^## (.+)$/gm,  '<h2>$1</h2>')
  h = h.replace(/^# (.+)$/gm,   '<h1>$1</h1>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g,     '<em>$1</em>')
  h = h.replace(/`([^`\n]+)`/g,   '<code>$1</code>')
  h = h.replace(/^&gt; (.+)$/gm,  '<blockquote>$1</blockquote>')
  h = h.replace(/^---$/gm,        '<hr>')
  h = h.replace(/((?:^[-*] .+\n?)+)/gm, b =>
    `<ul>${b.trim().split('\n').map(l=>`<li>${l.replace(/^[-*] /,'')}</li>`).join('')}</ul>`)
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, b =>
    `<ol>${b.trim().split('\n').map(l=>`<li>${l.replace(/^\d+\. /,'')}</li>`).join('')}</ol>`)
  h = h.split(/\n{2,}/).map(b => {
    b = b.trim()
    if (!b) return ''
    if (/^<(h[1-6]|ul|ol|pre|hr|blockquote)/.test(b)) return b
    return `<p>${b.replace(/\n/g,'<br>')}</p>`
  }).join('\n')
  return h
}

// ─── State ───────────────────────────────────────────────────────────────────
let lastAiText      = ''   // full accumulated text of latest AI message
let streamingBubble : HTMLDivElement | null = null  // the .bubble div being streamed into
let streamingRaw    = ''   // raw markdown accumulator during streaming

// ─── Streaming bubble helpers ─────────────────────────────────────────────────
// Creates a new AI message shell and returns the inner .bubble div
function createAiBubble(isFollowup = false): HTMLDivElement {
  const msg = document.createElement('div')
  msg.className = isFollowup ? 'msg msg-ai' : 'msg msg-ai first-msg'
  msg.innerHTML = `
    <div class="msg-ai-header">
      <div class="msg-ai-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="rgba(150,135,255,0.85)" stroke-width="1.2"/>
        </svg>
      </div>
      <span class="msg-ai-label">Circle Search AI</span>
    </div>
    <div class="bubble"></div>`
  chatThread.appendChild(msg)
  scrollBottom()
  return msg.querySelector('.bubble') as HTMLDivElement
}

// Called on each incoming chunk — re-renders markdown into the live bubble
function appendChunkToBubble(chunk: string): void {
  if (!streamingBubble) return
  streamingRaw += chunk
  lastAiText    = streamingRaw
  // Re-render the whole markdown each chunk so formatting is always correct
  streamingBubble.innerHTML = renderMarkdown(streamingRaw)
  // Blinking cursor at end
  streamingBubble.innerHTML += '<span class="stream-cursor">▋</span>'
  scrollBottom()
}

function finishBubble(): void {
  if (!streamingBubble) return
  // Final render without cursor
  streamingBubble.innerHTML = renderMarkdown(streamingRaw)
  streamingBubble = null
  streamingRaw    = ''
  scrollBottom()
}

function appendUserMsg(question: string): void {
  if (!question) return
  const msg = document.createElement('div')
  msg.className = 'msg msg-user'
  msg.innerHTML = `<div class="bubble">${escHtml(question)}</div>`
  chatThread.appendChild(msg)
  scrollBottom()
}

function appendTypingIndicator(): void {
  removeTypingIndicator()
  const msg = document.createElement('div')
  msg.id = 'typing-indicator'
  msg.className = 'msg msg-ai msg-loading'
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

// ─── View states ──────────────────────────────────────────────────────────────
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
  streamingBubble = null
  streamingRaw    = ''
  errorMessage.textContent = msg
  errorState.style.display = 'flex'
  errorState.classList.add('visible')
}

// ─── IPC: initial analysis (streaming) ───────────────────────────────────────
window.electronAPI.onAnalysisLoading(() => {
  chatThread.innerHTML = ''
  lastAiText      = ''
  streamingBubble = null
  streamingRaw    = ''
  showLoading()
})

window.electronAPI.onAnalysisChunk((chunk) => {
  // First chunk — swap loading spinner for the chat thread instantly
  if (!streamingBubble) {
    showChat()
    streamingBubble = createAiBubble(false)
  }
  appendChunkToBubble(chunk)
})

window.electronAPI.onAnalysisDone((meta) => {
  finishBubble()
  if (meta?.timestamp) {
    timestampEl.textContent = new Date(meta.timestamp).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    })
  }
})

window.electronAPI.onAnalysisError((error) => {
  finishBubble()
  showError(error)
})

// ─── IPC: follow-up (streaming) ───────────────────────────────────────────────
window.electronAPI.onFollowupLoading((question) => {
  appendUserMsg(question)
  appendTypingIndicator()
  followupSend.disabled  = true
  followupInput.disabled = true
})

window.electronAPI.onFollowupChunk((chunk) => {
  // First chunk of follow-up — replace typing indicator with real bubble
  if (!streamingBubble) {
    removeTypingIndicator()
    streamingBubble = createAiBubble(true)
    streamingRaw    = ''
  }
  appendChunkToBubble(chunk)
})

window.electronAPI.onFollowupDone(() => {
  finishBubble()
  followupInput.disabled = false
  followupSend.disabled  = !followupInput.value.trim()
  followupInput.focus()
})

window.electronAPI.onFollowupError((error) => {
  removeTypingIndicator()
  finishBubble()
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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowup() }
})
followupSend.addEventListener('click', sendFollowup)

async function sendFollowup(): Promise<void> {
  const q = followupInput.value.trim()
  if (!q || followupInput.disabled) return
  followupInput.value = ''
  followupInput.style.height = 'auto'
  followupSend.disabled = true
  streamingBubble = null
  streamingRaw    = ''
  try { await window.electronAPI.followUpQuestion(q) }
  catch (err) { console.error('Follow-up IPC failed:', err) }
}

// ─── Copy (copies latest full AI response) ───────────────────────────────────
copyBtn.addEventListener('click', async () => {
  if (!lastAiText) return
  await navigator.clipboard.writeText(lastAiText)
  copyBtn.textContent = 'Copied!'
  copyBtn.classList.add('copied')
  setTimeout(() => {
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="4" y="4" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
      <path d="M3 8H2.5A1.5 1.5 0 0 1 1 6.5v-4A1.5 1.5 0 0 1 2.5 1h4A1.5 1.5 0 0 1 8 2.5V3"
        stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg> Copy`
    copyBtn.classList.remove('copied')
  }, 1800)
})

closeBtn.addEventListener('click', async () => { await window.electronAPI.closeResults() })