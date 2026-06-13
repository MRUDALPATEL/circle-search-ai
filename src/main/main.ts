import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  desktopCapturer,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

// __dirname polyfill — works whether electron-vite outputs CJS or ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";

let overlayWindow: BrowserWindow | null = null;
let resultsWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === "development";

function getPreloadPath(): string {
  // electron-vite with lib entry outputs preload/preload.js (or .mjs on newer versions)
  // Try .js first; if your build outputs .mjs, change this to preload.mjs
  return path.join(__dirname, "../preload/preload.js");
}

async function captureScreen(): Promise<string> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });

  if (!sources[0]) throw new Error("No screen source found");
  return sources[0].thumbnail.toDataURL();
}

function createOverlayWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().size;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    overlayWindow.loadURL("http://localhost:5173/overlay.html");
  } else {
    overlayWindow.loadFile(path.join(__dirname, "../renderer/overlay.html"));
  }

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function createResultsWindow(): void {
  resultsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    show: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    center: true,
    backgroundColor: "#0f0f1a",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    resultsWindow.loadURL("http://localhost:5173/results.html");
  } else {
    resultsWindow.loadFile(path.join(__dirname, "../renderer/results.html"));
  }

  resultsWindow.on("closed", () => {
    resultsWindow = null;
  });
}

async function showOverlay(): Promise<void> {
  // Hide old result window if still open
  resultsWindow?.hide();

  if (!overlayWindow) {
    createOverlayWindow();
  }

  let screenshotDataUrl: string | null = null;

  try {
    screenshotDataUrl = await captureScreen();
  } catch (err) {
    console.error("Screen capture failed:", err);
  }

  overlayWindow!.show();
  overlayWindow!.focus();

  overlayWindow!.webContents.send("overlay-open", screenshotDataUrl);
}

async function analyzeWithGemini(imageDataUrl: string): Promise<string> {
  const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");

  const response = await genai.models.generateContent({
    model: "models/gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Data,
            },
          },
          {
            text: `Analyze this screenshot region and provide a helpful, concise response.

Guidelines:
- If it contains TEXT: Extract and reproduce it clearly
- If it contains CODE: Explain what it does, identify the language, note any issues
- If it contains an ERROR: Identify the cause and suggest a fix
- If it contains a PRODUCT or UI: Describe what you see
- If it contains DATA (charts/tables): Summarize the key insights
- If it contains MATH: Solve or explain it

Keep your response focused and practical. Use markdown formatting where it helps readability.`,
          },
        ],
      },
    ],
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

// IPC handlers

ipcMain.handle("overlay-close", () => {
  overlayWindow?.hide();
});

ipcMain.handle(
  "capture-and-analyze",
  async (_event, croppedImageDataUrl: string) => {
    try {
      // Hide overlay immediately
      overlayWindow?.hide();

      // Create results window if needed
      if (!resultsWindow) {
        createResultsWindow();
      }

      // Show loading state
      resultsWindow!.webContents.send("analysis-loading");

      // Run Gemini first
      const resultText = await analyzeWithGemini(croppedImageDataUrl);
      console.log("SHOWING RESULTS WINDOW")

      // Only show results window when response is ready
      resultsWindow!.show();
      resultsWindow!.focus();

      resultsWindow!.webContents.send("analysis-result", {
        text: resultText,
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.error("Gemini analysis failed:", message);

      if (!resultsWindow) {
        createResultsWindow();
      }

      resultsWindow!.show();

      resultsWindow!.webContents.send("analysis-error", message);
    }
  }
);

ipcMain.handle("results-close", () => {
  resultsWindow?.hide();
});

// App lifecycle

app.whenReady().then(async () => {
  createOverlayWindow();
  createResultsWindow();

  const registered = globalShortcut.register("Alt+Space", async () => {
    await showOverlay();
  });

  if (!registered) {
    console.error("Failed to register Alt+Space");
  } else {
    console.log("Alt+Space registered — Circle Search AI running");
  }
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// app.whenReady().then(async () => {
//   const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

//   const models = await genai.models.list()
//   console.log('AVAILABLE MODELS:', models)

//   createOverlayWindow()
//   createResultsWindow()
// })
