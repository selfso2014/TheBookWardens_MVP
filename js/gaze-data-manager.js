/**
 * Gaze Data Management
 * Stores and processes raw gaze data into structured format with Gaussian smoothing and velocity calculation.
 */
import { detectVelXSpikes } from "./velx-spike-detector.js";
import { bus } from "./core/EventBus.js"; // Import Event Bus

export class GazeDataManager {
    constructor() {
        this.data = []; // { t, x, y, gx, gy, vx, vy, gvx, gvy, type ... }
        this.buffer = []; // for smoothing window
        this.firstTimestamp = null;
        this.context = {}; // Initialize context
        this.lineMetadata = {}; // Store per-line metadata
        this.lastTriggerTime = 0;

        // NEW: State for Max-Min Cascade
        this.lastPosPeakTime = 0;

        // NEW: Start time of actual content (first valid line index)
        this.firstContentTime = null;

        // NEW: Replay Data Storage (Chart 6)
        this.replayData = null;

        // NEW: Max Reach Line Guard (V9.5) - Tracks highest line index triggered
        this.maxLineIndexReached = -1; // Initialize to -1 so line 0 can fire (0 > -1)
        this.pangLog = []; // NEW: Log of successful Pang events

        // NEW: Gaze-Based WPM State
        this.wpm = 0;              // Real-time WPM
        this.validWordSum = 0;     // Cumulative words from valid lines
        this.validTimeSum = 0;     // Cumulative time from valid lines (ms)
        this.lastRSTime = 0;       // Timestamp of last valid Return Sweep
        this.lastRSLine = -1;      // Line Index of last valid Return Sweep

        // NEW: Incremental Upload State (Memory Optimization)
        this.lastUploadedIndex = 0;

        // [NEW] WPM Log for Dashboard
        this.wpmData = [];

        // [FIX] Search Boundary for WPM Calculation
        this.searchStartIndex = 0;

        // --- RGT (Relative-Gaze Trigger) State ---
        this.currentLineMinX = 99999;     // 'a' (Line Start)
        this.globalMaxX = 0;              // 'b' (Line End / Screen Right)
        this.isCollectingLineStart = false;
    }

