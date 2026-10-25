import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = 'http://localhost:3000';

function App() {
  const webcamVideoRef = useRef(null);
  const screenVideoRef = useRef(null);

  // Student details
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');

  // Hardware & permissions
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [screenSources, setScreenSources] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastSnapshotTime, setLastSnapshotTime] = useState('');

  // Exam state
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [timeLeft, setTimeLeft] = useState(60 * 60 * 1000); // 60 mins default
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Helper HTTP request
  const request = useCallback(async (url, options) => {
    const response = await fetch(`${API_URL}${url}`, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Request failed');
    return payload;
  }, []);

  // Configure Camera
  const enableCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setCameraStream(stream);
      setCameraReady(true);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError(`Camera access denied: ${err.message}`);
    }
  };

  // Switch to Fullscreen
  const enableFullscreen = async () => {
    try {
      if (window.electronAPI?.setFullScreen) {
        await window.electronAPI.setFullScreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch (err) {
      console.warn('Fullscreen error:', err);
    }
  };

  // Load Screen Sources for Desktop Capturer
  const loadScreenSources = async () => {
    setError('');
    try {
      if (!window.electronAPI?.getDesktopSources) {
        throw new Error('Screen capture source picker is available in the Electron desktop app.');
      }
      const sources = await window.electronAPI.getDesktopSources();
      setScreenSources(sources);
    } catch (err) {
      setError(err.message);
    }
  };

  // Start Screen Capture
  const startScreenCapture = async (sourceId) => {
    try {
      screenStream?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        },
      });
      setScreenStream(stream);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError(`Screen capture error: ${err.message}`);
    }
  };

  const stopScreenCapture = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
  };

  // Periodic Webcam Snapshot (every 5 seconds saved to Electron cameraFeed)
  const takeSnapshot = useCallback(async () => {
    if (!cameraStream) return;
    try {
      const track = cameraStream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') return;

      let buffer = null;

      if ('ImageCapture' in window) {
        try {
          const imageCapture = new window.ImageCapture(track);
          const blob = await imageCapture.takePhoto();
          buffer = await blob.arrayBuffer();
        } catch {
          // Fallback to canvas below
        }
      }

      if (!buffer && webcamVideoRef.current && webcamVideoRef.current.videoWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = webcamVideoRef.current.videoWidth;
        canvas.height = webcamVideoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(webcamVideoRef.current, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (blob) {
          buffer = await blob.arrayBuffer();
        }
      }

      if (buffer && window.electronAPI?.savePhoto) {
        await window.electronAPI.savePhoto(buffer);
        setLastSnapshotTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.warn('Snapshot error:', err);
    }
  }, [cameraStream]);

  // Proctoring Loop (snapshots every 5 seconds)
  useEffect(() => {
    if (!session || result) return;
    const initialTimer = setTimeout(() => {
      takeSnapshot();
    }, 500);
    const interval = setInterval(takeSnapshot, 5000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [session, result, takeSnapshot]);

  // Auto-submit when time expires
  const autoSubmit = useCallback(async () => {
    if (!session || result) return;
    try {
      const finalResult = await request('/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session }),
      });
      setResult(finalResult);
    } catch (err) {
      console.error('Auto-submit failed:', err);
    }
  }, [session, result, request]);

  // Timer Countdown Loop
  useEffect(() => {
    if (!session || result) return;

    const interval = setInterval(async () => {
      if (window.electronAPI?.getRemainingTime) {
        const ms = await window.electronAPI.getRemainingTime();
        setTimeLeft(ms);
        if (ms <= 0) {
          clearInterval(interval);
          autoSubmit();
        }
      } else {
        setTimeLeft((prev) => {
          const next = Math.max(0, prev - 1000);
          if (next <= 0) autoSubmit();
          return next;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, result, autoSubmit]);

  // Sync webcam element whenever stream changes or view re-renders
  useEffect(() => {
    if (webcamVideoRef.current && cameraStream) {
      webcamVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, session]);

  // Clean up all tracks on unmount
  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
      screenStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraStream, screenStream]);

  // Format Time left
  const formatTime = (ms) => {
    if (!ms || ms <= 0) return '00:00';
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start Exam Flow
  const handleStartExam = async (e) => {
    if (e) e.preventDefault();
    if (!name.trim() || !userId.trim()) {
      setError('Please enter your full name and student ID.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // 1. Show Exam Rules dialog in Electron
      if (window.electronAPI?.showExamRules) {
        const accepted = await window.electronAPI.showExamRules();
        if (accepted !== 1) {
          setLoading(false);
          return; // Cancelled by student
        }
      }

      // 2. Set Full Screen
      await enableFullscreen();

      // 3. Ensure camera is active for proctoring
      if (!cameraStream) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
          setCameraStream(stream);
          setCameraReady(true);
          if (webcamVideoRef.current) webcamVideoRef.current.srcObject = stream;
        } catch {
          console.warn('Webcam permission not pre-granted.');
        }
      }

      // 4. Start Electron timer (60 minutes)
      if (window.electronAPI?.startTest) {
        await window.electronAPI.startTest(60);
      }

      // 5. Create backend session
      const started = window.electronAPI?.startExam
        ? await window.electronAPI.startExam(userId.trim(), name.trim())
        : await request('/exam/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId.trim(), name: name.trim() }),
          });

      if (!started || !started.sessionId) {
        throw new Error(started?.message || 'Failed to initialize session');
      }

      setSession(started.sessionId);

      // 6. Fetch questions
      const questionList = await request('/exam/mcq');
      setQuestions(questionList);
      setTimeLeft(60 * 60 * 1000);
    } catch (err) {
      setError(err.message || 'Error starting exam');
    } finally {
      setLoading(false);
    }
  };

  // Submit single answer & proceed
  const handleAnswerSubmit = async () => {
    if (selectedAnswer === null) return;
    setLoading(true);
    setError('');

    try {
      const q = questions[currentIndex];
      await request('/exam/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session,
          questionId: q.id,
          selectedAnswer,
        }),
      });

      if (currentIndex === questions.length - 1) {
        // Final question answered, submit exam
        const finalResult = await request('/exam/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session }),
        });
        setResult(finalResult);
        cameraStream?.getTracks().forEach((t) => t.stop());
        screenStream?.getTracks().forEach((t) => t.stop());
      } else {
        setCurrentIndex((prev) => prev + 1);
        setSelectedAnswer(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to submit answer');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // VIEW 1: RESULTS VIEW
  // ==========================================
  if (result) {
    const totalQ = questions.length || 5;
    const correct = result.result?.correct ?? 0;
    const attempted = result.result?.attempted ?? 0;
    const wrong = result.result?.wrong ?? 0;
    const percentage = Math.round((correct / totalQ) * 100);

    return (
      <main className="app-shell">
        <div className="result-card">
          <div className="result-badge">Assessment Completed</div>
          <h1 className="result-title">Great Job, {name}!</h1>
          <p className="result-subtitle">Your responses have been securely recorded and evaluated.</p>

          <div className="score-hero">
            <div className="score-number">{correct} / {totalQ}</div>
            <div className="score-percentage">{percentage}% Correct</div>
          </div>

          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-label">Total Questions</span>
              <span className="stat-value">{totalQ}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Attempted</span>
              <span className="stat-value">{attempted}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Correct</span>
              <span className="stat-value text-green">{correct}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Incorrect</span>
              <span className="stat-value text-amber">{wrong}</span>
            </div>
          </div>

          <div className="result-footer">
            <span className="student-tag">Student ID: {userId}</span>
            <button className="primary-btn" onClick={() => window.location.reload()}>
              Take Another Exam
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // VIEW 2: SETUP & VERIFICATION VIEW
  // ==========================================
  if (!session) {
    return (
      <main className="app-shell">
        <div className="setup-container">
          <header className="setup-header">
            <div className="brand-pill">Athena Secure Assessment</div>
            <h1>System Verification & Onboarding</h1>
            <p>Please configure your proctoring permissions and confirm your details before starting.</p>
          </header>

          <div className="setup-grid">
            {/* Student Info Card */}
            <div className="card form-card">
              <h2 className="card-title">Candidate Details</h2>
              <p className="card-desc">Enter your official registration credentials.</p>

              <form onSubmit={handleStartExam} id="startForm">
                <div className="form-group">
                  <label htmlFor="fullname">Full Name</label>
                  <input
                    id="fullname"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aditya Kumar"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="studentid">Student ID / Roll No</label>
                  <input
                    id="studentid"
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="e.g. STU-2026-09"
                    required
                  />
                </div>
              </form>

              {error && <div className="alert-box" role="alert">{error}</div>}
            </div>

            {/* Proctoring Verification Card */}
            <div className="card permissions-card">
              <h2 className="card-title">Proctoring Checklist</h2>
              <p className="card-desc">Required by exam integrity guidelines.</p>

              <div className="permission-row">
                <div className="perm-info">
                  <div className="perm-title">
                    <span className="perm-dot" style={{ background: cameraReady ? '#10b981' : '#f59e0b' }} />
                    Camera Access
                  </div>
                  <p className="perm-desc">Live proctoring snapshots will be taken every 5 seconds.</p>
                </div>
                <button
                  type="button"
                  className={cameraReady ? 'status-btn ready' : 'action-btn'}
                  onClick={enableCamera}
                >
                  {cameraReady ? '✓ Camera Active' : 'Enable Camera'}
                </button>
              </div>

              {/* Webcam Preview */}
              <div className="camera-preview-container">
                <video
                  ref={webcamVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`camera-feed-box ${cameraReady ? 'active' : 'placeholder'}`}
                />
                {!cameraReady && (
                  <div className="camera-placeholder-overlay">
                    <span>Camera is not connected</span>
                  </div>
                )}
              </div>

              <div className="permission-row">
                <div className="perm-info">
                  <div className="perm-title">
                    <span className="perm-dot" style={{ background: isFullscreen ? '#10b981' : '#64748b' }} />
                    Fullscreen Lockdown
                  </div>
                  <p className="perm-desc">The exam requires an uninterrupted, full-screen environment.</p>
                </div>
                <button
                  type="button"
                  className={isFullscreen ? 'status-btn ready' : 'action-btn'}
                  onClick={enableFullscreen}
                >
                  {isFullscreen ? '✓ Fullscreen On' : 'Enter Fullscreen'}
                </button>
              </div>

              {/* Optional Screen Proctoring */}
              <div className="permission-row">
                <div className="perm-info">
                  <div className="perm-title">
                    <span className="perm-dot" style={{ background: screenStream ? '#10b981' : '#64748b' }} />
                    Screen Sharing (Optional)
                  </div>
                  <p className="perm-desc">Select screen or window for enhanced desktop verification.</p>
                </div>
                <button
                  type="button"
                  className={screenStream ? 'status-btn ready' : 'action-btn secondary'}
                  onClick={loadScreenSources}
                >
                  {screenStream ? '✓ Screen Active' : 'Choose Screen'}
                </button>
              </div>

              {screenSources.length > 0 && !screenStream && (
                <div className="screen-sources-drawer">
                  <div className="drawer-title">Available Display Sources:</div>
                  <div className="source-picker-list">
                    {screenSources.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        className="source-card"
                        onClick={() => startScreenCapture(source.id)}
                      >
                        <img src={source.thumbnail} alt="" className="source-thumb" />
                        <span className="source-name">{source.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="setup-actions">
            <button
              type="submit"
              form="startForm"
              disabled={loading || !name.trim() || !userId.trim()}
              className="primary-btn start-exam-btn"
            >
              {loading ? 'Starting Exam...' : 'Confirm Rules & Begin Assessment →'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // VIEW 3: ACTIVE EXAM VIEW
  // ==========================================
  const currentQ = questions[currentIndex] || {};
  const isTimeCritical = timeLeft < 5 * 60 * 1000; // Under 5 minutes

  return (
    <div className="exam-viewport">
      {/* Top Navigation Bar */}
      <header className="exam-navbar">
        <div className="nav-left">
          <div className="nav-badge">Athena Assessment</div>
          <span className="candidate-name">{name}</span>
          <span className="candidate-id">({userId})</span>
        </div>

        <div className="nav-center">
          <div className={`countdown-timer ${isTimeCritical ? 'critical' : ''}`}>
            <span className="timer-icon">⏱</span>
            <span className="timer-digits">{formatTime(timeLeft)}</span>
            <span className="timer-label">Remaining</span>
          </div>
        </div>

        <div className="nav-right">
          <div className="live-status-pill">
            <span className="live-pulse" />
            <span>PROCTORING ACTIVE</span>
          </div>
        </div>
      </header>

      {/* Main Examination Workspace */}
      <div className="exam-container">
        {/* Left: Question Area */}
        <section className="question-workspace">
          <div className="question-header">
            <div className="progress-info">
              <span>Question {currentIndex + 1} of {questions.length}</span>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="question-body">
            <h2 className="question-prompt">{currentQ.question}</h2>

            <div className="options-stack">
              {currentQ.options?.map((option, idx) => {
                const isSelected = selectedAnswer === idx;
                return (
                  <button
                    key={option}
                    type="button"
                    className={`option-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedAnswer(idx)}
                  >
                    <div className="option-indicator">
                      <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                    </div>
                    <span className="option-text">{option}</span>
                  </button>
                );
              })}
            </div>

            {error && <div className="alert-box" role="alert">{error}</div>}
          </div>

          <footer className="question-footer">
            <div className="footer-left">
              <span className="auto-save-note">
                {selectedAnswer !== null ? 'Answer selected • Ready to submit' : 'Select an option to proceed'}
              </span>
            </div>
            <button
              type="button"
              className="primary-btn submit-answer-btn"
              onClick={handleAnswerSubmit}
              disabled={selectedAnswer === null || loading}
            >
              {loading
                ? 'Saving...'
                : currentIndex === questions.length - 1
                ? 'Finalize & Submit Exam'
                : 'Save & Continue →'}
            </button>
          </footer>
        </section>

        {/* Right: Proctoring Sidebar */}
        <aside className="proctor-sidebar">
          {/* Webcam Box */}
          <div className="proctor-widget">
            <div className="widget-header">
              <span className="widget-title">Candidate Camera</span>
              <span className="widget-status active">LIVE</span>
            </div>
            <div className="widget-video-wrap">
              <video
                ref={webcamVideoRef}
                autoPlay
                muted
                playsInline
                className="proctor-video"
              />
              <div className="proctor-overlay-meta">
                <span>{name}</span>
                {lastSnapshotTime && <span>Snap: {lastSnapshotTime}</span>}
              </div>
            </div>
          </div>

          {/* Screen Share Box (if enabled) */}
          {screenStream && (
            <div className="proctor-widget">
              <div className="widget-header">
                <span className="widget-title">Candidate Screen</span>
                <button type="button" className="mini-link-btn" onClick={stopScreenCapture}>
                  Stop
                </button>
              </div>
              <div className="widget-video-wrap">
                <video
                  ref={screenVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="proctor-video"
                />
              </div>
            </div>
          )}

          {/* Guidelines Box */}
          <div className="guidelines-widget">
            <div className="guidelines-title">Security Guidelines</div>
            <ul className="guidelines-list">
              <li>Keep your face centered in the camera frame at all times.</li>
              <li>Camera snapshots are transmitted to <code>electron/cameraFeed</code>.</li>
              <li>Leaving or unfocusing this window will be flagged.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
