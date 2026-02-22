// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";
import { CalibrationManager } from "./calibration.js";
import { GazeDataManager } from "./gaze-data-manager.js"; // Import
import EasySeeSo from "../seeso/easy-seeso.js";

// [DIAG] Intercept console.error/warn to surface SDK internal errors in our debug panel.
// SDK errors (WASM load failure, license error, etc.) never appear in logI/logW/logE.
// Must be set up BEFORE SDK loads.
const _origConsoleError = console.error.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleLog = console.log.bind(console);

console.error = function (...args) {
  const msg = args.map(a => {
    try { return typeof a === 'object' ? JSON.stringify(a).substring(0, 120) : String(a); }
    catch (_) { return String(a); }
  }).join(' ');
  // Forward to our debug panel (logE defined later - use deferred log if not ready)
  if (typeof logE === 'function') logE('console', msg);
  else setTimeout(() => { if (typeof logE === 'function') logE('console', msg); }, 100);
  _origConsoleError(...args);
};

console.warn = function (...args) {
  const msg = args.map(a => {
    try { return typeof a === 'object' ? JSON.stringify(a).substring(0, 120) : String(a); }
    catch (_) { return String(a); }
  }).join(' ');
  if (typeof logW === 'function') logW('console', msg);
  else setTimeout(() => { if (typeof logW === 'function') logW('console', msg); }, 100);
  _origConsoleWarn(...args);
};

// console.log hook: captures SDK internal errors (SDK uses console.log for grabFrame/WASM failures).
// SAFE: logBase now uses _origConsoleWarn/_origConsoleLog → no recursion possible.
let _inConsoleHook = false;
console.log = function (...args) {
  if (_inConsoleHook) { _origConsoleLog(...args); return; }
  const msg = args.map(a => {
    try { return typeof a === 'object' ? JSON.stringify(a).substring(0, 120) : String(a); }
    catch (_) { return String(a); }
  }).join(' ');
  if (/error|fail|exception|grab|muted|track|wasm|seeso/i.test(msg)) {
    _inConsoleHook = true;
    try {
      if (typeof logW === 'function') logW('sdk-log', msg);
    } finally { _inConsoleHook = false; }
  }
  _origConsoleLog(...args);
};


// ─────────────────────────────────────────────────────────────────────────────
// [POLYFILL] ImageCapture.grabFrame() for Safari/WebKit — POST-SDK PATCH
//
// IMPORTANT: This file uses ES module `import`, which means all imports
// (including seeso.min.js) are evaluated BEFORE this module body runs.
// Patching window.ImageCapture here is TOO LATE for the SDK's import-time check.
//
// The SeeSo SDK has its own internal ImageCapture polyfill that DOES implement
// grabFrame(), but it has a critical Safari bug:
//   grabFrame() waits for `self.videoElementPlaying` — a Promise that resolves
//   on the 'playing' DOM event. On iOS/iPadOS Safari, if the page is not
//   in the foreground or the video is created off-screen, 'playing' NEVER fires.
//   Result: grabFrame() hangs forever → processFrame_ stalls → FPS = 0.
//
// Fix Strategy (post-SDK patch):
//   After the SDK initializes and calls initStreamTrack_(), the SDK sets
//   `seeso.seeso.imageCapture` to an instance of *its own* ImageCapture class.
//   We patch the PROTOTYPE of that instance's constructor, replacing grabFrame()
//   with a readyState-based implementation that does NOT wait for 'playing'.
//   This is applied in patchSdkImageCapture() called after startTracking().
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {boolean} true if this is a Safari/WebKit browser */
function isSafariWebKit() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Patch the SDK's internal ImageCapture instance's grabFrame() method.
 * Must be called AFTER seeso.startTracking() has set seeso.seeso.imageCapture.
 * @param {object} rawSeeso - The raw Seeso instance (seeso.seeso)
 */

// [FIX #3] Global pool: reuse a single hidden video element per MediaStream track id.
// Prevents orphaned <video> elements accumulating in <body> across stopTracking/startTracking cycles.
const _safariVideoPool = new Map(); // trackId -> {video, canvas, ctx}

function _getOrCreateSafariVideo(track) {
  if (!track) return null;
  const id = track.id || '__default__';
  if (_safariVideoPool.has(id)) return _safariVideoPool.get(id);

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  video.muted = true;
  video.style.cssText = 'position:fixed;width:1px;height:1px;top:0;left:-2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(video);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const entry = { video, canvas, ctx, _grabPending: false, _grabResolvers: [] }; // [FIX-v28]
  _safariVideoPool.set(id, entry);
  return entry;
}

function patchSdkImageCapture(rawSeeso) {
  if (!isSafariWebKit()) return; // Chrome/Firefox: grabFrame works natively

  const ic = rawSeeso?.imageCapture;
  if (!ic) {
    setTimeout(() => patchSdkImageCapture(rawSeeso), 100); // retry until available
    return;
  }

  // Already patched? (but re-check if track changed — SDK may replace imageCapture on restart)
  if (ic.__grabFramePatched) return;
  ic.__grabFramePatched = true;

  // Seed video with current track (if available)
  const initialTrack = ic._videoStreamTrack || ic.track || rawSeeso.track;
  const initialEntry = _getOrCreateSafariVideo(initialTrack);
  if (initialEntry && initialTrack) {
    initialEntry.video.srcObject = new MediaStream([initialTrack]);
    initialEntry.video.play().catch(() => { });
  }

  // Replace grabFrame on the INSTANCE (not prototype)
  ic.grabFrame = function safariGrabFrame() {
    return new Promise((resolve, reject) => {
      // [FIX #3-A] Get current live track — may differ from initialTrack after restart
      const currentTrack = rawSeeso.track;

      // [FIX #3-B] null/ended track: don't reject immediately.
      // stopTracking() → startTracking() race: track briefly becomes null/ended.
      // Wait up to 500ms for it to recover before giving up.
      if (!currentTrack || currentTrack.readyState !== 'live') {
        let waitRetries = 10; // 10 × 50ms = 500ms
        const waitForTrack = () => {
          const t = rawSeeso.track;
          if (t && t.readyState === 'live') {
            // Track recovered — re-enter normal attempt flow
            ic.grabFrame().then(resolve).catch(reject);
          } else if (waitRetries-- > 0) {
            setTimeout(waitForTrack, 50);
          } else {
            reject(new DOMException('Safari grabFrame: track not live after 500ms wait', 'InvalidStateError'));
          }
        };
        setTimeout(waitForTrack, 50);
        return;
      }

      // Get or create pooled video for this track
      const entry = _getOrCreateSafariVideo(currentTrack);
      if (!entry) {
        reject(new DOMException('Safari grabFrame: failed to create video entry', 'InvalidStateError'));
        return;
      }

      const { video, canvas, ctx } = entry;

      // Sync srcObject if track changed
      const existingTracks = video.srcObject?.getVideoTracks?.() || [];
      if (!existingTracks.includes(currentTrack)) {
        video.srcObject = new MediaStream([currentTrack]);
        video.play().catch(() => { });
      }

      // [FIX-v28] Single in-flight guard — prevents concurrent attempt() closure chains.
      // Root cause: SDK calls grabFrame() at 30fps. On iPhone Air, video.readyState < 2
      // causes each call to spawn attempt(30) = 30 chained setTimeouts holding closures.
      // At 30fps over 60s reading = 1800 grabFrame calls × 30 closures = 54,000 closures → heap OOM.
      // Fix: only ONE polling chain runs per track at a time. Concurrent callers are
      // queued in _grabResolvers and receive the same ImageBitmap when the chain settles.
      if (entry._grabPending) {
        entry._grabResolvers.push({ resolve, reject });
        return;
      }
      entry._grabPending = true;

      const settle = (isResolve, val) => {
        entry._grabPending = false;
        if (isResolve) resolve(val); else reject(val);
        entry._grabResolvers.splice(0).forEach(r =>
          isResolve ? r.resolve(val) : r.reject(val)
        );
      };

      // 30 × 30ms = 900ms max wait for video.readyState >= 2
      const attempt = (retries) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          createImageBitmap(canvas)
            .then(bmp => settle(true, bmp))
            .catch(e => settle(false, e));
        } else if (retries > 0) {
          setTimeout(() => attempt(retries - 1), 30);
        } else {
          settle(false, new DOMException('Safari grabFrame: video not ready after 900ms', 'InvalidStateError'));
        }
      };
      attempt(30);
    });
  };

  if (typeof logW === 'function') {
    logW('polyfill', '[Safari] SDK imageCapture.grabFrame() patched v28 — in-flight guard + settle queue + 900ms timeout + video pool');
  }
}

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || e.reason?.toString?.() || String(e.reason);
  if (typeof logE === 'function') logE('sdk', 'Unhandled rejection: ' + msg);
});

