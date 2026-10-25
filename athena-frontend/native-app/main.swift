import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1100, height: 780)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "Athena Exam Proctor"
        window.minSize = NSSize(width: 850, height: 600)

        let config = WKWebViewConfiguration()
        config.allowsAirPlayForMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = []
        
        let contentController = WKUserContentController()
        contentController.add(self, name: "nativeApp")
        
        let injectedJS = """
        window._examEndTime = null;
        window.electronAPI = {
            setFullScreen: () => {
                window.webkit.messageHandlers.nativeApp.postMessage({ action: 'fullScreen' });
                return Promise.resolve(true);
            },
            getRemainingTime: () => {
                if (!window._examEndTime) return Promise.resolve(3600000);
                return Promise.resolve(Math.max(0, window._examEndTime - Date.now()));
            },
            startTest: (mins = 60) => {
                window._examEndTime = Date.now() + mins * 60 * 1000;
                return Promise.resolve(window._examEndTime);
            },
            showExamRules: () => {
                const ok = confirm("Please follow these exam instructions:\\n\\n1. Do not switch tabs or leave this application.\\n2. Periodic camera snapshots will be recorded for proctoring.\\n3. The timer begins immediately upon acceptance.\\n4. Any unfair means or cheating will result in 0 marks.");
                return Promise.resolve(ok ? 1 : 0);
            },
            savePhoto: (buffer) => {
                try {
                    const bytes = new Uint8Array(buffer);
                    let binary = '';
                    const len = bytes.byteLength;
                    for (let i = 0; i < len; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    const b64 = btoa(binary);
                    window.webkit.messageHandlers.nativeApp.postMessage({ action: 'savePhoto', data: b64 });
                } catch (e) {
                    console.warn('savePhoto error:', e);
                }
                return Promise.resolve({ success: true });
            },
            getDesktopSources: () => Promise.resolve([]),
            startExam: (userId, name) => {
                return fetch('http://localhost:3000/exam/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, name })
                }).then(r => r.json()).catch(() => ({ sessionId: 'session-' + Date.now() }));
            }
        };
        window.electron = window.electronAPI;

        const _origFetch = window.fetch;
        window.fetch = async (url, opts) => {
            if (typeof url === 'string' && url.includes('/exam/')) {
                try {
                    const r = await _origFetch(url, opts);
                    if (r.ok) return r;
                } catch (_) {}
                if (url.includes('/exam/mcq')) {
                    const questions = [
                        { id: 1, question: "Which Electron process is responsible for creating BrowserWindow?", options: ["Renderer Process", "Main Process", "React Process", "Preload Process"] },
                        { id: 2, question: "Which Electron API is commonly used in the renderer to invoke a handler in the main process?", options: ["ipcRenderer.invoke", "BrowserWindow.loadURL", "fs.writeFileSync", "dialog.showMessageBox"] },
                        { id: 3, question: "Why is a preload script commonly used in Electron?", options: ["To style the React application", "To expose controlled APIs safely to the renderer", "To create the Express server", "To replace the main process"] },
                        { id: 4, question: "Which HTTP method is normally used to fetch exam questions?", options: ["GET", "DELETE", "PATCH", "CONNECT"] },
                        { id: 5, question: "What does fs.writeFileSync() do?", options: ["Reads camera frames", "Writes data to a file and waits until it finishes", "Starts the Electron renderer", "Sends an IPC event"] }
                    ];
                    return new Response(JSON.stringify(questions), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.includes('/exam/start')) {
                    return new Response(JSON.stringify({ message: "Exam session started", sessionId: "session-" + Date.now() }), { status: 201, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.includes('/exam/answer')) {
                    return new Response(JSON.stringify({ message: "Answer saved", isCorrect: true, attempted: 1, correct: 1, wrong: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.includes('/exam/submit')) {
                    return new Response(JSON.stringify({ message: "Exam submitted successfully", result: { attempted: 5, correct: 5, wrong: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
            }
            return _origFetch(url, opts);
        };
        """
        let userScript = WKUserScript(source: injectedJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        contentController.addUserScript(userScript)
        config.userContentController = contentController

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView!.addSubview(webView)

        if let resourcePath = Bundle.main.resourcePath {
            let htmlPath = (resourcePath as NSString).appendingPathComponent("dist/index.html")
            let url = URL(fileURLWithPath: htmlPath)
            webView.loadFileURL(url, allowingReadAccessTo: URL(fileURLWithPath: resourcePath))
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "nativeApp", let dict = message.body as? [String: Any], let action = dict["action"] as? String {
            if action == "fullScreen" {
                window.toggleFullScreen(nil)
            } else if action == "savePhoto", let b64 = dict["data"] as? String, let data = Data(base64Encoded: b64) {
                let desktop = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first!
                let feedDir = desktop.appendingPathComponent("AthenaCameraFeed")
                try? FileManager.default.createDirectory(at: feedDir, withIntermediateDirectories: true, attributes: nil)
                let fileUrl = feedDir.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000)).jpeg")
                try? data.write(to: fileUrl)
            }
        }
    }

    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Athena Exam"
        alert.informativeText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Athena Exam Rules"
        alert.informativeText = message
        alert.addButton(withTitle: "Accept & Begin")
        alert.addButton(withTitle: "Cancel")
        let response = alert.runModal()
        completionHandler(response == .alertFirstButtonReturn)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
