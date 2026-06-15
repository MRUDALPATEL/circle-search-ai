import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  closeOverlay: (): Promise<void> =>
    ipcRenderer.invoke('overlay-close'),

  // Fired immediately when Alt+Space is pressed — no args, triggers hex animation
  onOverlayOpen: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('overlay-open')
    ipcRenderer.on('overlay-open', () => callback())
  },

  // Fired once screenshot is captured — may arrive 200-600ms after onOverlayOpen
  onOverlayBgReady: (callback: (dataUrl: string) => void): void => {
    ipcRenderer.removeAllListeners('overlay-bg-ready')
    ipcRenderer.on('overlay-bg-ready', (_e, dataUrl: string) => callback(dataUrl))
  },

  captureAndAnalyze: (imageDataUrl: string): Promise<void> =>
    ipcRenderer.invoke('capture-and-analyze', imageDataUrl),

  onAnalysisLoading: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('analysis-loading')
    ipcRenderer.on('analysis-loading', () => callback())
  },

  onAnalysisResult: (callback: (result: AnalysisResult) => void): void => {
    ipcRenderer.removeAllListeners('analysis-result')
    ipcRenderer.on('analysis-result', (_e, result) => callback(result))
  },

  onAnalysisError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('analysis-error')
    ipcRenderer.on('analysis-error', (_e, error) => callback(error))
  },

  closeResults: (): Promise<void> =>
    ipcRenderer.invoke('results-close'),

  followUpQuestion: (question: string): Promise<void> =>
    ipcRenderer.invoke('follow-up-question', question),

  onFollowupLoading: (callback: (question: string) => void): void => {
    ipcRenderer.removeAllListeners('followup-loading')
    ipcRenderer.on('followup-loading', (_e, question: string) => callback(question))
  },

  onFollowupResult: (callback: (payload: { text: string; question: string }) => void): void => {
    ipcRenderer.removeAllListeners('followup-result')
    ipcRenderer.on('followup-result', (_e, payload) => callback(payload))
  },

  onFollowupError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('followup-error')
    ipcRenderer.on('followup-error', (_e, error) => callback(error))
  },
})