window.addEventListener('error', (e) => {
  if (typeof logE === 'function') logE('sdk', 'Uncaught error: ' + e.message + ' (' + e.filename + ':' + e.lineno + ')');
});

// Initialize Manager
const gazeDataManager = new GazeDataManager();
// Expose to Game if needed, or Game accesses via window
window.gazeDataManager = gazeDataManager;

/**
 * SeeSo Eye Tracking Web Demo
 *
 * Goals:
 *  1) Calibration must not get stuck at 0%
 *  2) Gaze x,y must be visible (both in logs and on-screen HUD)
 *
 * Notes:
 *  - SeeSo Web SDK typically requires startCollectSamples() after the calibration point is shown.
 *  - JSON.stringify converts NaN -> null, so gaze x/y logging uses string formatting.
 *
 * Debug:
 *  - ?debug=1 (default): INFO/WARN/ERROR
 *  - ?debug=2          : verbose DEBUG
 */
// Product key: for selfso2014.github.io
// Dev key: for localhost
const LICENSE_KEY = window.location.hostname === "selfso2014.github.io"
  ? "prod_srdpyuuaumnsqoyk2pvdci0rg3ahsr923bshp32u"
  : "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox";

const DEBUG_LEVEL = (() => {
  const params = new URLSearchParams(location.search);
  // [MOD] Default: 1 (Enabled) if no param, or ?debug=1
  // If ?debug=0, then 0 (Hidden)
  if (!params.has("debug")) return 1;

  const n = Number(params.get("debug"));
  return Number.isFinite(n) ? n : 0;
})();

// --- [NEW] Debug Meter: Memory Leak Tracker ---
const activeRafs = new Set();
const listenerCounts = {};
let totalListeners = 0;

// Hook RAF
const originalRAF = window.requestAnimationFrame;
const originalCAF = window.cancelAnimationFrame;

window.requestAnimationFrame = (cb) => {
  // [FIX-iOS] Reuse wrapper to avoid per-frame anonymous closure creation.
  // Old code: originalRAF((t) => { ... }) created a new function every frame.
  // SeeSo SDK calls RAF at 30fps internally = 30 closures/sec × session = GC pressure.
  const id = originalRAF(function rafWrapper(t) {
    activeRafs.delete(id);
    if (cb) cb(t);
  });
  activeRafs.add(id);
  return id;
};

window.cancelAnimationFrame = (id) => {
  activeRafs.delete(id);
  originalCAF(id);
};

// Hook Event Listeners
const originalAdd = EventTarget.prototype.addEventListener;
const originalRemove = EventTarget.prototype.removeEventListener;

EventTarget.prototype.addEventListener = function (type, listener, options) {
  listenerCounts[type] = (listenerCounts[type] || 0) + 1;
  totalListeners++;
  return originalAdd.call(this, type, listener, options);
};

EventTarget.prototype.removeEventListener = function (type, listener, options) {
  if (listenerCounts[type] > 0) {
    listenerCounts[type]--;
    totalListeners--;
  }
  return originalRemove.call(this, type, listener, options);
};

// Start 1s Metric Loop
setInterval(() => {
  const rafCount = activeRafs.size;

  // [NEW] HEAP monitoring — Chrome/Android only (Safari blocks performance.memory for privacy).
  // Reads 3 numbers from an existing browser object: negligible overhead (<0.01ms/call).
  let heapStr = 'N/A'; // Default for Safari / unsupported browsers
  let heapPct = -1;
  if (performance.memory) {
    const usedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    const limitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
    heapPct = Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100);
    heapStr = `${usedMB}MB(${heapPct}%)`;
  }

  logBase("INFO", "Meter", `RAF:${rafCount} | LSN:${totalListeners} | HEAP:${heapStr}`);

  // RAF Warnings — tiered thresholds
  // Normal gameplay peak: RAF:7 (gaze + revealChunk + flying ink particles)
  // > 5  : WARN  — slightly above normal, worth watching
  // > 10 : CRITICAL — likely a runaway loop (OOM risk)
  if (rafCount > 10) {
    logE("CRITICAL", `RAF > 10: count=${rafCount}`);
  } else if (rafCount > 5) {
    logBase("WARN", "Meter", `RAF > 5: count=${rafCount}`);
  }
  if (totalListeners > 60) {
    logE("CRITICAL", `LSN > 60: total=${totalListeners}`);
  }

  // HEAP Warnings (Chrome/Android only — heapPct === -1 means unsupported, skip)
  // > 70% : WARN     — memory climbing, watch trend
  // > 85% : CRITICAL — high pressure, iOS OOM risk zone
  if (heapPct >= 0) {
    if (heapPct > 85) {
      logE("CRITICAL", `HEAP > 85%: ${heapStr} — OOM risk`);
    } else if (heapPct > 70) {
      logBase("WARN", "Meter", `HEAP > 70%: ${heapStr}`);
    }
  }

}, 1000);

// ---------- iOS Visibility Guard ----------
// [FIX-iOS] When user backgrounds the tab (notification, home button, social app switch),
// iOS does NOT suspend JS immediately — RAF loops keep running, burning CPU & memory.
// iOS may then kill the WebContent process after a short period of high memory pressure.
// This handler pauses all known RAF loops on hide and resumes on return.
// This covers ALL 4 crash cases: whether the crash happened before or after calibration.
(function attachVisibilityGuard() {
  let wasCalRunning = false;
  let wasTracking = false;
  let wasReading = false;     // [FIX #6] Track if reading session was active
  let wasSdkOn = false;       // [FIX #6] Track if SDK gate was open

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // ── TAB HIDDEN ──────────────────────────────────────────────────────
      logW('sys', '[iOS Guard] Tab hidden — pausing all RAF loops to prevent OOM Kill');

      // 1. Stop overlay calibration tick
      if (overlay && overlay.calRunning) {
        wasCalRunning = true;
        overlay.calRunning = false;           // tick() will exit on next frame
        if (overlay.rafId) {
          cancelAnimationFrame(overlay.rafId);
          overlay.rafId = null;
        }
      } else {
        wasCalRunning = false;
      }

      // 2. Stop Game-level RAF tracker (spawnFlyingResource etc.)
      if (window.Game && window.Game.activeRAFs && window.Game.activeRAFs.length > 0) {
        logW('sys', `[iOS Guard] Cancelling ${window.Game.activeRAFs.length} Game RAFs`);
        window.Game.activeRAFs.forEach(id => cancelAnimationFrame(id));
        window.Game.activeRAFs = [];
      }

      // 3. Stop TextRenderer replay RAF if running
      const tr = window.Game?.typewriter?.renderer;
      if (tr && typeof tr.cancelAllAnimations === 'function') {
        tr.cancelAllAnimations();
      }

      // 4. Stop AliceBattle RAF if running
      if (window.AliceBattleRef && typeof window.AliceBattleRef.destroy === 'function') {
        window.AliceBattleRef.destroy();
      }

      // 5. Track game tracking state
      wasTracking = window.Game?.state?.isTracking || false;

      // [FIX #6] Track reading session state
      const activeScreen = document.querySelector('.screen.active')?.id;
      wasReading = activeScreen === 'screen-read';
      wasSdkOn = window._seesoSdkOn === true;
      logW('sys', `[iOS Guard] wasReading=${wasReading} wasSdkOn=${wasSdkOn} screen=${activeScreen}`);

    } else {
      // ── TAB VISIBLE AGAIN ───────────────────────────────────────────────
      logW('sys', '[iOS Guard] Tab visible — resuming');

      // Resume overlay tick only if calibration was actually running
      if (wasCalRunning && overlay && window.startCalibrationRoutine) {
        logW('sys', '[iOS Guard] Resuming calibration overlay tick');
        overlay.calRunning = true;
        const tick = () => {
          if (!overlay.calRunning) { overlay.rafId = null; return; }
          renderOverlay();
          overlay.rafId = requestAnimationFrame(tick);
        };
        tick();
      }
      wasCalRunning = false;

      // [FIX #6] Resume reading session if it was active when tab was hidden
      if (wasReading) {
        logW('sys', '[iOS Guard] Reading session was active — attempting to restore');

        // Re-open gaze gate if it was open (SDK may need restart)
        if (wasSdkOn && typeof window.setSeesoTracking === 'function' && window._seesoSdkOn !== true) {
          logW('sys', '[iOS Guard] Re-opening gaze gate after tab restore');
          window.setSeesoTracking(true, 'visibility_restore');
        }

        // Restart typewriter tick if it was paused
        const typewriter = window.Game?.typewriter;
        if (typewriter && typewriter.isPaused === true) {
          logW('sys', '[iOS Guard] Resuming typewriter tick (was paused on hide)');
          typewriter.isPaused = false;
        }
      }
      wasReading = false;
      wasSdkOn = false;
    }
  });
})();

