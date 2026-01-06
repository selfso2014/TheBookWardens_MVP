// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

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
const LICENSE_KEY = "prod_srdpyuuaumnsqoyk2pvdci0rg3ahsr923bshp32u";

const DEBUG_LEVEL = (() => {
  const v = new URLSearchParams(location.search).get("debug");
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
})();

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
  let panel = document.getElementById("debugLogPanel");
  if (panel) return panel;

  panel = document.createElement("pre");
  panel.id = "debugLogPanel";
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.bottom = "12px";
  panel.style.width = "560px";
  panel.style.maxWidth = "calc(100vw - 24px)";
  panel.style.height = "320px";
  panel.style.maxHeight = "40vh";
  panel.style.overflow = "auto";
  panel.style.padding = "10px";
  panel.style.borderRadius = "10px";
  panel.style.background = "rgba(0,0,0,0.75)";
  panel.style.color = "#d7f7d7";
  panel.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  panel.style.fontSize = "12px";
  panel.style.lineHeight = "1.35";
  panel.style.zIndex = "99999";
  panel.style.whiteSpace = "pre-wrap";
  panel.style.wordBreak = "break-word";
  panel.style.userSelect = "text";

  const header = document.createElement("div");
  header.style.position = "fixed";
  header.style.right = "12px";
  header.style.bottom = "340px";
  header.style.width = panel.style.width;
  header.style.maxWidth = panel.style.maxWidth;
  header.style.display = "flex";
  header.style.gap = "8px";
  header.style.zIndex = "99999";

  const btnCopy = document.createElement("button");
  btnCopy.textContent = "Copy Logs";
  btnCopy.style.padding = "6px 10px";
  btnCopy.style.borderRadius = "8px";
  btnCopy.style.border = "1px solid rgba(255,255,255,0.2)";
  btnCopy.style.background = "rgba(255,255,255,0.08)";
  btnCopy.style.color = "white";
  btnCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(panel.textContent || "");
      logI("ui", "Logs copied to clipboard");
    } catch (e) {
      logE("ui", "Failed to copy logs", e);
    }
  };

  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear Logs";
  btnClear.style.padding = "6px 10px";
  btnClear.style.borderRadius = "8px";
  btnClear.style.border = "1px solid rgba(255,255,255,0.2)";
  btnClear.style.background = "rgba(255,255,255,0.08)";
  btnClear.style.color = "white";
  btnClear.onclick = () => {
    LOG_BUFFER.length = 0;
    panel.textContent = "";
    logI("ui", "Logs cleared");
  };

  const badge = document.createElement("div");
  badge.textContent = `debug=${DEBUG_LEVEL}`;
  badge.style.marginLeft = "auto";
  badge.style.padding = "6px 10px";
  badge.style.borderRadius = "999px";
  badge.style.border = "1px solid rgba(255,255,255,0.2)";
  badge.style.background = "rgba(255,255,255,0.08)";
  badge.style.color = "white";
  badge.style.fontSize = "12px";

  header.appendChild(btnCopy);
  header.appendChild(btnClear);
  header.appendChild(badge);

  document.body.appendChild(header);
  document.body.appendChild(panel);
  return panel;
}

const panel = ensureLogPanel();

function pushLog(line) {
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX);
  panel.textContent = LOG_BUFFER.join("\n");
  panel.scrollTop = panel.scrollHeight;
}

