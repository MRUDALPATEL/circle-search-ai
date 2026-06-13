import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  closeOverlay: (): Promise<void> =>
    ipcRenderer.invoke('overlay-close'),

  onOverlayOpen: (callback: (screenshotDataUrl: string | null) => void): void => {
    ipcRenderer.removeAllListeners('overlay-open')
    ipcRenderer.on('overlay-open', (_event, dataUrl) => callback(dataUrl))
  },

  captureAndAnalyze: (imageDataUrl: string): Promise<void> =>
    ipcRenderer.invoke('capture-and-analyze', imageDataUrl),

  onAnalysisLoading: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('analysis-loading')
    ipcRenderer.on('analysis-loading', () => callback())
  },

  onAnalysisResult: (callback: (result: AnalysisResult) => void): void => {
    ipcRenderer.removeAllListeners('analysis-result')
    ipcRenderer.on('analysis-result', (_event, result) => callback(result))
  },

  onAnalysisError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('analysis-error')
    ipcRenderer.on('analysis-error', (_event, error) => callback(error))
  },

  closeResults: (): Promise<void> =>
    ipcRenderer.invoke('results-close')
})