// ---------- DOM ----------
const els = {
  hud: document.getElementById("hud"),
  video: document.getElementById("camera-preview"),
  canvas: document.getElementById("output"),
  status: document.getElementById("status"),
  pillCoi: document.getElementById("pillCoi"),
  pillPerm: document.getElementById("pillPerm"),
  pillSdk: document.getElementById("pillSdk"),
  pillTrack: document.getElementById("pillTrack"),
  pillCal: document.getElementById("pillCal"),
  btnRetry: document.getElementById("btnRetry"),
};

// ---------- Logging (console + on-page panel) ----------
const LOG_MAX = 1500;
const LOG_BUFFER = [];

function ts() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function safeJson(v) {
  try {
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

function ensureLogPanel() {
  // Always create panel structure, but hide if debug=0
  // (We want it available for activation via secret gesture or URL param changes if we implement that later)
  // For now, respect DEBUG_LEVEL
  if (DEBUG_LEVEL === 0) return null;

  let container = document.getElementById("debugContainer");
  if (container) return document.getElementById("debugLogPanel");

  // Main Container
  container = document.createElement("div");
  container.id = "debugContainer";
  container.style.position = "fixed";
  container.style.right = "20px";
  container.style.bottom = "80px"; // Moved up to avoid bottom nav bars
  container.style.zIndex = "99999";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "flex-end";
  container.style.gap = "10px"; // Increased gap

  // Toggle Button (Mini Mode)
  const btnToggle = document.createElement("button");
  btnToggle.textContent = "🐞";
  btnToggle.style.fontSize = "32px"; // Bigger icon
  btnToggle.style.width = "56px"; // Bigger touch target
  btnToggle.style.height = "56px";
  btnToggle.style.borderRadius = "50%";
  btnToggle.style.border = "2px solid rgba(255,255,255,0.4)";
  btnToggle.style.background = "rgba(0,0,0,0.7)";
  btnToggle.style.color = "#fff";
  btnToggle.style.cursor = "pointer";
  btnToggle.style.boxShadow = "0 4px 12px rgba(0,0,0,0.6)";
  btnToggle.style.transition = "transform 0.2s";

  // Panel (Hidden by default)
  const panel = document.createElement("pre");
  panel.id = "debugLogPanel";
  panel.style.display = "none";
  panel.style.width = "340px"; // Slightly wider
  panel.style.height = "250px"; // Slightly taller
  panel.style.overflow = "auto";
  panel.style.padding = "12px";
  panel.style.borderRadius = "12px";
  panel.style.background = "rgba(0,0,0,0.9)";
  panel.style.color = "#0f0";
  panel.style.fontFamily = "monospace";
  panel.style.fontSize = "11px";
  panel.style.whiteSpace = "pre-wrap";
  panel.style.wordBreak = "break-word";
  panel.style.border = "1px solid #444";
  panel.style.marginBottom = "5px";

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.style.display = "none";
  toolbar.style.gap = "8px"; // Increased gap
  toolbar.style.flexWrap = "wrap"; // Allow wrapping
  toolbar.style.justifyContent = "flex-end";

  let isExpanded = false;

  const createBtn = (text, onClick, color = "#fff", bg = "#333") => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.padding = "8px 14px"; // Larger touch area
    b.style.fontSize = "13px";
    b.style.fontWeight = "bold";
    b.style.borderRadius = "6px";
    b.style.border = "1px solid #666";
    b.style.background = bg;
    b.style.color = color;
    b.style.cursor = "pointer";
    b.onclick = onClick;
    return b;
  };

  // [CRASH RECOVERY] Check for crash log from previous session (saved before Jetsam kill)
  const _savedCrashLog = (() => {
    try {
      const ts = parseInt(localStorage.getItem('debug_log_backup_ts') || '0');
      if ((Date.now() - ts) > 1800000) return null; // ignore logs older than 30 minutes
      const raw = localStorage.getItem('debug_log_backup');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  })();

  if (_savedCrashLog && _savedCrashLog.length > 0) {
    const btnCrash = createBtn(`🔴 Crash(${_savedCrashLog.length})`, () => {
      panel.textContent = _savedCrashLog.join('\n');
      panel.style.display = 'block';
      toolbar.style.display = 'flex';
      isExpanded = true;
      btnToggle.textContent = '❌';
      panel.scrollTop = panel.scrollHeight;
    }, '#fff', '#b71c1c');
    toolbar.appendChild(btnCrash);
  }

  // Copy
  toolbar.appendChild(createBtn("📋 Copy", async () => {
    try {
      await navigator.clipboard.writeText(LOG_BUFFER.join('\n'));
      panel.textContent += "\n[System] Copied to Clipboard!";
      panel.scrollTop = panel.scrollHeight;
      setTimeout(() => alert("Logs Copied!"), 100);
    } catch (e) { alert("Copy Failed"); }
  }));

  // Clear
  toolbar.appendChild(createBtn("🗑️ Clear", () => {
    LOG_BUFFER.length = 0;
    panel.textContent = "";
    try {
      localStorage.removeItem('debug_log_backup');
      localStorage.removeItem('debug_log_backup_ts');
    } catch (e) { }
  }, "#ff8a80"));

  // Upload (DB)
  const btnUpload = createBtn("☁️ Upload DB", async () => {
    // UI Feedback: Loading
    const originalText = btnUpload.textContent;
    btnUpload.textContent = "⏳ Sending...";
    btnUpload.disabled = true;
    btnUpload.style.opacity = "0.7";
    btnUpload.style.cursor = "wait";

    // [v33] Firebase is deferred-loaded. Load it now if not available.
    if (!window.firebase) {
      btnUpload.textContent = '⏳ Loading Firebase...';
      try {
        const loadScript = (src) => new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src; s.onload = res;
          s.onerror = () => rej(new Error('Failed: ' + src));
          document.head.appendChild(s);
        });
        await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
        await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js');
        await loadScript('./js/firebase-config.js');
      } catch (loadErr) {
        alert('Firebase load failed: ' + loadErr.message);
        resetBtn();
        return;
      }
    }

    try {
      // [FIX] Ensure Firebase App is initialized
      if (!firebase.apps.length) {
        if (window.FIREBASE_CONFIG) {
          firebase.initializeApp(window.FIREBASE_CONFIG);
        } else {
          throw new Error("Missing window.FIREBASE_CONFIG");
        }
      }

      const db = firebase.database();
      const sessionId = "session_" + Date.now();

      // [NEW] Retrieve Crashed Logs from LocalStorage
      let crashLogs = [];
      try {
        const stored = localStorage.getItem("debug_log_backup");
        if (stored) crashLogs = JSON.parse(stored);
      } catch (e) { console.warn("No crash logs found"); }

      // Merge: Crash Logs (Old) + Current Logs (New)
      // If crash logs exist, they are likely from the session that just died.
      const uploadData = {
        ua: navigator.userAgent,
        timestamp: new Date().toISOString(),
        logs: LOG_BUFFER, // Current Session (Post-Crash)
        crashLogs: crashLogs.length > 0 ? crashLogs : null // Previous Session (Pre-Crash)
      };

      // Timeout Promise (10s)
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout (10s)")), 10000)
      );

      // Race: Upload vs Timeout
      await Promise.race([
        db.ref("logs/" + sessionId).set(uploadData),
        timeout
      ]);

      let msg = `✅ Upload Success!\nSession ID: ${sessionId}`;
      if (crashLogs.length > 0) msg += `\n(Recovered ${crashLogs.length} lines from crash)`;
      alert(msg);

      panel.textContent += `\n[System] Uploaded to: logs/${sessionId}`;
      // Clear backup after successful upload to avoid duplicate uploads
      localStorage.removeItem("debug_log_backup");

    } catch (e) {
      console.error(e);
      alert("❌ Upload Failed: " + e.message);
    } finally {
      resetBtn();
    }

    function resetBtn() {
      btnUpload.textContent = originalText;
      btnUpload.disabled = false;
      btnUpload.style.opacity = "1";
      btnUpload.style.cursor = "pointer";
    }
  }, "#40c4ff", "#01579b"); // Blue color

  toolbar.appendChild(btnUpload);

  // Toggle Logic
  btnToggle.onclick = () => {
    isExpanded = !isExpanded;
    panel.style.display = isExpanded ? "block" : "none";
    toolbar.style.display = isExpanded ? "flex" : "none";
    btnToggle.textContent = isExpanded ? "❌" : "🐞";
    if (isExpanded) {
      panel.scrollTop = panel.scrollHeight;
      btnToggle.style.transform = "scale(0.9)";
    } else {
      btnToggle.style.transform = "scale(1)";
    }
  };

  container.appendChild(panel);
  container.appendChild(toolbar);
  container.appendChild(btnToggle);
  document.body.appendChild(container);

  return panel;
}

