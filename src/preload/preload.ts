import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Overlay ────────────────────────────────────────────────────────────────
  closeOverlay: (): Promise<void> =>
    ipcRenderer.invoke('overlay-close'),

  onOverlayOpen: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('overlay-open')
    ipcRenderer.on('overlay-open', () => callback())
  },

  onOverlayReset: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('overlay-reset')
    ipcRenderer.on('overlay-reset', () => callback())
  },

  onOverlayBgReady: (callback: (dataUrl: string) => void): void => {
    ipcRenderer.removeAllListeners('overlay-bg-ready')
    ipcRenderer.on('overlay-bg-ready', (_e, dataUrl: string) => callback(dataUrl))
  },

  // ── Initial analysis (streaming) ───────────────────────────────────────────
  captureAndAnalyze: (payload: string): Promise<void> =>
    ipcRenderer.invoke('capture-and-analyze', payload),

  onAnalysisLoading: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('analysis-loading')
    ipcRenderer.on('analysis-loading', () => callback())
  },

  onAnalysisChunk: (callback: (chunk: string) => void): void => {
    ipcRenderer.removeAllListeners('analysis-chunk')
    ipcRenderer.on('analysis-chunk', (_e, chunk: string) => callback(chunk))
  },

  onAnalysisDone: (callback: (meta: { timestamp: number }) => void): void => {
    ipcRenderer.removeAllListeners('analysis-done')
    ipcRenderer.on('analysis-done', (_e, meta) => callback(meta))
  },

  onAnalysisError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('analysis-error')
    ipcRenderer.on('analysis-error', (_e, error) => callback(error))
  },

  // ── Results window ─────────────────────────────────────────────────────────
  closeResults: (): Promise<void> =>
    ipcRenderer.invoke('results-close'),

  // ── Follow-up conversation (streaming) ────────────────────────────────────
  followUpQuestion: (question: string): Promise<void> =>
    ipcRenderer.invoke('follow-up-question', question),

  onFollowupLoading: (callback: (question: string) => void): void => {
    ipcRenderer.removeAllListeners('followup-loading')
    ipcRenderer.on('followup-loading', (_e, question: string) => callback(question))
  },

  onFollowupChunk: (callback: (chunk: string) => void): void => {
    ipcRenderer.removeAllListeners('followup-chunk')
    ipcRenderer.on('followup-chunk', (_e, chunk: string) => callback(chunk))
  },

  onFollowupDone: (callback: (meta: { question: string }) => void): void => {
    ipcRenderer.removeAllListeners('followup-done')
    ipcRenderer.on('followup-done', (_e, meta) => callback(meta))
  },

  onFollowupError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('followup-error')
    ipcRenderer.on('followup-error', (_e, error) => callback(error))
  },

})