    /**
     * Process a single gaze frame from SeeSo SDK
     */
    processGaze(gazeInfo) {
        if (!gazeInfo) return;

        // EMERGENCY CHECK: Ensure storage exists
        if (!this.data || !Array.isArray(this.data)) {
            console.warn("[GazeDataManager] Data array missing/corrupt. Re-initializing.");
            this.data = [];
        }

        try {
            // Validity Check
            // [CRITICAL FIX] Force align timestamp to Date.now() (Epoch ms).
            // This ensures alignment with game.js Logic which uses Date.now().
            // Seeso SDK might return performance.now() or sensor time, causing mismatch.
            gazeInfo.timestamp = Date.now();

            // Initialize start time OR Reset if timestamp went backwards (Session Reset)
            if (this.firstTimestamp === null || gazeInfo.timestamp < this.firstTimestamp) {
                console.warn("[GazeDataManager] Timeline Start/Reset detected.", gazeInfo.timestamp);
                this.firstTimestamp = gazeInfo.timestamp;
            }

            const t = Math.floor(gazeInfo.timestamp - this.firstTimestamp);
            const x = gazeInfo.x;
            const y = gazeInfo.y;

            let type = 'Unknown';
            if (gazeInfo.eyemovementState === 0) type = 'Fixation';
            else if (gazeInfo.eyemovementState === 2) type = 'Saccade';

            const entry = {
                t, x, y,
                gx: null, gy: null,
                vx: null, vy: null,
                targetY: null, avgY: null,
                type,
                sdkFixationX: gazeInfo.fixationX,
                sdkFixationY: gazeInfo.fixationY,
                ...(this.context || {}),
                // New Debug Fields
                rsState: null,     // 'Pending', 'Immediate', 'Delayed', 'Missed', 'Timeout'
                rsTriggerType: null // 'Immediate', 'Delayed'
            };

            // CRITICAL: Always push raw data
            this.data.push(entry);

            // [DEBUG] Gaze Data Pressure Monitor
            if (this.data.length % 1000 === 0) {
                console.log(`[Mem] GazeData size: ${this.data.length} (Warning!)`);
            }

            // [NEW] Capture Start of Content (First valid Line Index)
            if (this.firstContentTime === null && typeof entry.lineIndex === 'number' && entry.lineIndex >= 0) {
                this.firstContentTime = entry.t;
                // [RGT] Initial Line Start Collection
                this.isCollectingLineStart = true;
                setTimeout(() => this.isCollectingLineStart = false, 200);
            }

            // [RGT] Collect Min X for 'a' (Start Point)
            if (this.isCollectingLineStart) {
                if (entry.x < this.currentLineMinX && entry.x > 0) {
                    this.currentLineMinX = entry.x;
                }
            }

            // REAL-TIME LOGIC (Isolated Safety Net)
            try {
                // VELOCITY CALC
                if (this.data.length > 1) {
                    const prev = this.data[this.data.length - 2];
                    const curr = this.data[this.data.length - 1];
                    // Safety check
                    if (prev && curr) {
                        const dt = curr.t - prev.t;
                        if (dt > 0) {
                            curr.vx = (curr.x - prev.x) / dt;
                            curr.vy = (curr.y - prev.y) / dt;
                        } else {
                            curr.vx = 0;
                            curr.vy = 0;
                        }
                    }
                }

                // --- NEW: Pending Sweep Resolution (Null -> Valid Line) ---
                // If we have a pending trigger waiting for context, check if context arrived.
                // RISING EDGE CHECK: Only fire if we transitioned from "No Line" (or different line) to "Valid Line".
                // We use this.prevLineIndex which holds the state from the PREVIOUS frame loop.
                const isContextRestored = (this.prevLineIndex === null || this.prevLineIndex === undefined || this.prevLineIndex === -1);

                if (this.pendingReturnSweep && entry.lineIndex !== undefined && entry.lineIndex !== null && isContextRestored) {
                    // Check if the pending sweep is still fresh (< 1000ms)
                    if ((t - this.pendingReturnSweep.t) < 1000) {
                        this._fireEffect("Delayed", this.pendingReturnSweep.vx);
                        if (this.data.length > 0) this.data[this.data.length - 1].rsState = "Delayed_Success";
                        this.pendingReturnSweep = null;
                        // console.log("[RS] ✅ Delayed Trigger Fired (Context Restored)");
                    } else {
                        this.pendingReturnSweep = null; // Expired
                    }
                }

                // --- Execute Realtime Detection ---
                this.detectRealtimeReturnSweep();
            } catch (logicErr) {
                console.error("[GazeDataManager] Logic Error (Data preserved):", logicErr);
            }

        } catch (criticalErr) {
            console.error("[GazeDataManager] CRITICAL: Main Process Failed!", criticalErr);
            // LAST RESORT: Save raw data anyway
            try {
                this.data.push({
                    t: Date.now(),
                    x: gazeInfo.x,
                    y: gazeInfo.y,
                    type: 'Emergency_Backup',
                    error: criticalErr.message
                });
            } catch (e) {
                console.error("[GazeDataManager] FATAL: Storage unavailable.");
            }
        }
    }

    /**
     * Post-processing: Interpolation -> Smoothing -> Velocity
     */
    preprocessData() {
        if (this.data.length < 2) return;

        // 1. Interpolation
        for (let i = 0; i < this.data.length; i++) {
            const curr = this.data[i];
            const isMissing = isNaN(curr.x) || isNaN(curr.y) || (curr.x === 0 && curr.y === 0) || typeof curr.x !== 'number';

            if (isMissing) {
                let prevIdx = i - 1;
                while (prevIdx >= 0) {
                    const p = this.data[prevIdx];
                    if (typeof p.x === 'number' && !isNaN(p.x) && !isNaN(p.y) && (p.x !== 0 || p.y !== 0)) break;
                    prevIdx--;
                }

                let nextIdx = i + 1;
                while (nextIdx < this.data.length) {
                    const n = this.data[nextIdx];
                    if (typeof n.x === 'number' && !isNaN(n.x) && !isNaN(n.y) && (n.x !== 0 || n.y !== 0)) break;
                    nextIdx++;
                }

                if (prevIdx >= 0 && nextIdx < this.data.length) {
                    const p = this.data[prevIdx];
                    const n = this.data[nextIdx];
                    const ratio = (curr.t - p.t) / (n.t - p.t);
                    curr.x = p.x + (n.x - p.x) * ratio;
                    curr.y = p.y + (n.y - p.y) * ratio;
                }
            }
        }

        // 2. Gaussian Smoothing & Velocity
        const kernel = [0.0545, 0.2442, 0.4026, 0.2442, 0.0545]; // Sigma=1.0
        const half = Math.floor(kernel.length / 2);

        for (let i = 0; i < this.data.length; i++) {
            let sumX = 0, sumY = 0, sumK = 0;
            for (let k = -half; k <= half; k++) {
                const idx = i + k;
                if (idx >= 0 && idx < this.data.length) {
                    sumX += this.data[idx].x * kernel[k + half];
                    sumY += this.data[idx].y * kernel[k + half];
                    sumK += kernel[k + half];
                }
            }
            this.data[i].gx = sumX / sumK;
            this.data[i].gy = sumY / sumK;

            // Recalculate Velocity with Smoothed Data
            if (i > 0) {
                const prev = this.data[i - 1];
                const dt = this.data[i].t - prev.t;
                if (dt > 0) {
                    this.data[i].vx = (this.data[i].gx - prev.gx) / dt;
                    this.data[i].vy = (this.data[i].gy - prev.gy) / dt;
                } else {
                    this.data[i].vx = 0;
                    this.data[i].vy = 0;
                }
            }
        }
    }