const panel = ensureLogPanel();

// ── BUILD VERSION BANNER ──────────────────────────────────────────────────────
// 로그 수집 시 어느 빌드인지 즉시 식별
const BUILD_VERSION = 'v33';
const BUILD_TAG = 'Camera480cap_RenderCap30fps';
const BUILD_COMMIT = 'pending';
const BUILD_DATE = '2026-02-22';
const BUILD_BANNER = `[BUILD] ${BUILD_VERSION} | ${BUILD_TAG} | ${BUILD_COMMIT} | ${BUILD_DATE}`;
// Panel에 즉시 삽입 (logBase 정의 이전이므로 직접 push)
if (panel) {
  const LOG_BANNER = `[${BUILD_DATE}] INFO  sys        ${BUILD_BANNER}`;
  // Will be prepended once LOG_BUFFER and pushLog are ready (deferred via setTimeout)
  setTimeout(() => {
    if (typeof logI === 'function') {
      logI('sys', BUILD_BANNER);
    }
  }, 0);
}
// ─────────────────────────────────────────────────────────────────────────────


// [FIX-iOS] Batch DOM updates — at most 4 textContent rebuilds per second.
// Old code rebuilt 225KB string on EVERY log call.
let _logDirty = false;
let _logFlushTimer = null;

// [CRASH RECOVERY] Throttled localStorage save — survives iOS Jetsam process kill.
// Saves last 400 log lines every 2 seconds. Readable on next page load via 🔴 Crash Log button.
const _LS_LOG_KEY = 'debug_log_backup';
const _LS_LOG_TS_KEY = 'debug_log_backup_ts';
let _crashSavePending = false;
function _scheduleCrashLogSave() {
  if (_crashSavePending) return;
  _crashSavePending = true;
  setTimeout(() => {
    _crashSavePending = false;
    try {
      localStorage.setItem(_LS_LOG_KEY, JSON.stringify(LOG_BUFFER.slice(-400)));
      localStorage.setItem(_LS_LOG_TS_KEY, Date.now().toString());
    } catch (e) { /* localStorage full or unavailable — non-critical */ }
  }, 2000);
}

function pushLog(line) {
  if (!panel) return;
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX);
  if (!_logDirty) {
    _logDirty = true;
    _logFlushTimer = setTimeout(() => {
      _logDirty = false;
      panel.textContent = LOG_BUFFER.join("\n");
      panel.scrollTop = panel.scrollHeight;
    }, 250);
  }
  _scheduleCrashLogSave(); // [CRASH RECOVERY] persist to localStorage
}

function logBase(level, tag, msg, data) {
  // [FIX-iOS] Removed double-serialization: old code did JSON.stringify(safeJson(data))
  // which is JSON.stringify(JSON.parse(JSON.stringify(data))) = 2x serialize.
  const dataStr = data !== undefined ? " " + (typeof data === 'string' ? data : JSON.stringify(data)) : "";
  const line = `[${ts()}] ${level.padEnd(5)} ${tag.padEnd(10)} ${msg}${dataStr}`;
  // Use original console methods to prevent recursion with our console.error/warn hooks
  if (level === "ERROR") _origConsoleError(line);
  else if (level === "WARN") _origConsoleWarn(line);
  else _origConsoleLog(line);
  pushLog(line);
}

function logI(tag, msg, data) {
  if (DEBUG_LEVEL >= 1) logBase("INFO", tag, msg, data);
}
function logW(tag, msg, data) {
  if (DEBUG_LEVEL >= 1) logBase("WARN", tag, msg, data);
}
function logE(tag, msg, data) {
  logBase("ERROR", tag, msg, data);
}
function logD(tag, msg, data) {
  if (DEBUG_LEVEL >= 2) logBase("DEBUG", tag, msg, data);
}

