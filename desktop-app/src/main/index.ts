import { app, BrowserWindow, shell, nativeImage } from "electron";
import { join } from "path";
import { registerIpcHandlers } from "./ipc";
import { getDb } from "./db/database";

/**
 * Main process: app lifecycle + window. Security baseline:
 * contextIsolation on, sandbox on, nodeIntegration off. The renderer reaches
 * Node exclusively via the IPC channels exposed in the preload.
 */
function createWindow(): void {
  const iconPath = join(__dirname, "../../resources/icon.png");
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
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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
