const { BrowserWindow, app, ipcMain, dialog, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;
let endTime = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 850,
    minHeight: 600,
    title: "Athena Exam Proctor",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL("http://localhost:5173/");

  win.on("closed", () => {
    win = null;
  });
}

// Full screen toggle
ipcMain.handle("full-screen", () => {
  if (win) {
    win.setFullScreen(true);
    return true;
  }
  return false;
});

// Start exam countdown timer (default 60 minutes)
ipcMain.handle("start-test", (_, durationMinutes = 60) => {
  endTime = Date.now() + durationMinutes * 60 * 1000;
  return endTime;
});

// Get remaining time in milliseconds
ipcMain.handle("get-time", () => {
  if (!endTime) return 0;
  return Math.max(0, endTime - Date.now());
});

// Show rules dialog (returns 1 for Accept, 0 for Cancel)
ipcMain.handle("show-rules", async () => {
  if (!win) return 0;
  const res = await dialog.showMessageBox(win, {
    type: "info",
    title: "Exam Rules & Instructions",
    message: "Please follow these exam instructions:",
    detail:
      "1. Do not switch tabs or leave this application.\n" +
      "2. Periodic camera snapshots will be recorded for proctoring.\n" +
      "3. The timer begins immediately upon acceptance.\n" +
      "4. Any unfair means or cheating will result in 0 marks.",
    buttons: ["Cancel", "Accept & Begin"],
    defaultId: 1,
    cancelId: 0,
  });

  return res.response;
});

// Save camera proctoring photo
ipcMain.handle("save-photo", (_, arrayBuffer) => {
  try {
    const feedDir = path.join(__dirname, "cameraFeed");
    if (!fs.existsSync(feedDir)) {
      fs.mkdirSync(feedDir, { recursive: true });
    }
    const filePath = path.join(feedDir, `${Date.now()}.jpeg`);
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    console.error("Failed to save camera photo:", err);
    return { success: false, error: err.message };
  }
});

// Desktop capturer for screen proctoring
ipcMain.handle("get-desktop-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 160, height: 100 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  } catch (err) {
    console.error("Failed to get desktop sources:", err);
    return [];
  }
});

// Start exam API proxy
ipcMain.handle("start-exam", async (_, userId, name) => {
  try {
    const response = await fetch("http://localhost:3000/exam/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name }),
    });
    return await response.json();
  } catch (err) {
    console.error("Failed to proxy start-exam:", err);
    throw err;
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