window.addEventListener("error", (e) => {
  logE("window", "Unhandled error", {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error ? safeJson(e.error) : null,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  logE("promise", "Unhandled rejection", safeJson(e.reason));
});

// ---------- UI helpers ----------
function setPill(el, text) {
  if (el) el.textContent = text;
}
function setStatus(text) {
  if (els.status) els.status.textContent = text;
}
// [FIX #7] Expose globally so IntroManager / other modules can show non-blocking status messages
window.setStatus = setStatus;

function showRetry(show, reason) {
  if (!els.btnRetry) return;
  els.btnRetry.style.display = show ? "inline-flex" : "none";
  if (show && reason) logW("ui", "Retry enabled", { reason });
}

if (els.btnRetry) {
  els.btnRetry.onclick = () => location.reload();
}

const btnCalStart = document.getElementById("btn-calibration-start");
if (btnCalStart) {
  btnCalStart.onclick = () => {
    btnCalStart.style.display = "none";
    if (seeso) {
      // Start safety timer FIRST
      calManager.startCollection();

      try {
        lastCollectAt = performance.now();
        seeso.startCollectSamples();
        logI("cal", "startCollectSamples called manually");
      } catch (e) {
        logE("cal", "startCollectSamples threw", e);
      }
    }
  };
}

// Throttle helper
function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

// Create/ensure gaze info line in HUD
function ensureGazeInfoEl() {
  if (!els.hud) return null;

  let el = document.getElementById("gazeInfo");
  if (el) return el;

  el = document.createElement("div");
  el.id = "gazeInfo";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.35";
  el.style.color = "rgba(255,255,255,0.75)";
  el.style.margin = "0 0 10px 0";
  el.textContent = "gaze: -";

  // Insert right after #status (so it stays above the pills)
  const statusEl = document.getElementById("status");
  if (statusEl && statusEl.parentNode === els.hud) {
    els.hud.insertBefore(el, statusEl.nextSibling);
  } else {
    els.hud.appendChild(el);
  }

  return el;
}

const gazeInfoEl = ensureGazeInfoEl();
function setGazeInfo(text) {
  if (gazeInfoEl) gazeInfoEl.textContent = text;
}

// ---------- State ----------
const state = { perm: "-", sdk: "-", track: "-", cal: "-" };

function setState(key, val) {
  state[key] = val;
  if (key === "perm") setPill(els.pillPerm, `perm: ${val}`);
  if (key === "sdk") setPill(els.pillSdk, `sdk: ${val}`);
  if (key === "track") setPill(els.pillTrack, `track: ${val}`);
  if (key === "cal") setPill(els.pillCal, `cal: ${val}`);
}

setPill(els.pillCoi, `coi: ${window.crossOriginIsolated ? "enabled" : "disabled"}`);

// ---------- Video / Canvas ----------
let mediaStream = null;

const overlay = {
  gaze: null, // {x,y,trackingState,confidence}
  gazeRaw: null, // {x,y,trackingState,confidence}
};

// [FIXED] calManager initialization with Face Check callback
const calManager = new CalibrationManager({
  logI, logW, logE, setStatus, setState,
  requestRender: () => renderOverlay(),
  onCalibrationFinish: () => {
    if (typeof window.Game !== "undefined") {
      window.Game.onCalibrationFinish();
    }
  },
  // [FIX-iOS] Explicitly stop the calibration RAF tick loop.
  // calibration.js finishSequence() calls this before triggering game start.
  // Prevents orphaned RAF loop stacking with game loops on iOS -> Tab Kill.
  stopCalibrationLoop: () => {
    overlay.calRunning = false; // tick() exit condition
    if (overlay.rafId) {
      cancelAnimationFrame(overlay.rafId); // force-cancel as double safety
      overlay.rafId = null;
    }
    logI("cal", "[FIX] Calibration RAF loop stopped.");
  },
  onFaceCheckSuccess: () => {
    logI("cal", "Face Check Success -> Triggering Real Calibration");
    startActualCalibration();
  },
  // [NEW] Restart callback for Retry
  onRestart: () => {
    logI("cal", "Retrying Calibration -> Restarting Sequence");
    startActualCalibration();
  }
});

function getCanvasCssSize() {
  if (!els.canvas) return { w: window.innerWidth, h: window.innerHeight, left: 0, top: 0 };
  const rect = els.canvas.getBoundingClientRect();
  // fixed inset:0 => rect.left/top should be 0, but keep robust
  return {
    w: rect.width || window.innerWidth,
    h: rect.height || window.innerHeight,
    left: rect.left || 0,
    top: rect.top || 0,
  };
}

function resizeCanvas() {
  if (!els.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = getCanvasCssSize();

  els.canvas.width = Math.max(1, Math.floor(w * dpr));
  els.canvas.height = Math.max(1, Math.floor(h * dpr));

  const ctx = els.canvas.getContext("2d");
  // draw in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearCanvas() {
  if (!els.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = els.canvas.width / dpr;
  const h = els.canvas.height / dpr;
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
}

function drawDot(x, y, r, color) {
  const ctx = els.canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  // Add stroke for visibility on light backgrounds
  ctx.lineWidth = 3;
  ctx.strokeStyle = "black";
  ctx.stroke();
}

function clamp(n, min, max) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function toCanvasLocalPoint(x, y) {
  // SIMPLIFIED LOGIC for Fullscreen Canvas
  // The SDK returns viewport-relative coordinates (screen pixels).
  // The canvas is fixed at (0,0) and size is 100vw/100vh.
  // Therefore, (x, y) from SDK matches (x, y) on canvas CSS pixels.
  // We do NOT subtract 'left' or 'top' because getBoundingClientRect() might break with mobile UI bars.

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Simple clamping
  const cx = clamp(x, 0, w);
  const cy = clamp(y, 0, h);

  if (cx == null || cy == null) return null;
  return { x: cx, y: cy };
}

let frameCount = 0;
// [FIX-iPhone15Pro] 30fps render cap.
// gaze callback fires at 30fps → no new position data exists above 30fps.
// On iPhone 15 Pro (120Hz ProMotion) the calibration RAF fires at 120fps AND
// the gaze callback also calls renderOverlay() at 30fps → ~150 renders/sec.
// Capping at 30fps (33.3ms) reduces GPU clear+draw from 150×/sec to 30×/sec (5× reduction).
let _lastRenderMs = 0;

function renderOverlay() {
  if (!els.canvas) return;
  const now = performance.now();
  if (now - _lastRenderMs < 33.3) return; // 30fps cap: gaze data max rate is 30fps
  _lastRenderMs = now;
  frameCount++;
  clearCanvas();

  // --- Calibration: Magic Orb Style (Arcane Focus) ---
  calManager.render(els.canvas.getContext("2d"), els.canvas.width, els.canvas.height, toCanvasLocalPoint);

  // --- Gaze dot ---
  if (overlay.gaze && overlay.gaze.x != null && overlay.gaze.y != null) {
    const opacity = overlay.gazeOpacity !== undefined ? overlay.gazeOpacity : 0; // Default hidden if not requested
    if (opacity > 0) {
      const pt = toCanvasLocalPoint(overlay.gaze.x, overlay.gaze.y) || overlay.gaze;
      // Draw with opacity
      const ctx = els.canvas.getContext("2d");
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      // Remove stroke for softer look
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffff3b";
      ctx.fill();
      ctx.restore();
    }
  }
}

// Fade out animation
let gazeFadeTimer = null;
let gazeFadeInterval = null;

window.showGazeDot = function (durationMs = 15000) {
  // Reset
  if (gazeFadeTimer) clearTimeout(gazeFadeTimer);
  if (gazeFadeInterval) clearInterval(gazeFadeInterval);
  gazeFadeTimer = null;

  // Make stage visible for drawing
  const stage = document.getElementById("stage");
  if (stage) stage.classList.add("visible");

  // "Infinite" mode (e.g. > 1000s) -> Static opacity, no fade
  if (durationMs > 100000) { // arbitrary large number check
    overlay.gazeOpacity = 0.3; // User requested 0.3
    return;
  }

  // Normal mode: Fade out
  overlay.gazeOpacity = 1.0;
  const startTime = performance.now();

  // Fade out linearly over the entire duration
  gazeFadeInterval = setInterval(() => {
    const elapsed = performance.now() - startTime;
    const progress = elapsed / durationMs; // 0.0 -> 1.0

    if (progress >= 1.0) {
      overlay.gazeOpacity = 0;
      clearInterval(gazeFadeInterval);
      gazeFadeInterval = null;

      // Hide stage again to prevent z-index issues
      if (stage) stage.classList.remove("visible");
    } else {
      overlay.gazeOpacity = 1.0 - progress;
    }
  }, 33); // ~30fps update
};

window.setGazeDotState = function (isOn) {
  // Clear fade timers
  if (gazeFadeTimer) clearTimeout(gazeFadeTimer);
  if (gazeFadeInterval) clearInterval(gazeFadeInterval);
  gazeFadeTimer = null;
  gazeFadeInterval = null;

  overlay.gazeOpacity = isOn ? 1.0 : 0;

  const stage = document.getElementById("stage");
  if (stage) {
    if (isOn) stage.classList.add("visible");
    else if (!overlay.calRunning) stage.classList.remove("visible");
  }
};

window.addEventListener("resize", () => {
  resizeCanvas();
  renderOverlay();
});

// ---------- Camera ----------
async function ensureCamera() {
  if (mediaStream && mediaStream.active) {
    logI("camera", "Stream already active, reusing.");
    return true;
  }

  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    setStatus("Camera requires HTTPS! Redirecting...");
    location.replace(`https:${location.href.substring(location.protocol.length)}`);
    return false;
  }

  // [FIX #5] 이전에 ended된 트랙이 있으면 명시적으로 stop() → 카메라 핸들 해제.
  // iOS에서 이전 트랙이 살아있으면 새 getUserMedia가 NotReadableError를 낼 수 있음.
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(t => t.stop());
    } catch (e) { /* silent */ }
    mediaStream = null;
  }

  setState("perm", "requesting");

  // [FIX-iPhone15Pro] Camera resolution constraints — portrait order.
  // HISTORY: original code had width:640, height:480 (landscape) → SDK face detection failed
  //          → removed in SDK_v13 commit. Now re-added in CORRECT portrait order.
  // WHY: iPhone 15 Pro front camera default = very high resolution (e.g. 1920x1440).
  //      SeeSo WASM allocates frame-processing buffers proportional to frame size.
  //      iPad Mini delivers 480x640 → 1.2MB/frame buffer.
  //      iPhone 15 Pro unconstrained → potentially 11MB+/frame buffer = ~9x more WASM memory.
  //      Capping at max 480x640 (portrait) forces identical buffer size across all devices.
  // width:max 480, height:max 640 → portrait (3:4) → correct axis for iOS face detection.
  const CAM_ATTEMPTS = [
    { video: { facingMode: "user", width: { max: 480 }, height: { max: 640 }, frameRate: { ideal: 30, max: 30 } }, audio: false },
    { video: { facingMode: "user" }, audio: false },  // fallback: no resolution constraint
    { video: true, audio: false },                    // last resort: any camera
  ];

  let lastError = null;

  for (let i = 0; i < CAM_ATTEMPTS.length; i++) {
    try {
      logI("camera", `[FIX #5] getUserMedia attempt ${i + 1}/${CAM_ATTEMPTS.length}`);
      mediaStream = await navigator.mediaDevices.getUserMedia(CAM_ATTEMPTS[i]);
      lastError = null;
      break; // Success
    } catch (e) {
      lastError = e;
      logW("camera", `Attempt ${i + 1} failed: ${e.name} — ${e.message}`);
    }
  }

  // [FIX #5] 3rd attempt: 2s 재시도 (NotReadableError = 카메라 일시 점유 상황 대응)
  if (lastError) {
    const isPermDenied = lastError.name === 'NotAllowedError' || lastError.name === 'PermissionDeniedError';
    if (!isPermDenied) {
      // 권한 거부가 아닌 경우 (NotReadableError 등)는 다른 앱의 카메라 점유가 풀릴 때까지 대기
      logW("camera", "[FIX #5] Camera busy (NotReadable?). Waiting 2s and retrying...");
      setStatus("⏳ 카메라를 초기화하는 중... (다른 앱이 카메라를 사용 중일 수 있습니다)");
      await new Promise(r => setTimeout(r, 2000));
      try {
        logI("camera", "[FIX #5] getUserMedia 3rd attempt (after 2s wait)");
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        lastError = null;
      } catch (e3) {
        lastError = e3;
        logE("camera", "3rd attempt also failed", e3);
      }
    } else {
      logE("camera", "Camera permission denied — no point retrying", lastError);
    }
  }

  if (lastError) {
    // All attempts failed
    setState("perm", "denied");
    showRetry(true, `camera_failed_${lastError.name}`);
    logE("camera", "getUserMedia all attempts failed", lastError);
    const isPermDenied = lastError.name === 'NotAllowedError' || lastError.name === 'PermissionDeniedError';
    setStatus(isPermDenied
      ? "⚠️ 카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용해주세요."
      : "⚠️ 카메라 접근 실패. 다른 앱을 닫고 재시도하세요."
    );
    return false;
  }

  // Success Handling
  try {
    setState("perm", "granted");

    if (els.video) {
      els.video.srcObject = mediaStream;
      els.video.playsInline = true;
      els.video.muted = true;
      await els.video.play().catch((e) => {
        logW("camera", "video.play() blocked; continuing", e?.message || e);
      });
    }

    const tracks = mediaStream.getVideoTracks();
    if (tracks && tracks[0]) {
      logI("camera", "track settings", tracks[0].getSettings?.());
    }

    return true;
  } catch (e) {
    logE("camera", "Video setup failed", e);
    return false;
  }
}

// ---------- SeeSo ----------
let seeso = null;
let SDK = null;

// timestamps for watchdog
let lastGazeAt = 0;
let lastNextPointAt = 0;
let lastCollectAt = 0;
let lastProgressAt = 0;
let lastFinishAt = 0;

function fmt(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(2) : "NaN";
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return String(v);
}

function enumName(enumObj, value) {
  if (!enumObj || value === undefined || value === null) return String(value);
  for (const [k, v] of Object.entries(enumObj)) {
    if (v === value) return k;
  }
  return String(value);
}

function attachSeesoCallbacks() {
  if (!seeso) return;

  // NOTE: EasySeeSo 패턴에서 gaze/debug 콜백은 startTracking(onGaze, onDebug)으로 전달.
  // 여기서는 calibration 콜백만 바인딩.

  // ---- Calibration callbacks (Delegated to CalibrationManager) ----
  // EasySeeSo는 내부적으로 seeso.seeso (raw Seeso 인스턴스)를 갖고 있음
  // calManager.bindTo는 raw Seeso 인스턴스가 필요할 수 있음
  if (seeso.seeso) {
    calManager.bindTo(seeso.seeso);
  } else {
    calManager.bindTo(seeso);
  }
  logI("sdk", "attachSeesoCallbacks: calibration callbacks bound");
}

// --- Preload Logic ---
let initPromise = null;

async function preloadSDK() {
  if (initPromise) return initPromise;

  console.log("[Seeso] Starting Background Preload...");
  initPromise = (async () => {
    try {
      setState("sdk", "loading");

      // README 공식 패턴: EasySeeSo 사용
      // EasySeeSo.init() 내부에서 initialize + addGazeCallback 처리
      seeso = new EasySeeSo();
      window.__seeso = seeso;
      setState("sdk", "constructed");

      logI("sdk", "initializing engine via EasySeeSo.init()...");
      setStatus("Loading AI model...");

      const SDK_INIT_TIMEOUT_MS = 30000; // 30s — WASM CDN download can be slow on mobile
      await Promise.race([
        new Promise((resolve, reject) => {
          seeso.init(
            LICENSE_KEY,
            () => resolve(),          // afterInitialized
            () => reject(new Error("EasySeeSo init failed (afterFailed — license or WASM error)"))
          );
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`SDK initialize timeout after ${SDK_INIT_TIMEOUT_MS / 1000}s`)),
            SDK_INIT_TIMEOUT_MS
          )
        )
      ]);

      // EasySeeSo.init() 성공 후 gaze 콜백은 startTracking() 실행 시 등록됨
      // 여기서는 calibration 콜백만 별도 등록
      attachSeesoCallbacks();
      setState("sdk", "initialized");
      setStatus("Initializing...");
      console.log("[Seeso] Preload Complete! Ready for Tracking.");
      return true;
    } catch (e) {
      logE("sdk", "Preload Failed", e);
      setState("sdk", "init_exception");
      // [FIX #1] Reset initPromise so next boot() call gets a fresh attempt (not cached rejection)
      initPromise = null;
      // Always show retry UI regardless of failure type
      const isTimeout = e.message && e.message.includes("timeout");
      setStatus(isTimeout
        ? "⚠️ 로딩 시간 초과. 네트워크를 확인 후 재시도 중..."
        : `⚠️ SDK 초기화 실패: ${e.message}. 새로고침 해주세요.`
      );
      if (!isTimeout) {
        // Non-timeout errors (license, WASM corrupt) → show retry button immediately
        showRetry(true, "sdk_init_failed");
      }
      // For timeouts: boot() will auto-retry once before showing the button
      throw e;

    }
  })();

  return initPromise;
}


