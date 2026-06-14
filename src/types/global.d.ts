export {}

declare global {
  interface Window {
    electronAPI: {
      closeOverlay: () => Promise<void>
      onOverlayOpen: (callback: (screenshotDataUrl: string | null) => void) => void
      onOverlayBgReady: (callback: (screenshotDataUrl: string) => void) => void
      captureAndAnalyze: (imageDataUrl: string) => Promise<void>
      onAnalysisLoading: (callback: () => void) => void
      onAnalysisResult: (callback: (result: AnalysisResult) => void) => void
      onAnalysisError: (callback: (error: string) => void) => void
      closeResults: () => Promise<void>
    }
  }

  interface AnalysisResult {
    text: string
    timestamp: number
  }
}