function logBase(level, tag, msg, data) {
  const line = `[${ts()}] ${level.padEnd(5)} ${tag.padEnd(10)} ${msg}${
    data !== undefined ? " " + JSON.stringify(safeJson(data)) : ""
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
  calPoint: null, // {x,y}
  calProgress: null, // 0..1
  calRunning: false,
};

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
}

function clamp(n, min, max) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function toCanvasLocalPoint(x, y) {
  const { w, h, left, top } = getCanvasCssSize();
  // Assume SDK returns viewport coordinates; convert to canvas-local.
  // If coordinates are already canvas-local and the canvas is fullscreen, left/top are 0 so it remains correct.
  const lx = x - left;
  const ly = y - top;

  // Keep visible even if slightly outside
  const cx = clamp(lx, 0, w);
  const cy = clamp(ly, 0, h);
  if (cx == null || cy == null) return null;
  return { x: cx, y: cy };
}

function renderOverlay() {
  if (!els.canvas) return;
  clearCanvas();

  // Calibration dot
  if (overlay.calRunning && overlay.calPoint) {
    const pt = toCanvasLocalPoint(overlay.calPoint.x, overlay.calPoint.y) || overlay.calPoint;
    drawDot(pt.x, pt.y, 14, "#ffff3b");
  }

  // Gaze dot
  if (overlay.gaze && overlay.gaze.x != null && overlay.gaze.y != null) {
    const pt = toCanvasLocalPoint(overlay.gaze.x, overlay.gaze.y) || overlay.gaze;
    drawDot(pt.x, pt.y, 7, "#ffff3b");
  }
}

window.addEventListener("resize", () => {
  resizeCanvas();
  renderOverlay();
});

// ---------- Camera ----------
async function ensureCamera() {
  setState("perm", "requesting");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });

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
    setState("perm", "denied");
    showRetry(true, "camera permission denied");
    logE("camera", "getUserMedia failed", e);
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

  // ---- Calibration callbacks (crucial) ----
  if (typeof seeso.addCalibrationNextPointCallback === "function") {
    seeso.addCalibrationNextPointCallback((x, y) => {
      lastNextPointAt = performance.now();

      overlay.calPoint = { x, y };
      overlay.calRunning = true;
      overlay.calProgress = 0;

      logI("cal", `onCalibrationNextPoint x=${fmt(x)} y=${fmt(y)}`);
      renderOverlay();

      // Must collect samples AFTER the point is on screen
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            lastCollectAt = performance.now();
            seeso.startCollectSamples();
            logI("cal", "startCollectSamples called");
          } catch (e) {
            logE("cal", "startCollectSamples threw", e);
          }
        }, 80);
      });
    });

    logI("sdk", "addCalibrationNextPointCallback bound");
  } else {
    logW("sdk", "addCalibrationNextPointCallback not found");
  }

  if (typeof seeso.addCalibrationProgressCallback === "function") {
    seeso.addCalibrationProgressCallback((progress) => {
      lastProgressAt = performance.now();
      overlay.calProgress = progress;

      const pct = typeof progress === "number" ? Math.round(progress * 100) : NaN;
      if (Number.isFinite(pct)) {
        setStatus(`Calibrating... ${pct}% (keep your head steady, look at the green dot)`);
        setState("cal", `running (${pct}%)`);
      } else {
        setStatus(`Calibrating... (progress=${String(progress)})`);
        setState("cal", "running");
      }

      if (DEBUG_LEVEL >= 2) logD("cal", "progress", { progress, pct });
    });

    logI("sdk", "addCalibrationProgressCallback bound");
  } else {
    logW("sdk", "addCalibrationProgressCallback not found");
  }

  if (typeof seeso.addCalibrationFinishCallback === "function") {
    seeso.addCalibrationFinishCallback((calibrationData) => {
      lastFinishAt = performance.now();

      overlay.calRunning = false;
      overlay.calPoint = null;
      renderOverlay();

      setState("cal", "finished");
      setStatus("Calibration finished.");

      logI("cal", "onCalibrationFinished", {
        type: typeof calibrationData,
        length: calibrationData?.length,
        preview: typeof calibrationData === "string" ? calibrationData.slice(0, 120) + "..." : null,
      });
    });

    logI("sdk", "addCalibrationFinishCallback bound");
  } else {
    logW("sdk", "addCalibrationFinishCallback not found");
  }
}

async function initSeeso() {
  setState("sdk", "loading");

  try {
    SDK = await loadWebpackModule("./seeso/dist/seeso.js");
    const SeesoClass = SDK?.default || SDK?.Seeso || SDK;
    if (!SeesoClass) throw new Error("Seeso export not found from ./seeso/dist/seeso.js");

    seeso = new SeesoClass();
    window.__seeso = { SDK, seeso };

    setState("sdk", "constructed");
    logI("sdk", "module loaded", { exportedKeys: Object.keys(SDK || {}) });
  } catch (e) {
    setState("sdk", "load_failed");
    showRetry(true, "sdk load failed");
    logE("sdk", "Failed to load ./seeso/dist/seeso.js", e);
    return false;
  }

  // Bind callbacks before init
  attachSeesoCallbacks();

  try {
    const userStatusOption = SDK?.UserStatusOption
      ? new SDK.UserStatusOption(true, true, true)
      : { useAttention: true, useBlink: true, useDrowsiness: true };

    logI("sdk", "initializing", { userStatusOption });

    const errCode = await seeso.initialize(LICENSE_KEY, userStatusOption);
    logI("sdk", "initialize returned", { errCode });

    if (errCode !== 0) {
      setState("sdk", "init_failed");
      showRetry(true, "sdk init failed");
      logE("sdk", "initialize failed", { errCode });
      return false;
    }

    setState("sdk", "initialized");
    return true;
  } catch (e) {
    setState("sdk", "init_exception");
    showRetry(true, "sdk init exception");
    logE("sdk", "Exception during initialize()", e);
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

function startCalibration() {
  if (!seeso) return false;

  try {
    const criteria = SDK?.CalibrationAccuracyCriteria?.DEFAULT ?? 0;
    const ok = seeso.startCalibration(1, criteria);

    overlay.calRunning = !!ok;
    overlay.calProgress = 0;

    logI("cal", "startCalibration returned", { ok, criteria });
    setState("cal", ok ? "running" : "failed");
    setStatus("Calibrating... 0% (keep your head steady, look at the green dot)");

    return !!ok;
  } catch (e) {
    setState("cal", "failed");
    logE("cal", "startCalibration threw", e);
    return false;
  }
}

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

  const camOk = await ensureCamera();
  if (!camOk) return;

  const sdkOk = await initSeeso();
  if (!sdkOk) return;

  const trackOk = startTracking();
  if (!trackOk) {
    setStatus("Failed to start tracking.");
    showRetry(true, "tracking failed");
    return;
  }

  const calOk = startCalibration();
  if (!calOk) {
    setStatus("Failed to start calibration.");
    showRetry(true, "calibration failed");
    return;
  }

  logI("boot", "ready");
}

boot().catch((e) => logE("boot", "boot() exception", e));