// [FIX-iOS Cases 3&4] REMOVED auto-start preload.
// Previously: setTimeout(preloadSDK, 500) ran WASM init 500ms after page load.
// On low-memory iPhones, iOS detects large WASM allocation with no user gesture
// and kills the WebContent process in ~1.4 seconds (before any user interaction).
// Fix: SDK now initializes ONLY when the user has touched the screen and boot() is called.
// This gives iOS the user-gesture signal it requires to allocate memory fairly.

async function initSeeso() {
  // [FIX] Prevent multiple initializations/preloads
  if (seeso && (state.sdk === "initialized" || state.sdk === "tracking")) {
    logI("sdk", "initSeeso skipped: already initialized");
    return true;
  }

  // First call: starts the preload. Subsequent calls: waits for existing promise.
  if (!initPromise) {
    logI("sdk", "[FIX] initSeeso: starting SDK init on-demand (user-gesture path).");
    preloadSDK();
  }
  try {
    await initPromise;
    return true;
  } catch (e) {
    logE("sdk", "initSeeso failed", e);
    // [FIX #1] Reset so next attempt is fresh (don't cache the rejection)
    initPromise = null;
    return false;
  }
}

// Stored callbacks for SDK restart (setSeesoTracking reuse)
let _onGazeCb = null;
let _onDebugCb = null;

