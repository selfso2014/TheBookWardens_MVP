// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

/**
 * SeeSo Web Demo (1-point calibration)
 * Fix for "Calibrating... 0%" stuck:
 *  - When calibration next-point is emitted, you MUST call seeso.startCollectSamples()
 *    after rendering the green dot. Without this, progress can remain at 0%.
 *
 * Debug:
 *  - Add ?debug=2 to enable verbose logs.
 */
const LICENSE_KEY = "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox";

const DEBUG_LEVEL = (() => {
  const v = new URLSearchParams(location.search).get("debug");
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
})();

// ---------- DOM ----------
const els = {
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

// ---------- Logging ----------
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
  panel.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
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
  const line = `[${ts()}] ${level.padEnd(5)} ${tag.padEnd(10)} ${msg}${data !== undefined ? " " + JSON.stringify(safeJson(data)) : ""}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  pushLog(line);
}
function logI(tag, msg, data) { if (DEBUG_LEVEL >= 1) logBase("INFO", tag, msg, data); }
function logW(tag, msg, data) { if (DEBUG_LEVEL >= 1) logBase("WARN", tag, msg, data); }
function logE(tag, msg, data) { logBase("ERROR", tag, msg, data); }
function logD(tag, msg, data) { if (DEBUG_LEVEL >= 2) logBase("DEBUG", tag, msg, data); }

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

// ---------- UI ----------
function setPill(el, text) { if (el) el.textContent = text; }
function setStatus(text) { if (els.status) els.status.textContent = text; }

function showRetry(show, reason) {
  if (!els.btnRetry) return;
  els.btnRetry.style.display = show ? "inline-flex" : "none";
  if (show && reason) logW("ui", "Retry enabled", { reason });
}

if (els.btnRetry) {
  els.btnRetry.onclick = () => location.reload();
}

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
  gaze: null,          // {x,y,trackingState,confidence}
  calPoint: null,      // {x,y}
  calProgress: null,   // 0..1
  calRunning: false,
};

function resizeCanvas() {
  if (!els.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Keep CSS at 100%, set backing store scaled by DPR.
  els.canvas.width = Math.floor(w * dpr);
  els.canvas.height = Math.floor(h * dpr);

  const ctx = els.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
}

function clearCanvas() {
  if (!els.canvas) return;
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawDot(x, y, r, color) {
  const ctx = els.canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function renderOverlay() {
  if (!els.canvas) return;
  clearCanvas();

  // Calibration dot: larger and on top priority
  if (overlay.calRunning && overlay.calPoint) {
    drawDot(overlay.calPoint.x, overlay.calPoint.y, 14, "#00ff3b"); // green
  }

  // Gaze dot: smaller
  if (overlay.gaze && overlay.gaze.x != null && overlay.gaze.y != null) {
    drawDot(overlay.gaze.x, overlay.gaze.y, 7, "#88ff3b");
  }
}

window.addEventListener("resize", () => {
  resizeCanvas();
  renderOverlay();
});

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
        // Autoplay may be blocked; still fine because the stream exists.
        logW("camera", "video.play() blocked; continuing", e?.message || e);
      });
    }

    // Track settings
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
let SDK = null; // module exports (enums etc)

// timestamps for watchdog
let lastGazeAt = 0;
let lastNextPointAt = 0;
let lastCollectAt = 0;
let lastProgressAt = 0;

function attachSeesoCallbacks() {
// (attachSeesoCallbacks 내부)

// 200ms마다 x,y를 INFO로 로깅(너무 스팸이면 300~500으로 조정)
const logGazeXY = throttle((gazeInfo) => {
  const x = gazeInfo?.x;
  const y = gazeInfo?.y;

  // SDK/브라우저에 따라 키가 다를 수 있어 후보도 같이 찍음
  const altX = gazeInfo?.screenX ?? gazeInfo?.gazeX ?? gazeInfo?.rawX;
  const altY = gazeInfo?.screenY ?? gazeInfo?.gazeY ?? gazeInfo?.rawY;

  if (typeof x === "number" && typeof y === "number") {
    logI("gaze", "xy", {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      trackingState: gazeInfo?.trackingState,
      confidence: gazeInfo?.confidence,
    });
  } else {
    // x,y가 undefined면 어떤 키로 오는지 파악 가능하게 로그
    logW("gaze", "xy not found in gazeInfo", {
      hasX: "x" in (gazeInfo || {}),
      hasY: "y" in (gazeInfo || {}),
      altX,
      altY,
      keys: gazeInfo ? Object.keys(gazeInfo) : null,
    });
  }
}, 200);

if (typeof seeso.addGazeCallback === "function") {
  seeso.addGazeCallback((gazeInfo) => {
    lastGazeAt = performance.now();

    // overlay 갱신은 기존대로
    overlay.gaze = {
      x: gazeInfo?.x,
      y: gazeInfo?.y,
      trackingState: gazeInfo?.trackingState,
      confidence: gazeInfo?.confidence,
    };

    // ★ 여기서 x,y 로그가 찍힘
    logGazeXY(gazeInfo);

    renderOverlay();
  });

  logI("sdk", "addGazeCallback bound");
} else {
  logW("sdk", "addGazeCallback not found on seeso instance");
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

  attachSeesoCallbacks();

  // init
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

// ---------- Watchdog (pinpoint why stuck at 0%) ----------
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
    calProgress: overlay.calProgress,
  };

  if (state.cal.startsWith("running")) {
    logI("hb", "calibration heartbeat", hb);

    // Strong signal for the root cause:
    // - nextPoint happens, collect happens, but progress callback never fires => progress callback not bound / SDK internal failure
    // - nextPoint never happens => calibration didn't really start (or callbacks not bound)
    // - collect never happens => startCollectSamples not called (classic 0% stuck)
    if (!lastNextPointAt) {
      logW("hb", "No next-point callback yet (dot may not be emitted).", hb);
    } else if (!lastCollectAt || (lastCollectAt < lastNextPointAt)) {
      logW("hb", "Next-point emitted but collect not called (0% stuck).", hb);
    } else if (!lastProgressAt || (now - lastProgressAt > 2500)) {
      logW("hb", "Collect called but no progress events (check callback binding / SDK).", hb);
    }
  } else if (DEBUG_LEVEL >= 2) {
    logD("hb", "heartbeat", hb);
  }
}, 2000);

// ---------- Boot ----------
async function boot() {
  resizeCanvas();
  setStatus("Initializing...");
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