    setContext(ctx) {
        this.context = { ...this.context, ...ctx };
    }

    setLineMetadata(lineIndex, metadata) {
        if (!this.lineMetadata[lineIndex]) {
            this.lineMetadata[lineIndex] = {};
        }
        this.lineMetadata[lineIndex] = { ...this.lineMetadata[lineIndex], ...metadata };
    }

    setReplayData(data) {
        this.replayData = data;
    }

    getFixations() {
        return this.data.filter(d => d.type === 'Fixation');
    }

    getAllData() {
        return this.data;
    }

    reset() {
        this.data = [];
        this.buffer = [];
        this.firstTimestamp = null;
        this.context = {};
        this.lineMetadata = {};
        this.lastTriggerTime = 0;
        this.lastPosPeakTime = 0;
        this.firstContentTime = null;
        this.lastUploadedIndex = 0; // Reset upload cursor
    }

    // NEW: Reset only trigger logic (for new paragraph/level) without clearing data
    resetTriggers() {
        this.firstContentTime = null;
        this.lastTriggerTime = 0;
        this.lastPosPeakTime = 0;
        this.pendingReturnSweep = null;
        this.maxLineIndexReached = -1; // Reset max reach guard
        this.pangLog = []; // NEW: Reset Pang Logs

        // Reset WPM State (Partially)
        // [FIX] Do NOT reset cumulative WPM stats (wpm, validWordSum, validTimeSum)
        // This ensures WPM is averaged across the entire session, not per paragraph.
        // this.wpm = 0; 
        // this.validWordSum = 0;
        // this.validTimeSum = 0;

        this.lastRSTime = 0;
        this.lastRSLine = -1;
        this.pangCountInPara = 0; // [NEW] Track Pangs per Paragraph

        console.log("[GazeDataManager] Triggers Reset (New Content Started).");

        // [FIX] Set Search Boundary for WPM Calculation
        // Prevents referencing old paragraph data (e.g. Line 0 of prev para)
        this.searchStartIndex = this.data ? this.data.length : 0;

        // [RGT] Reset 'a' but keep 'b' (User Width Habit persists)
        this.currentLineMinX = 99999;
        this.isCollectingLineStart = true;
        setTimeout(() => this.isCollectingLineStart = false, 200);
    }

    // NEW: Retrieve Pang Logs for Replay
    getPangLogs() {
        return this.pangLog || [];
    }