function startTracking() {
  if (!seeso) return false;

  // README 공식 패턴: EasySeeSo.startTracking(onGaze, onDebug)
  // 내부에서 getUserMedia를 직접 호출 → 별도 스트림 → SDK 전용
  // 외부 mediaStream을 전달하지 않음!

  // 우선 preview video용 stream이 있으면 camera 탭 피드백 유지
  if (mediaStream) {
    const vid = els.video;
    if (vid && !vid.srcObject) {
      vid.srcObject = mediaStream;
      vid.playsInline = true;
      vid.muted = true;
      vid.play().catch(() => { });
    }
  }

  _onGazeCb = (gazeInfo) => {
    lastGazeAt = performance.now();
    const xRaw = gazeInfo?.x;
    const yRaw = gazeInfo?.y;

    // [DIAG] 첫 발화 로그
    if (!startTracking._gazeFirstFired) {
      startTracking._gazeFirstFired = true;
      logI("gaze", "[DIAG] FIRST gazeCallback fired via EasySeeSo!", {
        x: xRaw, y: yRaw,
        trackingState: gazeInfo?.trackingState,
        keys: gazeInfo ? Object.keys(gazeInfo) : null
      });
    }

    if (calManager && calManager.handleFaceCheckGaze) {
      calManager.handleFaceCheckGaze(gazeInfo?.trackingState);
    }

    overlay.gazeRaw = { x: xRaw, y: yRaw, trackingState: gazeInfo?.trackingState, confidence: gazeInfo?.confidence };
    overlay.gaze = {
      x: typeof xRaw === "number" && Number.isFinite(xRaw) ? xRaw : null,
      y: typeof yRaw === "number" && Number.isFinite(yRaw) ? yRaw : null,
      trackingState: gazeInfo?.trackingState,
      confidence: gazeInfo?.confidence,
    };

    if (!window._gazeActive) { renderOverlay(); return; }
    if (typeof window.Game !== "undefined" && overlay.gaze.x !== null) {
      window.Game.onGaze(overlay.gaze.x, overlay.gaze.y);
    }
    if (window.gazeDataManager) {
      window.gazeDataManager.processGaze(gazeInfo);
    }
    renderOverlay();
  };

  _onDebugCb = (fps, latMin, latMax, latAvg) => {
    logI("sdkdbg", `FPS=${fps} lat(min=${latMin} max=${latMax} avg=${latAvg?.toFixed ? latAvg.toFixed(1) : latAvg}ms)`);
  };

  // EasySeeSo.startTracking에 기존 mediaStream 전달
  // → 두 번째 getUserMedia 호출 없이 같은 스트림 재사용
  // → Android 카메라 충돌(muted track → FPS=0) 방지
  seeso.startTracking(_onGazeCb, _onDebugCb, mediaStream || undefined).then((ok) => {
    logI("track", "EasySeeSo.startTracking returned", { ok });
    setState("track", ok ? "running" : "failed");

    // [DIAG v18] Patch raw Seeso processFrame_ to surface internal errors
    // seeso = EasySeeSo instance, seeso.seeso = raw Seeso instance
    const rawSeeso = seeso.seeso;
    if (ok && rawSeeso && typeof rawSeeso.processFrame_ === "function") {
      const _origPF = rawSeeso.processFrame_.bind(rawSeeso);
      let _pfCallCount = 0;
      let _pfLastLog = 0;
      rawSeeso.processFrame_ = async function diagProcessFrame(imageCapture) {
        _pfCallCount++;
        const now = performance.now();
        if (now - _pfLastLog > 3000) { // log every 3s
          _pfLastLog = now;
          logI("diag", `processFrame_ call #${_pfCallCount} | track.readyState=${rawSeeso.track?.readyState} muted=${rawSeeso.track?.muted} enabled=${rawSeeso.track?.enabled}`);
        }
        try {
          const result = await _origPF(imageCapture);
          return result;
        } catch (e) {
          logE("diag", `processFrame_ THREW: ${e?.message || String(e)}`);
          throw e;
        }
      };
      logI("diag", "processFrame_ patch applied to rawSeeso (seeso.seeso)");

      // [SAFARI FIX] Patch imageCapture.grabFrame() to bypass videoElementPlaying hang
      patchSdkImageCapture(rawSeeso);
      // Also patch checkStreamTrack_ to see if it's blocking
      if (typeof rawSeeso.checkStreamTrack_ === "function") {
        const _origCST = rawSeeso.checkStreamTrack_.bind(rawSeeso);
        let _cstFalseCount = 0;
        rawSeeso.checkStreamTrack_ = function diagCheckStreamTrack(track) {
          const result = _origCST(track);
          if (!result) {
            _cstFalseCount++;
            if (_cstFalseCount <= 5 || _cstFalseCount % 100 === 0) {
              logW("diag", `checkStreamTrack_ returned FALSE #${_cstFalseCount} | readyState=${track?.readyState} muted=${track?.muted} enabled=${track?.enabled} null=${track === null}`);
            }
          }
          return result;
        };
        logI("diag", "checkStreamTrack_ patch applied");
      }
    } else {
      logW("diag", `processFrame_ patch SKIPPED: ok=${ok} rawSeeso=${!!rawSeeso} hasFn=${typeof rawSeeso?.processFrame_}`);
    }
  }).catch((e) => {
    setState("track", "failed");
    logE("track", "EasySeeSo.startTracking threw", e?.message || String(e));
  });

  // startTracking은 async이므로 즉시 true 반환 (상태는 위 then/catch에서 처리)
  setState("track", "starting");
  return true;
}


/**
 * Entry Point for Game: Enters Face Check Mode.
 */
function startCalibration() {
  if (!seeso) return false;

  logI("cal", "Entering Face Check Mode...");
  calManager.startFaceCheck();
  return true;
}

/**
 * Internal: Actually calls Seeso Calibration after Face Check passes.
 */
function startActualCalibration() {
  if (!seeso) return false;

  // Make canvas layer visible for calibration dots
  const stage = document.getElementById("stage");
  if (stage) stage.classList.add("visible");

  // Force resize in case layout changed
  resizeCanvas();

  try {
    // Force High Accuracy (2) to ensure sufficient data collection (prevents 0% finish)
    // On Mobile, use Medium (1) or Low (0) to avoid getting stuck.
    // Force criteria to 0 (Low) for ALL devices to prevent Laptop freeze (Emergency)
    const criteria = 0;

    // 5-point calibration (mode 5 is standard usually, check docs. Here current code sends 1?)
    // Actually mode 1 might be 1-point? The user mentioned 5-point.
    // Changing to 5 for better accuracy if supported, but sticking to existing logic first.
    // The previous code had `seeso.startCalibration(1, criteria)`. Let's stick to 5 for game.
    // [Request] 1-point calibration (mode 1)

    calManager.reset();
    const mode = 1;

    // EasySeeSo.startCalibration()은 콜백 기반 시그니처 (onNextPoint, onProgress, onFinish, points)
    // calManager는 이미 seeso.seeso(raw Seeso)에 직접 바인딩됨 → raw Seeso API 직접 호출
    const rawSeeso = seeso.seeso || seeso;
    const ok = rawSeeso.startCalibration(mode, criteria);

    overlay.calRunning = !!ok;
    overlay.calProgress = 0;
    overlay.calPointCount = 0;

    if (ok) {
      // [FIX] Prevent duplicate loops
      if (overlay.rafId) {
        cancelAnimationFrame(overlay.rafId);
        overlay.rafId = null;
      }

      // Start single animation loop for calibration
      const tick = () => {
        if (!overlay.calRunning) {
          overlay.rafId = null;
          return;
        }
        renderOverlay();
        overlay.rafId = requestAnimationFrame(tick);
      };
      tick();
    }

    logI("cal", "startActualCalibration returned", { ok, criteria });
    setState("cal", ok ? "running" : "failed");
    setStatus("Calibrating... Look at the dots!");

    return !!ok;
  } catch (e) {
    setState("cal", "failed");
    logE("cal", "startActualCalibration threw", e);
    return false;
  }
}
window.startCalibrationRoutine = startCalibration;

