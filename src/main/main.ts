import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  desktopCapturer,
  Tray,
  Menu,
  dialog,
  nativeImage,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Single-instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── API key guard ──────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith("YOUR_")) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      "Circle Search AI — Missing API Key",
      "GEMINI_API_KEY is not set.\n\nAdd it to your environment variables and relaunch."
    );
    app.quit();
  });
} else {
  // ── Module-level Gemini client (one instance, not per-request) ────────────
  const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  let overlayWindow:  BrowserWindow | null = null;
  let resultsWindow:  BrowserWindow | null = null;
  let tray:           Tray          | null = null;

  // Prevents concurrent analyses and double hotkey fires
  let isAnalyzing = false;

  // Session state — shared across all IPC handlers
  let sessionImage  : { mimeType: string; data: string } | null = null;
  let sessionHistory: { role: "user" | "assistant"; text: string }[] = [];

  const isDev = process.env.NODE_ENV === "development";

  // ── Helpers ────────────────────────────────────────────────────────────────

  function isAlive(win: BrowserWindow | null): win is BrowserWindow {
    return win !== null && !win.isDestroyed();
  }

  function getPreloadPath(): string {
    return path.join(__dirname, "../preload/preload.js");
  }

  async function captureScreen(): Promise<string> {
    const { width, height } = screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
    });
    if (!sources[0]) throw new Error("No screen source found");
    // JPEG is ~5-10× smaller than PNG for IPC transfer
    const jpeg = sources[0].thumbnail.toJPEG(82);
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  }

  // Wait for a window to finish loading before sending IPC
  function waitForLoad(win: BrowserWindow): Promise<void> {
    return new Promise((resolve) => {
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", resolve);
      } else {
        resolve();
      }
    });
  }

  // ── Window factories ───────────────────────────────────────────────────────

  function createOverlayWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().size;
    overlayWindow = new BrowserWindow({
      width, height, x: 0, y: 0,
      show: false, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false,
      focusable: true, hasShadow: false,
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
    overlayWindow.on("closed", () => { overlayWindow = null; });
  }

  function createResultsWindow(): void {
    resultsWindow = new BrowserWindow({
      width: 520, height: 600,
      show: false, frame: false,
      transparent: false, alwaysOnTop: true,
      skipTaskbar: false, resizable: true, center: true,
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
    resultsWindow.on("closed", () => { resultsWindow = null; });
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  function createTray(): void {
    // 16×16 white circle icon as base64 PNG
    const iconPng = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAeklEQVQ4T2NkYGD4z8DAAJ" +
      "AYAAAAAgAB/wH9gAAAABJRU5ErkJggg=="
    );
    tray = new Tray(iconPng);
    tray.setToolTip("Circle Search AI — Alt+Space to activate");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Circle Search AI", enabled: false },
      { type: "separator" },
      { label: "Activate  (Alt+Space)", click: () => showOverlay() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("click", () => showOverlay());
  }

  // ── Show overlay ───────────────────────────────────────────────────────────

  async function showOverlay(): Promise<void> {
    if (isAnalyzing) return;                              // busy guard
    if (isAlive(resultsWindow)) resultsWindow.hide();
    if (!isAlive(overlayWindow)) createOverlayWindow();

    // Show immediately with activation animation — no waiting for screenshot
    await waitForLoad(overlayWindow!);
    overlayWindow!.show();
    overlayWindow!.focus();
    overlayWindow!.webContents.send("overlay-open");     // triggers hex animation

    // Capture in parallel, send bg when ready
    try {
      const dataUrl = await captureScreen();
      if (isAlive(overlayWindow)) {
        overlayWindow.webContents.send("overlay-bg-ready", dataUrl);
      }
    } catch (err) {
      console.error("Screen capture failed:", err);
    }
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────

  const SYSTEM_PROMPT = `You are Circle Search AI. The user drew a freeform circle on their screen to highlight something they want to know about.

The image shows their full screen with the circled region brightened and everything outside it darkened. A purple/white stroke marks the exact boundary they drew.

Focus your response entirely on what is inside or highlighted by the circle. Be concise and practical:
- TEXT or CODE: extract it verbatim, then explain or fix it
- ERROR / STACK TRACE: diagnose the problem and suggest a fix
- UI / PRODUCT: identify what it is and describe it briefly
- CHART / DATA: call out the key numbers or trend
- MATH / FORMULA: solve or explain step by step
- IMAGE / DIAGRAM: describe what you see and any key details

Respond in markdown. Lead with the most useful insight — do not describe the circle or the screenshot itself.`;

  function parsePayload(raw: string): { mimeType: string; data: string; question: string } {
    let imageDataUrl: string;
    let question = "";
    if (raw.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as { image: string; question?: string };
        imageDataUrl = parsed.image;
        question     = parsed.question?.trim() ?? "";
      } catch { throw new Error("Failed to parse payload JSON"); }
    } else {
      imageDataUrl = raw;
    }
    const m = imageDataUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/s);
    if (!m) throw new Error("Invalid image data URL");
    return { mimeType: m[1], data: m[2], question };
  }

  async function analyzeWithGeminiStream(raw: string, win: BrowserWindow): Promise<void> {
    const { mimeType, data, question } = parsePayload(raw);
    sessionImage   = { mimeType, data };
    sessionHistory = [];

    const userText = question
      ? `${SYSTEM_PROMPT}\n\nThe user also asked: "${question}"\n\nAnswer their question specifically, using the circled content as context.`
      : SYSTEM_PROMPT;

    const stream = await genai.models.generateContentStream({
      model: "models/gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data } }, { text: userText }] }],
    });

    let fullText = "";
    for await (const chunk of stream) {
      const piece = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (piece && isAlive(win)) {
        fullText += piece;
        win.webContents.send("analysis-chunk", piece);
      }
    }
    if (!fullText) throw new Error("Gemini returned an empty response");
    sessionHistory.push({ role: "user",      text: question || "(initial analysis)" });
    sessionHistory.push({ role: "assistant",  text: fullText });
    if (isAlive(win)) win.webContents.send("analysis-done", { timestamp: Date.now() });
  }

  async function followUpStream(question: string, win: BrowserWindow): Promise<void> {
    if (!sessionImage) throw new Error("No active session");

    const contents: object[] = [
      { role: "user",  parts: [{ inlineData: sessionImage }, { text: SYSTEM_PROMPT }] },
      { role: "model", parts: [{ text: sessionHistory[1]?.text ?? "" }] },
    ];
    for (let i = 2; i < sessionHistory.length; i++) {
      const t = sessionHistory[i];
      contents.push({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] });
    }
    contents.push({ role: "user", parts: [{ text: question }] });

    const stream = await genai.models.generateContentStream({
      model: "models/gemini-2.5-flash",
      contents,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const piece = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (piece && isAlive(win)) {
        fullText += piece;
        win.webContents.send("followup-chunk", piece);
      }
    }
    if (!fullText) throw new Error("Gemini returned an empty response");
    sessionHistory.push({ role: "user",      text: question });
    sessionHistory.push({ role: "assistant",  text: fullText });
    if (isAlive(win)) win.webContents.send("followup-done", { question });
  }

  // ── IPC handlers ───────────────────────────────────────────────────────────

  ipcMain.handle("overlay-close", () => {
    if (isAlive(overlayWindow)) overlayWindow.hide();
  });

  ipcMain.handle("capture-and-analyze", async (_e, raw: string) => {
    if (isAnalyzing) return;
    isAnalyzing = true;
    try {
      if (isAlive(overlayWindow)) overlayWindow.hide();
      if (!isAlive(resultsWindow)) { createResultsWindow(); await waitForLoad(resultsWindow!); }
      resultsWindow!.show();
      resultsWindow!.focus();
      resultsWindow!.webContents.send("analysis-loading");
      await analyzeWithGeminiStream(raw, resultsWindow!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Gemini analysis failed:", message);
      if (!isAlive(resultsWindow)) { createResultsWindow(); await waitForLoad(resultsWindow!); resultsWindow!.show(); }
      resultsWindow!.webContents.send("analysis-error", message);
    } finally {
      isAnalyzing = false;
    }
  });

  ipcMain.handle("results-close", () => {
    if (isAlive(resultsWindow)) resultsWindow.hide();
    if (isAlive(overlayWindow)) {
      overlayWindow.hide();
      overlayWindow.webContents.send("overlay-reset");
    }
    sessionImage   = null;
    sessionHistory = [];
  });

  ipcMain.handle("follow-up-question", async (_e, question: string) => {
    if (isAnalyzing) return;
    isAnalyzing = true;
    try {
      if (isAlive(resultsWindow)) resultsWindow.webContents.send("followup-loading", question);
      await followUpStream(question, resultsWindow!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Follow-up failed:", message);
      if (isAlive(resultsWindow)) resultsWindow.webContents.send("followup-error", message);
    } finally {
      isAnalyzing = false;
    }
  });

  // ── App lifecycle ──────────────────────────────────────────────────────────

  app.whenReady().then(() => {
    createOverlayWindow();
    createResultsWindow();
    createTray();

    const ok = globalShortcut.register("Alt+Space", () => showOverlay());
    console.log(ok
      ? "Circle Search AI ready — Alt+Space to activate"
      : "ERROR: failed to register Alt+Space"
    );
  });

  // Bring up overlay when a second instance is launched
  app.on("second-instance", () => showOverlay());

  // Keep alive in tray when all windows close (Windows/Linux)
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") app.quit();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
  });
}