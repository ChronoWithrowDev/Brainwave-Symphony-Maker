const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const http = require("node:http");

let serverProcess = null;
let mainWindow = null;
let quitting = false;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 32153;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) throw new Error(`The local app server exited (code ${serverProcess.exitCode}).`);
    if (await requestHealth(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local app server did not become ready within 90 seconds.");
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#110E0C",
    title: "Brainwave Symphony Generator",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`).catch(async (error) => {
    await dialog.showMessageBox({ type: "error", title: "Brainwave Symphony Generator", message: "Could not open the desktop app.", detail: String(error) });
  });
}

app.whenReady().then(async () => {
  try {
    const port = await availablePort();
    const serverPath = path.join(process.resourcesPath, "app-server", "server.js");
    const dataDir = path.join(app.getPath("userData"), "data");
    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: path.join(process.resourcesPath, "app-server"),
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        BRAINWAVE_DATA_DIR: dataDir,
      },
    });
    serverProcess.once("error", (error) => console.error("Local app server spawn failed:", error));
    await waitForServer(port);
    createWindow(port);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Brainwave Symphony Generator could not start",
      message: "The local app server failed to start.",
      detail: `${error instanceof Error ? error.message : String(error)}\n\nTry reinstalling the app. Your saved symphonies are stored in this app's user-data folder.`,
    });
    app.quit();
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  if (!mainWindow && !quitting) app.quit();
});
