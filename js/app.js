// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";
import { CalibrationManager } from "./calibration.js";
import { GazeDataManager } from "./gaze-data-manager.js"; // Import

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
  const id = originalRAF((t) => {
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
  // Only log if debug is enabled OR to console if critical
  const rafCount = activeRafs.size;

  const metricData = {
    ts: new Date().toISOString(),
    rafCount: rafCount,
    rafs: Array.from(activeRafs),
    listenerCount: totalListeners,
    listeners: { ...listenerCounts },
    buffers: {}
  };

  // Log format requested by user
  logBase("INFO", "Meter", `RAF:${rafCount} | LSN:${totalListeners} | BUF:?`, metricData);

  // Critical Warnings (iOS Crash Prevention)
  if (rafCount > 2) {
    logE("CRITICAL", `RAF > 2: [${Array.from(activeRafs)}]`);
  }
  if (totalListeners > 60) {
    logE("CRITICAL", `LSN > 60:`, listenerCounts);
  }

}, 1000);

// ---------- DOM ----------
const els = {
  hud: document.getElementById("hud"),
  video: document.getElementById("preview"),
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

  // Copy
  toolbar.appendChild(createBtn("📋 Copy", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(LOG_BUFFER, null, 2));
      const originalText = panel.textContent;
      panel.textContent += "\n[System] Copied to Clipboard!";
      panel.scrollTop = panel.scrollHeight;
      setTimeout(() => alert("Logs Copied!"), 100);
    } catch (e) { alert("Copy Failed"); }
  }));

  // Clear
  toolbar.appendChild(createBtn("🗑️ Clear", () => {
    LOG_BUFFER.length = 0;
    panel.textContent = "";
  }, "#ff8a80"));

  // Upload (DB)
  const btnUpload = createBtn("☁️ Upload DB", async () => {
    // UI Feedback: Loading
    const originalText = btnUpload.textContent;
    btnUpload.textContent = "⏳ Sending...";
    btnUpload.disabled = true;
    btnUpload.style.opacity = "0.7";
    btnUpload.style.cursor = "wait";

    if (!window.firebase) {
      alert("Error: Firebase SDK not loaded.");
      resetBtn();
      return;
    }

    try {
      const db = firebase.database();
      const sessionId = "session_" + Date.now();
      // Test Auth first (optional, logging only)
      if (firebase.auth && !firebase.auth().currentUser) {
        console.warn("[Upload] Not logged in (Anonymous Auth might be required)");
      }

      await db.ref("logs/" + sessionId).set({
        ua: navigator.userAgent,
        timestamp: new Date().toISOString(),
        logs: LOG_BUFFER
      });

      alert(`✅ Upload Success!\nSession ID: ${sessionId}`);
      panel.textContent += `\n[System] Uploaded to: logs/${sessionId}`;
    } catch (e) {
      console.error(e);
      alert("❌ Upload Failed: " + e.message + "\n\n[Check Firebase Console -> Start Collection if first time, or Rules]");
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

function pushLog(line) {
  if (!panel) return; // No panel, no display
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX);
  panel.textContent = LOG_BUFFER.join("\n");
  panel.scrollTop = panel.scrollHeight;
}

function logBase(level, tag, msg, data) {
  const line = `[${ts()}] ${level.padEnd(5)} ${tag.padEnd(10)} ${msg}${data !== undefined ? " " + JSON.stringify(safeJson(data)) : ""
    }`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
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

function renderOverlay() {
  if (!els.canvas) return;
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
    alert("Camera requires HTTPS! Redirecting...");
    location.replace(`https:${location.href.substring(location.protocol.length)}`);
    return false;
  }

  setState("perm", "requesting");
  try {
    // 1st Attempt: Ideal constraints
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });
  } catch (e1) {
    console.warn("[Camera] 1st attempt failed (constraints). Retrying with basic constraints...");
    try {
      // 2nd Attempt: Basic constraints (Laptop Friendly)
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
    } catch (e2) {
      // Final Failure
      setState("perm", "denied");
      showRetry(true, "camera permission denied");
      logE("camera", "getUserMedia all attempts failed", e2);
      alert("Camera access failed! Please check permissions or close other apps using the camera.");
      return false;
    }
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

  // ---- Gaze callback (log + HUD) ----
  const logGazeXY = throttle((g) => {
    const xRaw = g?.x ?? g?.gazeInfo?.x ?? g?.data?.x ?? g?.screenX ?? g?.gazeX ?? g?.rawX;
    const yRaw = g?.y ?? g?.gazeInfo?.y ?? g?.data?.y ?? g?.screenY ?? g?.gazeY ?? g?.rawY;
    const stVal = g?.trackingState;
    const conf = g?.confidence;

    const stName = SDK?.TrackingState ? enumName(SDK.TrackingState, stVal) : String(stVal);

    // IMPORTANT: string message so NaN/undefined remains visible
    logI("gaze", `xy x=${fmt(xRaw)} y=${fmt(yRaw)} state=${stName}(${fmt(stVal)}) conf=${fmt(conf)}`);

    // Also reflect on HUD
    setGazeInfo(`gaze: x=${fmt(xRaw)}  y=${fmt(yRaw)}  state=${stName}(${fmt(stVal)})  conf=${fmt(conf)}`);

    if ((typeof xRaw !== "number" || typeof yRaw !== "number") && DEBUG_LEVEL >= 2) {
      logD("gaze", "schema", { keys: g ? Object.keys(g) : null });
    }
  }, 150);

  // For debug=2, keep a lightweight sample object (throttled)
  const logGazeSample = throttle(() => {
    if (DEBUG_LEVEL >= 2 && overlay.gazeRaw) {
      logD("gaze", "sample", {
        x: overlay.gazeRaw.x,
        y: overlay.gazeRaw.y,
        trackingState: overlay.gazeRaw.trackingState,
      });
    }
  }, 60);

  if (typeof seeso.addGazeCallback === "function") {
    seeso.addGazeCallback((gazeInfo) => {
      lastGazeAt = performance.now();

      // Raw values (for HUD/log)
      const xRaw = gazeInfo?.x;
      const yRaw = gazeInfo?.y;

      // [NEW] Face Check Logic
      if (calManager && calManager.handleFaceCheckGaze) {
        calManager.handleFaceCheckGaze(gazeInfo?.trackingState);
      }

      overlay.gazeRaw = {
        x: xRaw,
        y: yRaw,
        trackingState: gazeInfo?.trackingState,
        confidence: gazeInfo?.confidence,
      };

      // Use finite numbers only for drawing
      overlay.gaze = {
        x: typeof xRaw === "number" && Number.isFinite(xRaw) ? xRaw : null,
        y: typeof yRaw === "number" && Number.isFinite(yRaw) ? yRaw : null,
        trackingState: gazeInfo?.trackingState,
        confidence: gazeInfo?.confidence,
      };

      // --- GAME INTEGRATION (First Update Context/Game State) ---
      if (typeof window.Game !== "undefined" && overlay.gaze.x !== null) {
        window.Game.onGaze(overlay.gaze.x, overlay.gaze.y);
      }

      // --- DATA LOGGING (Then Save Data with Updated Context) ---
      if (window.gazeDataManager) {
        window.gazeDataManager.processGaze(gazeInfo);
      }
      // ------------------------

      // Log + HUD
      logGazeXY(gazeInfo);
      logGazeSample();

      renderOverlay();
    });

    logI("sdk", "addGazeCallback bound (xy HUD/log enabled)");
  } else {
    logW("sdk", "addGazeCallback not found on seeso instance");
  }

  // ---- Debug callback (optional) ----
  if (typeof seeso.addDebugCallback === "function") {
    seeso.addDebugCallback((info) => logD("sdkdbg", "debug", info));
    logI("sdk", "addDebugCallback bound");
  }

  // ---- Calibration callbacks (Delegated to CalibrationManager) ----
  calManager.bindTo(seeso);
}

// --- Preload Logic ---
let initPromise = null;

async function preloadSDK() {
  if (initPromise) return initPromise;

  console.log("[Seeso] Starting Background Preload...");
  initPromise = (async () => {
    try {
      setState("sdk", "loading");
      SDK = await loadWebpackModule("./seeso/dist/seeso.js?v=FINAL_FIX_NOW");
      const SeesoClass = SDK?.default || SDK?.Seeso || SDK;
      if (!SeesoClass) throw new Error("Seeso export not found");

      seeso = new SeesoClass();
      window.__seeso = { SDK, seeso };

      setState("sdk", "constructed");

      // Bind callbacks early
      attachSeesoCallbacks();

      // Initialize Engine
      const userStatusOption = SDK?.UserStatusOption
        ? new SDK.UserStatusOption(true, true, true)
        : { useAttention: true, useBlink: true, useDrowsiness: true };

      logI("sdk", "initializing engine...");
      const errCode = await seeso.initialize(LICENSE_KEY, userStatusOption);

      if (errCode !== 0) {
        setState("sdk", "init_failed");
        throw new Error("Initialize returned: " + errCode);
      }

      setState("sdk", "initialized");
      console.log("[Seeso] Preload Complete! Ready for Tracking.");
      return true;
    } catch (e) {
      logE("sdk", "Preload Failed", e);
      setState("sdk", "init_exception");
      throw e;
    }
  })();

  return initPromise;
}

// Auto-start preload after short delay
setTimeout(preloadSDK, 500);

// Modified initSeeso (now just waits for preload)
async function initSeeso() {
  if (!initPromise) preloadSDK();
  try {
    await initPromise;
    return true;
  } catch (e) {
    return false;
  }
}

function startTracking() {
  if (!seeso || !mediaStream) return false;

  try {
    const ok = seeso.startTracking(mediaStream);
    logI("track", "startTracking returned", { ok });
    setState("track", ok ? "running" : "failed");
    return !!ok;
  } catch (e) {
    setState("track", "failed");
    logE("track", "startTracking threw", e);
    return false;
  }
}

/**
 * Entry Point for Game: Enters Face Check Mode.
 */
function startCalibration() {
  if (!seeso) return false;

  // Start tracking first if not already
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

    const ok = seeso.startCalibration(mode, criteria);

    overlay.calRunning = !!ok;
    overlay.calProgress = 0;
    overlay.calPointCount = 0;

    if (ok) {
      // Start single animation loop for calibration
      const tick = () => {
        if (!overlay.calRunning) return;
        renderOverlay();
        requestAnimationFrame(tick);
      };
      tick();

      // [EMERGENCY SKIP REMOVED FOR PRODUCTION]
      /*
      setTimeout(() => {
        if (overlay.calRunning) {
          const skipBtn = document.createElement('button');
          skipBtn.innerText = "⚠️ Emergency Skip";
           // ... (removed)
          document.body.appendChild(skipBtn);
          setTimeout(() => skipBtn.remove(), 10000);
        }
      }, 3000);
      */
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
  if (state.track === "running" && lastGazeAt && now - lastGazeAt > 1500) {
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

  // (In-app browser check moved to immediate execution)

  setStatus("Initializing...");
  setGazeInfo("gaze: -");
  showRetry(false);

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Error: getUserMedia not available.");
    showRetry(true, "getUserMedia not available");
    return;
  }

  const camOk = await ensureCamera();
  if (!camOk) return false; // Return false on failure

  const sdkOk = await initSeeso();
  if (!sdkOk) return false;

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

// (Auto-check removed to allow UI access)