    exportCSV(startTime = 0, endTime = Infinity) {
        if (!this.data || this.data.length === 0) {
            alert("No gaze data to export.");
            return;
        }
        this.preprocessData();
        this.detectLinesMobile(startTime, endTime);

        const targetYMap = {};
        if (window.Game && window.Game.typewriter && window.Game.typewriter.lineYData) {
            window.Game.typewriter.lineYData.forEach(item => {
                targetYMap[item.lineIndex] = item.y;
            });
        }

        const lineYSum = {};
        const lineYCount = {};
        const lineYAvg = {};
        this.data.forEach(d => {
            if (d.t < startTime || d.t > endTime) return;
            const lIdx = d.lineIndex;
            if (lIdx !== undefined && lIdx !== null) {
                if (d.gy !== undefined && d.gy !== null) {
                    if (!lineYSum[lIdx]) { lineYSum[lIdx] = 0; lineYCount[lIdx] = 0; }
                    lineYSum[lIdx] += d.gy;
                    lineYCount[lIdx]++;
                }
            }
        });

        Object.keys(lineYSum).forEach(k => {
            if (lineYCount[k] > 0) lineYAvg[k] = lineYSum[k] / lineYCount[k];
        });

        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,InkY_Px,AlgoLineIndex,TargetY_Px,AvgCoolGazeY_Px,ReplayX,ReplayY,InkSuccess,DidFire,ReturnSweepState,TriggerType,Debug_Median,Debug_Threshold,Debug_RealtimeVX\n";
        this.data.forEach(d => {
            if (d.t < startTime || d.t > endTime) return;
            const lIdx = d.lineIndex;
            let targetY = "";
            let avgY = "";
            if (lIdx !== undefined && lIdx !== null) {
                d.targetY = targetYMap[lIdx] !== undefined ? targetYMap[lIdx] : null;
                if (d.avgY === undefined || d.avgY === null) {
                    d.avgY = lineYAvg[lIdx] !== undefined ? parseFloat(lineYAvg[lIdx].toFixed(2)) : null;
                }
                targetY = d.targetY !== null ? d.targetY : "";
                avgY = d.avgY !== null ? d.avgY : "";
            }

            const row = [
                d.t, d.x, d.y,
                d.gx ? d.gx.toFixed(2) : "", d.gy ? d.gy.toFixed(2) : "",
                d.vx ? d.vx.toFixed(4) : "", d.vy ? d.vy.toFixed(4) : "",
                d.type,
                (d.isReturnSweep ? "TRUE" : ""),
                (d.lineIndex !== undefined && d.lineIndex !== null) ? d.lineIndex : "",
                (d.charIndex !== undefined && d.charIndex !== null) ? d.charIndex : "",
                (d.inkY !== undefined && d.inkY !== null) ? d.inkY.toFixed(0) : "",
                (d.detectedLineIndex !== undefined) ? d.detectedLineIndex : "",
                targetY, avgY,
                (d.rx !== undefined && d.rx !== null) ? d.rx.toFixed(2) : "",
                (d.ry !== undefined && d.ry !== null) ? d.ry.toFixed(2) : "",
                (this.lineMetadata[lIdx] && this.lineMetadata[lIdx].success) ? "TRUE" : "FALSE",
                (d.didFire ? "TRUE" : ""),
                (d.rsState || ""),
                (d.rsTriggerType || ""),
                (d.debugMedian !== undefined) ? d.debugMedian.toFixed(3) : "",
                (d.debugThreshold !== undefined) ? d.debugThreshold.toFixed(3) : "",
                (d.debugVX !== undefined) ? d.debugVX.toFixed(3) : ""
            ];
            csv += row.join(",") + "\n";
        });

        const ua = navigator.userAgent.toLowerCase();
        let deviceType = "desktop";
        if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) deviceType = "smartphone";
        else if (/tablet|ipad|playbook|silk/i.test(ua)) deviceType = "tablet";