// ---------- Watchdog ----------
setInterval(() => {
  const now = performance.now();
  const hb = {
    perm: state.perm,
    sdk: state.sdk,
    track: state.track,
    cal: state.cal,
    gazeMsAgo: lastGazeAt ? Math.round(now - lastGazeAt) : null,
    nextPointMsAgo: lastNextPointAt ? Math.round(now - lastNextPointAt) : null,
    collectMsAgo: lastCollectAt ? Math.round(now - lastCollectAt) : null,
    progressMsAgo: lastProgressAt ? Math.round(now - lastProgressAt) : null,
    finishMsAgo: lastFinishAt ? Math.round(now - lastFinishAt) : null,
    calProgress: overlay.calProgress,
  };

  // For calibration phases, keep watchdog verbose
  if (String(state.cal).startsWith("running")) {
    logI("hb", "calibration heartbeat", hb);

    if (!lastNextPointAt) {
      logW("hb", "No next-point callback yet (dot not emitted or callbacks not bound).", hb);
    } else if (!lastCollectAt || lastCollectAt < lastNextPointAt) {
      logW("hb", "Next-point emitted but collect not called.", hb);
    } else if (!lastProgressAt || now - lastProgressAt > 2500) {
      logW("hb", "Collect called but no progress events.", hb);
    }
  } else if (DEBUG_LEVEL >= 2) {
    logD("hb", "heartbeat", hb);
  }

  // If tracking is running but gaze callbacks stopped, surface it
  // Skip warning when:
  //   1. SDK is intentionally OFF (_seesoSdkOn===false) — replay/battle phase
  //   2. gaze gate is closed (_gazeActive===false) — stopTracking/startTracking transition
  //   3. within 10s of _gazeActive turning on — SDK spin-up latency on slow devices
  const gazeGateOpen = window._gazeActive === true;
  const sdkOn = window._seesoSdkOn !== false;
  if (state.track === "running" && lastGazeAt && now - lastGazeAt > 1500 && sdkOn && gazeGateOpen) {
    logW("hb", "No gaze samples for >1.5s while tracking is running.", hb);
  }
}, 2000);

// ---------- In-App Browser Logic ----------
function isInAppBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  // Common in-app identifiers: KAKAOTALK, FBAV (Facebook), Line, Instagram, etc.
  return (
    /KAKAOTALK/i.test(ua) ||
    /FBAV/i.test(ua) ||
    /Line/i.test(ua) ||
    /Instagram/i.test(ua) ||
    /Snapchat/i.test(ua) ||
    /Twitter/i.test(ua) ||
    /DaumApps/i.test(ua)
  );
}

function handleInAppBrowser() {
  const guideEl = document.getElementById("inappGuide");
  if (guideEl) guideEl.style.display = "flex"; // Use flex to center content

  setStatus("Please open in Chrome/Safari.");

  const btn = document.getElementById("btnOpenExternal");
  if (btn) {
    btn.onclick = () => {
      const url = window.location.href;

      // Android Intent scheme
      if (/Android/i.test(navigator.userAgent)) {
        // Try requesting Chrome specifically
        // Format: intent://<URL>#Intent;scheme=https;package=com.android.chrome;end
        const noProtocol = url.replace(/^https?:\/\//, "");
        const intentUrl = `intent://${noProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
        window.location.href = intentUrl;
      } else {
        // iOS or others: Hard to force-open. 
        // We can just try window.open (might be blocked) or alert the user.
        alert("Please copy the URL and open it in Safari or Chrome.");
        // Try clipboard copy as a fallback convenience
        navigator.clipboard.writeText(url).then(() => {
          alert("URL copied to clipboard!");
        }).catch(() => { });
      }
    };
  }
}

// ---------- Boot ----------
async function boot() {
  resizeCanvas();
  renderOverlay();

  setStatus("Initializing...");
  setGazeInfo("gaze: -");
  showRetry(false);

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Error: getUserMedia not available.");
    showRetry(true, "getUserMedia not available");
    return;
  }

  // [EasySeeSo pattern] SDK init FIRST, then camera.
  // [FIX #1] Auto-retry SDK init once on timeout before showing manual retry button.
  let sdkOk = await initSeeso();
  if (!sdkOk) {
    const isTimeout = state.sdk === 'init_exception';
    if (isTimeout) {
      logW('boot', '[FIX #1] SDK init timed out — auto-retrying once...');
      setStatus('⏳ AI 모델 로딩 재시도 중... (네트워크가 느린 환경)');
      // Small wait before retry so GC can run
      await new Promise(r => setTimeout(r, 1500));
      sdkOk = await initSeeso();
    }
    if (!sdkOk) {
      setStatus('⚠️ 초기화 실패. 아래 버튼을 눌러 다시 시도하세요.');
      showRetry(true, 'sdk_init_failed_after_retry');
      return false;
    }
  }

  // Camera AFTER init (matches EasySeeSo flow)
  const camOk = await ensureCamera();
  if (!camOk) return false;

  const trackOk = startTracking();
  if (!trackOk) {
    setStatus("Failed to start tracking.");
    showRetry(true, "tracking failed");
    return false;
  }

  // Calibration is now triggered manually by Game
  logI("boot", "ready (tracking started, calibration pending)");
  return true; // Return success
}

// Expose boot control to Game
window.startEyeTracking = boot;

// ---------- SeeSo Tracking On/Off Control ----------
/**
 * [v33 - Gate-Only Architecture]
 *
 * 핵심 변경: WASM stop/start 사이클 제거.
 *
 * 이전 방식 (v32):
 *   OFF → seeso.stopTracking() : WASM 종료 (메모리 해제)
 *   ON  → seeso.startTracking(): WASM 재로드 (+190MB 스파이크)
 *   문제: 전환 시 0MB→190MB 스파이크 → iOS Jetsam 유발
 *
 * 새 방식 (v33):
 *   OFF → _gazeActive = false 만 설정 (게이트 닫힘)
 *   ON  → _gazeActive = true  만 설정 (게이트 열림)
 *   WASM은 세션 내내 단 한 번만 로드하여 190MB 안정 상주.
 *   스파이크 없음 → 기기별 크래시 편차 제거.
 *
 * OFF (game.js:setSeesoTracking(false)): replay·전투 구간 — 데이터 수집 안 함
 * ON  (game.js:setSeesoTracking(true)):  읽기 구간 — 데이터 수집 재개
 */
window._gazeActive = true;
window._seesoSdkOn = true;

window.setSeesoTracking = function (on, reason) {
  if (window._seesoSdkOn === on) {
    logI('seeso', `[Gate] already ${on ? 'OPEN' : 'CLOSED'}, skipping (${reason})`);
    return;
  }
  window._seesoSdkOn = on;

  const heapMB = performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB'
    : 'N/A';

  if (!on) {
    // ── GATE CLOSE: 데이터 수집 중단. WASM은 계속 실행 ──
    window._gazeActive = false;
    logI('seeso', `[Gate v33] CLOSED ← gate only, WASM stays on | reason: ${reason} | heap: ${heapMB}`);
  } else {
    // ── GATE OPEN: 데이터 수집 재개. WASM은 이미 실행 중 ──
    window._gazeActive = true;
    logI('seeso', `[Gate v33] OPEN ← gate only, WASM was always on | reason: ${reason} | heap: ${heapMB}`);
  }
};


// ---------- Shutdown: Camera + SDK Cleanup ----------
/**
 * [FIX] Release all SeeSo and camera resources.
 * Previously, seeso.startTracking() was never paired with stopTracking(),
 * causing the camera to stay active (LED on) for the entire browser session.
 * This function should be called:
 *   - On page unload (beforeunload)
 *   - When the user reaches the final score/share screen (optional: camera no longer needed)
 */
function shutdownEyeTracking() {
  try {
    if (seeso && typeof seeso.stopTracking === 'function') {
      seeso.stopTracking();
      logI('sys', '[Shutdown] seeso.stopTracking() called.');
    }
  } catch (e) {
    logW('sys', '[Shutdown] seeso.stopTracking() threw:', e);
  }

  // Stop all camera tracks (turns off camera LED)
  try {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        track.stop();
        logI('sys', `[Shutdown] Camera track stopped: ${track.kind} (${track.label})`);
      });
      mediaStream = null;
    }
  } catch (e) {
    logW('sys', '[Shutdown] mediaStream.getTracks() threw:', e);
  }

  // Stop video element feed
  try {
    if (els && els.video) {
      els.video.pause();
      els.video.srcObject = null;
    }
  } catch (e) { /* silent */ }

  logI('sys', '[Shutdown] Eye tracking resources released.');
}

// [FIX] Auto-shutdown on page unload (covers: tab close, refresh, navigation)
window.addEventListener('beforeunload', () => {
  shutdownEyeTracking();
});

// Expose so Game can call manually on final screen
window.shutdownEyeTracking = shutdownEyeTracking;

