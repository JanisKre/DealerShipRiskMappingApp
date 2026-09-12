import { app, BrowserWindow, shell, nativeImage } from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { registerIpcHandlers } from "./ipc";
import { getDb } from "./db/database";

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isRendererUrl(
  rawUrl: string,
  rendererUrl: string | undefined,
  rendererFilePath: string,
): boolean {
  try {
    if (rendererUrl) return new URL(rawUrl).origin === new URL(rendererUrl).origin;
    return new URL(rawUrl).toString() === pathToFileURL(rendererFilePath).toString();
  } catch {
    return false;
  }
}

/**
 * Main process: app lifecycle + window. Security baseline:
 * contextIsolation on, sandbox on, nodeIntegration off. The renderer reaches
 * Node exclusively via the IPC channels exposed in the preload.
 */
function createWindow(): void {
  const iconPath = join(__dirname, "../../resources/icon.png");
  const rendererFilePath = join(__dirname, "../renderer/index.html");
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "Dealership Risk Mapping",
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const rendererUrl = !app.isPackaged
    ? process.env["ELECTRON_RENDERER_URL"]
    : undefined;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url, rendererUrl, rendererFilePath)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(rendererFilePath);
  }
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("io.github.janiskre.dealership-risk-mapping");
  }

  app.on("browser-window-created", (_, window) => {
    if (!app.isPackaged) {
      window.webContents.on("before-input-event", (_, input) => {
        if (input.key === "F12") window.webContents.toggleDevTools();
        if (input.key === "F5") window.webContents.reload();
      });
    }
  });

  getDb(); // DB + Tabellen initialisieren
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
