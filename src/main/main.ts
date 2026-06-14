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
import dotenv from 'dotenv';

dotenv.config();

// __dirname polyfill — works whether electron-vite outputs CJS or ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

let overlayWindow: BrowserWindow | null = null;
let resultsWindow: BrowserWindow | null = null;
let genai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genai) genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return genai;
}

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
  // JPEG is ~5–10× smaller than PNG — faster IPC to overlay and decode in renderer
  const jpeg = sources[0].thumbnail.toJPEG(82);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
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
      backgroundThrottling: false,
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
      backgroundThrottling: false,
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
  resultsWindow?.hide();

  if (!overlayWindow) {
    createOverlayWindow();
  }

  // Show overlay immediately — don't block on screen capture
  overlayWindow!.show();
  overlayWindow!.focus();
  overlayWindow!.webContents.send("overlay-open", null);

  try {
    const screenshotDataUrl = await captureScreen();
    overlayWindow!.webContents.send("overlay-bg-ready", screenshotDataUrl);
  } catch (err) {
    console.error("Screen capture failed:", err);
  }
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL");
  return { mimeType: match[1], data: match[2] };
}

async function analyzeWithGemini(imageDataUrl: string): Promise<string> {
  const { mimeType, data } = parseImageDataUrl(imageDataUrl);

  const response = await getGenAI().models.generateContent({
    model: "models/gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data } },
          {
            text: "Analyze this screen region. Be concise and practical. For text: extract it. For code/errors: explain and fix. For UI/products/data/math: summarize key points. Use markdown when helpful.",
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 1024,
    },
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
      overlayWindow?.hide();

      if (!resultsWindow) {
        createResultsWindow();
      }

      // Show results immediately so the user sees feedback while Gemini runs
      resultsWindow!.show();
      resultsWindow!.focus();
      resultsWindow!.webContents.send("analysis-loading");

      const resultText = await analyzeWithGemini(croppedImageDataUrl);

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
  getGenAI();
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
