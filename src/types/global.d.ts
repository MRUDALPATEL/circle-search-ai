export {}

declare global {
  interface Window {
    electronAPI: {
      // Overlay
      closeOverlay:      () => Promise<void>
      onOverlayOpen:     (callback: () => void) => void
      onOverlayReset:    (callback: () => void) => void
      onOverlayBgReady:  (callback: (dataUrl: string) => void) => void
      // Initial analysis — streaming
      captureAndAnalyze: (payload: string) => Promise<void>
      onAnalysisLoading: (callback: () => void) => void
      onAnalysisChunk:   (callback: (chunk: string) => void) => void
      onAnalysisDone:    (callback: (meta: { timestamp: number }) => void) => void
      onAnalysisError:   (callback: (error: string) => void) => void
      // Results
      closeResults:      () => Promise<void>
      // Follow-up — streaming
      followUpQuestion:  (question: string) => Promise<void>
      onFollowupLoading: (callback: (question: string) => void) => void
      onFollowupChunk:   (callback: (chunk: string) => void) => void
      onFollowupDone:    (callback: (meta: { question: string }) => void) => void
      onFollowupError:   (callback: (error: string) => void) => void
    }
  }

  interface AnalysisResult {
    text:      string
    timestamp: number
  }
}