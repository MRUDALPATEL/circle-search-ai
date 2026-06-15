export {}

declare global {
  interface Window {
    electronAPI: {
      closeOverlay:       () => Promise<void>
      onOverlayOpen:      (callback: () => void) => void
      onOverlayBgReady:   (callback: (dataUrl: string) => void) => void
      captureAndAnalyze:  (imageDataUrl: string) => Promise<void>
      onAnalysisLoading:  (callback: () => void) => void
      onAnalysisResult:   (callback: (result: AnalysisResult) => void) => void
      onAnalysisError:    (callback: (error: string) => void) => void
      closeResults:       () => Promise<void>
      // Follow-up conversation
      followUpQuestion:   (question: string) => Promise<void>
      onFollowupLoading:  (callback: (question: string) => void) => void
      onFollowupResult:   (callback: (payload: { text: string; question: string }) => void) => void
      onFollowupError:    (callback: (error: string) => void) => void
    }
  }

  interface AnalysisResult {
    text:      string
    timestamp: number
  }
}