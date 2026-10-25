const { BrowserWindow, app, ipcMain, dialog, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

let win = null;
let endTime = null;

// Embedded questions fallback for standalone .dmg / .app runs
const DEFAULT_QUESTIONS = [
  {
    id: 1,
    question: "Which Electron process is responsible for creating BrowserWindow?",
    options: ["Renderer Process", "Main Process", "React Process", "Preload Process"],
    correctAnswer: 1,
  },
  {
    id: 2,
    question: "Which Electron API is commonly used in the renderer to invoke a handler in the main process?",
    options: ["ipcRenderer.invoke", "BrowserWindow.loadURL", "fs.writeFileSync", "dialog.showMessageBox"],
    correctAnswer: 0,
  },
  {
    id: 3,
    question: "Why is a preload script commonly used in Electron?",
    options: [
      "To style the React application",
      "To expose controlled APIs safely to the renderer",
      "To create the Express server",
      "To replace the main process",
    ],
    correctAnswer: 1,
  },
  {
    id: 4,
    question: "Which HTTP method is normally used to fetch exam questions?",
    options: ["GET", "DELETE", "PATCH", "CONNECT"],
    correctAnswer: 0,
  },
  {
    id: 5,
    question: "What does fs.writeFileSync() do?",
    options: [
      "Reads camera frames",
      "Writes data to a file and waits until it finishes",
      "Starts the Electron renderer",
      "Sends an IPC event",
    ],
    correctAnswer: 1,
  },
];

const fallbackSessions = {};

// Fallback internal server on port 3000 if external backend is not running
function startFallbackServerIfNeeded() {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch (_) {}

      if (req.url === "/exam/mcq" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            DEFAULT_QUESTIONS.map((q) => ({
              id: q.id,
              question: q.question,
              options: q.options,
            }))
          )
        );
      } else if (req.url === "/exam/start" && req.method === "POST") {
        const sessionId = `session-${Date.now()}`;
        fallbackSessions[sessionId] = {
          sessionId,
          userId: data.userId,
          name: data.name,
          attempted: 0,
          correct: 0,
          wrong: 0,
          answers: [],
        };
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Exam session started", sessionId }));
      } else if (req.url === "/exam/answer" && req.method === "POST") {
        const { sessionId, questionId, selectedAnswer } = data;
        const q = DEFAULT_QUESTIONS.find((item) => item.id === Number(questionId));
        const sess = fallbackSessions[sessionId] || {
          attempted: 0,
          correct: 0,
          wrong: 0,
          answers: [],
        };
        const isCorrect = q && Number(selectedAnswer) === q.correctAnswer;
        sess.attempted += 1;
        if (isCorrect) sess.correct += 1;
        else sess.wrong += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: "Answer saved",
            isCorrect,
            attempted: sess.attempted,
            correct: sess.correct,
            wrong: sess.wrong,
          })
        );
      } else if (req.url === "/exam/submit" && req.method === "POST") {
        const { sessionId } = data;
        const sess = fallbackSessions[sessionId] || {
          attempted: 0,
          correct: 0,
          wrong: 0,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: "Exam submitted successfully",
            result: {
              attempted: sess.attempted,
              correct: sess.correct,
              wrong: sess.wrong,
            },
          })
        );
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Not found" }));
      }
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log("External backend server is already running on port 3000.");
    }
  });

  server.listen(3000, () => {
    console.log("Internal Athena exam server running on port 3000.");
  });
}

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

  const distPath = path.join(__dirname, "../dist/index.html");

  if (!app.isPackaged && process.env.NODE_ENV !== "production") {
    win.loadURL("http://localhost:5173/").catch(() => {
      win.loadFile(distPath);
    });
  } else {
    win.loadFile(distPath);
  }

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
    const baseDir = app.isPackaged
      ? path.join(app.getPath("userData"), "cameraFeed")
      : path.join(__dirname, "cameraFeed");

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const filePath = path.join(baseDir, `${Date.now()}.jpeg`);
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
  startFallbackServerIfNeeded();
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