        // CSV Download Disabled per user request (Firebase upload only)
        /*
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute("download", `${deviceType}_gaze_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        */
        this.exportChartImage(deviceType, startTime, endTime);
    }

    async uploadToCloud(sessionId) {
        if (!window.firebase || !window.FIREBASE_CONFIG) {
            console.error("[Firebase] SDK or Config not loaded.");
            // alert("Firebase not configured. Cannot upload."); // Silence alert for background sync
            return;
        }

        // console.log(`[Firebase] Syncing session [${sessionId}]...`);
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);

            // 1. Ensure Data is Processed
            this.preprocessData();

            const db = firebase.database();

            // 2. Upload Metadata (Always update to reflect latest stats)
            // Use 'update' instead of 'set' to avoid wiping other fields if any
            const metaData = {
                timestamp: Date.now(),
                userAgent: navigator.userAgent,
                lineMetadata: this.lineMetadata,
                totalSamples: this.data.length,
                firstContentTime: this.firstContentTime,
                wpmData: this.wpmData || [] // [NEW] Send WPM Log
            };

            // A. Full Session Path (Heavy Data Context)
            await db.ref('sessions/' + sessionId + '/meta').set(metaData);

            // B. Lightweight List Path (Fast Retrieval)
            // Storing metadata separately allows the dashboard to load the list instantly
            // without downloading the massive gaze data array.
            await db.ref('session_list/' + sessionId).set(metaData);

            // 3. Incremental Chunk Upload (Memory Safe)
            // Only upload data that hasn't been uploaded yet
            const startIndex = this.lastUploadedIndex;
            const newData = this.data.slice(startIndex);

            if (newData.length > 0) {
                console.log(`[Firebase] Uploading Chunk: ${newData.length} items (Index ${startIndex} -> ${this.data.length})`);

                // Sanitize Payload (Remove Infinity/NaN which Firebase hates)
                const payload = JSON.parse(JSON.stringify(newData, (key, value) => {
                    if (typeof value === 'number' && isNaN(value)) return null;
                    return value;
                }));

                // Push as a new chunk
                const chunksRef = db.ref('sessions/' + sessionId + '/chunks');
                await chunksRef.push(payload);

                // Update Cursor
                this.lastUploadedIndex = this.data.length;
            } else {
                // console.log("[Firebase] Nothing new to upload.");
            }

            // 4. Upload Replay Data (If exists and changed - simplest to just set it)
            // Replay Data is usually set once per paragraph or updated infrequently.
            if (this.replayData) {
                await db.ref('sessions/' + sessionId + '/replayData').set(this.replayData);
            }

            // console.log("[Firebase] Sync Complete! ✅");

        } catch (e) {
            console.error("[Firebase] Upload Failed", e);
            // Don't alert on background sync fail
        }
    }

    async exportChartImage(deviceType, startTime = 0, endTime = Infinity) {
        if (typeof Chart === 'undefined') return;

        const chartData = this.data.filter(d => d.t >= startTime && d.t <= endTime);
        if (chartData.length === 0) return;

        const cols = 1; const rows = 4;
        const chartWidth = 1000; const chartHeight = 350; const padding = 20;
        const totalWidth = chartWidth * cols; const totalHeight = (chartHeight + padding) * rows;
        const chartTypes = ['RawData', 'SmoothedData', 'Velocity', 'LineIndices'];

        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = totalWidth; mainCanvas.height = totalHeight;
        const ctx = mainCanvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, totalWidth, totalHeight);

        const times = chartData.map(d => d.t);
        const datasets = {
            RawX: chartData.map(d => d.x), RawY: chartData.map(d => d.y),
            SmoothX: chartData.map(d => d.gx), SmoothY: chartData.map(d => d.gy),
            VelX: chartData.map(d => d.vx), VelY: chartData.map(d => d.vy),
            LineIndex: chartData.map(d => d.lineIndex || null),
            AlgoLineIndex: chartData.map(d => d.detectedLineIndex || null)
        };

        const returnSweepIntervals = [];
        let rStart = null;
        for (let i = 0; i < chartData.length; i++) {
            if (chartData[i].isReturnSweep) {
                if (rStart === null) rStart = chartData[i].t;
            } else {
                if (rStart !== null) {
                    returnSweepIntervals.push({ start: rStart, end: chartData[i - 1].t });
                    rStart = null;
                }
            }
        }
        if (rStart !== null) returnSweepIntervals.push({ start: rStart, end: chartData[chartData.length - 1].t });

        const intervalPlugin = {
            id: 'intervalShading',
            beforeDatasetsDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                if (!chartArea) return;
                const x = scales.x;
                ctx.save();
                ctx.fillStyle = 'rgba(255, 0, 255, 0.15)';
                for (const it of returnSweepIntervals) {
                    const x0 = x.getPixelForValue(it.start);
                    const x1 = x.getPixelForValue(it.end);
                    if (Number.isFinite(x0) && Number.isFinite(x1)) {
                        const left = Math.min(x0, x1);
                        const right = Math.max(x0, x1);
                        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
                    }
                }
                ctx.restore();
            }
        };

        const lineStarts = []; const posMaxs = [];
        chartData.forEach(d => {
            if (d.extrema === 'LineStart') lineStarts.push({ x: d.t, y: d.gx });
            if (d.extrema === 'PosMax') posMaxs.push({ x: d.t, y: d.gx });
        });

        for (let i = 0; i < chartTypes.length; i++) {
            const chartName = chartTypes[i];
            const yOffset = i * (chartHeight + padding);
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = chartWidth; tempCanvas.height = chartHeight;
            const tCtx = tempCanvas.getContext('2d');
            tCtx.fillStyle = 'white'; tCtx.fillRect(0, 0, chartWidth, chartHeight);

            let configData = { labels: times, datasets: [] };
            let options = { responsive: false, animation: false, plugins: { title: { display: true, text: chartName }, legend: { display: true } }, layout: { padding: 10 }, scales: { x: { display: true }, y: { beginAtZero: false } } };

            if (chartName === 'RawData') {
                configData.datasets.push({ label: 'RawX', data: datasets.RawX, borderColor: 'blue', pointRadius: 0 });
                configData.datasets.push({ label: 'RawY', data: datasets.RawY, borderColor: 'orange', pointRadius: 0 });
            } else if (chartName === 'SmoothedData') {
                configData.datasets.push({ label: 'SmoothX', data: datasets.SmoothX, borderColor: 'dodgerblue' });
            } else if (chartName === 'Velocity') {
                configData.datasets.push({ label: 'VelX', data: datasets.VelX, borderColor: 'purple' });
            } else if (chartName === 'LineIndices') {
                configData.datasets.push({ label: 'LineIndex', data: datasets.LineIndex, borderColor: 'cyan' });
            }

            const chartConfig = { type: 'line', data: configData, options: options, plugins: [intervalPlugin] };
            await new Promise(resolve => {
                const chart = new Chart(tempCanvas, chartConfig);
                setTimeout(() => { ctx.drawImage(tempCanvas, 0, yOffset); chart.destroy(); resolve(); }, 100);
            });
        }
        /* [DISABLED] Auto-download chart image
    const link = document.createElement('a');
    link.download = `${deviceType}_gaze_chart_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.href = mainCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    */
    }

    detectLinesMobile(startTime = 0, endTime = Infinity) {
        if (this.data.length < 10) return 0;
        this.preprocessData();
        let startIndex = -1; let endIndex = -1;
        for (let i = 0; i < this.data.length; i++) {
            const t = this.data[i].t;
            if (t >= startTime && startIndex === -1) startIndex = i;
            if (t <= endTime) endIndex = i;
        }
        if (startIndex === -1 || endIndex === -1) return 0;

        const validDataSlice = this.data.slice(startIndex, endIndex + 1);
        const samples = validDataSlice.map(d => ({ ts_ms: d.t, velX: d.vx < 0 ? d.vx : 0 }));
        const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 1.5, gapMs: 120, expandOneSample: true });

        let lineNum = 1;
        return lineNum;
    }

    // --- UPDATED: SIMPLE PEAK-VALLEY TRIGGER (Immediate Fire) ---
    // Rule:
    // 1. Position Peak (Right side)
    // 2. Velocity Valley (Fast Left Movement)
    // 3. Cascade Check (Valley within 600ms of Peak) -> FIRE IMMEDIATELY
    detectRealtimeReturnSweep(lookbackMs = 2000) {
        try {
            const len = this.data.length;
            if (len < 5) return false;

            const d0 = this.data[len - 1]; // Current (t)
            const d1 = this.data[len - 2]; // Previous (t-1)
            const d2 = this.data[len - 3]; // Prev-Prev (t-2)
            const now = d0.t;

            // 1. Calculate Realtime SMOOTH X
            const smoothX = (d0.x * 0.5 + d1.x * 0.3 + d2.x * 0.2);
            d0.gx = smoothX;
            if (d1.gx === null) d1.gx = d1.x;
            if (d2.gx === null) d2.gx = d2.x;

            // -- STEP 0: PREPARE VELOCITY DATA --
            const repairVX = (d) => { if (d.vx === null || d.vx === undefined || isNaN(d.vx)) return 0; return d.vx; };
            if (d0.vx === null) { const dt = d0.t - d1.t; d0.vx = dt > 0 ? (d0.x - d1.x) / dt : 0; }
            const v0 = repairVX(d0);
            const v1 = repairVX(d1);
            const v2 = repairVX(d2);

            // -- STEP A: POSITION PEAK DETECTION --
            const sx0 = d0.gx || d0.x;
            const sx1 = d1.gx || d1.x;
            const sx2 = d2.gx || d2.x;

            // 1. Geometric Peak (3-point)
            const isPosPeak = (sx1 >= sx2) && (sx1 > sx0);

            // 2. Velocity Zero-Crossing (Plateau Peak)
            // If velocity goes from positive/zero to negative, we just passed a local maximum.
            const isVelZeroCrossDown = (v1 >= 0 && v0 < 0);

            if (isPosPeak || isVelZeroCrossDown) {
                this.lastPosPeakTime = d1.t;
            }

            // -- STEP B: VELOCITY VALLEY DETECTION --
            // Condition: v2 > v1 < v0 (V-Shape) AND v1 < -0.4 (Depth)
            const isVelValley = (v2 > v1) && (v1 < v0);
            const isDeepEnough = v1 < -0.4;

            // -- STEP C: CASCADE CHECK --
            // 1. GLOBAL GATE: Content Start Check
            // Prevent triggers before the user has actually started reading (looked at a line).
            if (!this.firstContentTime || now < this.firstContentTime) return false;

            // 2. GLOBAL GATE: Last Line Check REMOVED
            // We rely on 'Max Reach Check' to handle duplicate firing on the last line.
            // The transition INTO the last line (N-1 -> N) is a valid sweep and should fire.

            // 3. COOLDOWN: 500ms (Reduced significantly since we have Logic Guard)
            if (this.lastTriggerTime && (now - this.lastTriggerTime < 500)) return false;


            if (isVelValley && isDeepEnough) {
                const timeSincePeak = d1.t - this.lastPosPeakTime;

                // 4. Time Window Check (±600ms)
                if (Math.abs(timeSincePeak) < 600) {

                    // -- STEP D: LOGIC GUARD (V10.0 - SMART & SIMPLE) --

                    if (d0.lineIndex !== undefined && d0.lineIndex !== null) {

                        // Rule 1: START LINE BLOCK
                        if (d0.lineIndex === 0) {
                            return false;
                        }

                        // Rule 2: Max Reach Check (Monotonic)
                        if (d0.lineIndex <= this.maxLineIndexReached) {
                            // DEBUG: Log rejection
                            // console.log(`[RS Reject] Line ${d0.lineIndex} <= Max ${this.maxLineIndexReached}`);
                            return false;
                        }

                        // Legacy Rule 3 Removed.

                    } else {
                        // If lineIndex is null (transition), we act conservatively and DO NOT fire.
                        // console.log("[RS Reject] Null Line Index");
                        return false;
                    }

                    // -- FIRE --
                    this._fireEffect("Immediate", v1);
                    d0.rsState = "Immediate_Success";

                    // Update Guard State (New High Score)
                    this.lastPosPeakTime = 0;
                    this.maxLineIndexReached = d0.lineIndex;

                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    _fireEffect(type, vx) {

        // Find the most recent data point (now)
        const d0 = this.data[this.data.length - 1];

        // Update Cooldown Timer
        this.lastTriggerTime = d0.t;

        d0.didFire = true;
        d0.rsTriggerType = type;

        console.log(`[RS] 💥 TRIGGER! (${type}) VX:${vx.toFixed(2)} at ${d0.t}ms`);

        // Determine Target Line (The line just finished)
        // Return Sweep means we moved FROM line N TO line N+1. We want to mark line N.
        const targetLine = (d0.lineIndex > 0) ? d0.lineIndex - 1 : 0;

        // [NEW] Log for Replay
        if (this.pangLog) {
            this.pangLog.push({
                t: d0.t,
                lineIndex: targetLine,
                type: type,
                vx: vx
            });
        }

        // 1. Visual Effect (Existing)
        if (window.Game && window.Game.typewriter && window.Game.typewriter.renderer &&
            typeof window.Game.typewriter.renderer.triggerReturnEffect === 'function') {

            // [Fix 1] Only trigger visual effect if we are actively reading (screen-read active)
            // This prevents Pang effects during Boss Battles or Transitions.
            const readScreen = document.getElementById('screen-read');
            if (readScreen && readScreen.classList.contains('active')) {
                window.Game.typewriter.renderer.triggerReturnEffect(targetLine);
            }
        }

        // 2. Game Reward (New: Ink +10) via Event Bus
        // DECOUPLED: No direct Game.addInk call.
        if (bus) {
            bus.emit('pang');
        }

        // --- RGT: Update 'b' (Global Max X) & Reset 'a' ---
        // 1. Update Global Max (b) with current X (End of Line)
        if (d0.x > this.globalMaxX) {
            this.globalMaxX = d0.x;
            // console.log(`[RGT] New Global Max (b): ${this.globalMaxX}`);
        }

        // 2. Start Collecting New Min X (a) for Next Line
        this.currentLineMinX = 99999;
        this.isCollectingLineStart = true;
        setTimeout(() => {
            this.isCollectingLineStart = false;
            // console.log(`[RGT] Line Start (a) Locked: ${this.currentLineMinX}`);
        }, 200);

        // --- 3. GAZE-BASED WPM CALCULATION (User Spec) ---
        // Logic:
        // 1. Only lines with Purple Circle (RS) are valid.
        // 2. Measure Time Interval & Word Count for valid lines.
        // 3. Accumulate and Calculate WPM.

        if (window.Game && window.Game.typewriter && window.Game.typewriter.renderer) {
            const renderer = window.Game.typewriter.renderer;
            const lines = renderer.lines;

            // Check 2.3: Skip Last Line
            // If targetLine is the last line (or greater), we ignore it per user request.
            // (Last line usually doesn't have a distinct RS to a "next" line, or ends the paragraph)
            if (lines && lines.length > 0 && targetLine < lines.length - 1) {

                // Get Word Count for this line
                const lineObj = lines[targetLine];
                const wordCount = (lineObj && lineObj.wordIndices) ? lineObj.wordIndices.length : 0;

                let duration = 0;
                const now = d0.t;

                // Determine Time Interval
                // Case 2.2: Continuous Chain (Previous line was also valid RS)
                if (this.lastRSLine === targetLine - 1 && this.lastRSTime > 0) {
                    duration = now - this.lastRSTime;
                    // console.log(`[WPM] Chain: Line ${targetLine} (Duration: ${duration}ms)`);
                }
                // Case 2.1: Gap or First Line
                else {
                    // Find "First Char Time" -> Backward Search in Data for start of this line
                    let startTime = now;
                    // Look back up to 20 seconds, but NOT beyond current paragraph start
                    const limit = Math.max(this.searchStartIndex || 0, this.data.length - 1500);
                    for (let i = this.data.length - 1; i >= limit; i--) {
                        if (this.data[i].lineIndex === targetLine) {
                            startTime = this.data[i].t;
                        } else if (this.data[i].lineIndex < targetLine) {
                            // Moved to previous line, stop
                            break;
                        }
                    }

                    // Fallback: If startTime is still now (scan failed), use firstContentTime for line 0
                    if (startTime === now && targetLine === 0 && this.firstContentTime) {
                        startTime = this.firstContentTime;
                    }

                    duration = now - startTime;
                    // console.log(`[WPM] Gap/First: Line ${targetLine} (Start: ${startTime}, End: ${now}, Dur: ${duration}ms)`);
                }

                // Sanity Check: Ignore impossibly short lines (< 100ms) to prevent noise
                if (duration > 100 && wordCount > 0) {

                    // [NEW] Ignore First Pang of Each Paragraph
                    // The first transition (whether 0->1 or 0->2 skip) is often unstable or includes warm-up.
                    this.pangCountInPara++;

                    if (this.pangCountInPara > 1) {
                        // [FIX] Exclude Line 0 logic is now redundant if we skip first pang, 
                        // but kept for safety if pangCount logic changes.
                        if (targetLine > 0) {
                            this.validTimeSum += duration;
                            this.validWordSum += wordCount;
                        }
                    } else {
                        console.log(`[WPM] Skipping First Pang of Paragraph (Line ${targetLine})`);
                    }

                    // 4. Calculate WPM (Only if we have valid lines > 0)
                    const minutes = this.validTimeSum / 60000;
                    if (minutes > 0 && this.validWordSum > 0) {
                        this.wpm = Math.round(this.validWordSum / minutes);

                        // [NEW] WPM Data Logging
                        if (!this.wpmData) this.wpmData = [];
                        this.wpmData.push({
                            paraIndex: (this.context && this.context.paraIndex !== undefined) ? this.context.paraIndex : -1, // [NEW] Tag Paragraph
                            lineIndex: targetLine,
                            startTime: Math.round(now - duration), // Keep raw data in log
                            endTime: now,
                            duration: duration,
                            words: wordCount,
                            wpm: this.wpm // This will be the cumulative WPM (unchanged for Line 0)
                        });

                        console.log(`[WPM] Updated: ${this.wpm} (Line: ${targetLine}, Words: ${this.validWordSum}, Time: ${this.validTimeSum}ms)`);
                    }

                    // Update State
                    this.lastRSTime = now;
                    this.lastRSLine = targetLine;

                    // 5. Real-time Update HUD
                    if (window.Game && window.Game.typewriter && typeof window.Game.typewriter.updateWPM === 'function') {
                        window.Game.typewriter.updateWPM();
                    }
                }
            } else {
                console.log(`[WPM] Skipping Last/Invalid Line: ${targetLine} (Total: ${lines.length})`);
            }
        }
    }
}
