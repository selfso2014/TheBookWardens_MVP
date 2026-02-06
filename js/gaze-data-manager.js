
/**
 * Gaze Data Management
 * Stores and processes raw gaze data into structured format with Gaussian smoothing and velocity calculation.
 */
import { detectVelXSpikes } from "./velx-spike-detector.js";

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
    }

    /**
     * Process a single gaze frame from SeeSo SDK
     */
    processGaze(gazeInfo) {
        if (!gazeInfo) return;

        // Initialize start time
        if (this.firstTimestamp === null) {
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
            ...(this.context || {})
        };

        this.data.push(entry);

        // REAL-TIME VELOCITY CALC
        if (this.data.length > 1) {
            const prev = this.data[this.data.length - 2];
            const curr = this.data[this.data.length - 1];
            const dt = curr.t - prev.t;
            if (dt > 0) {
                curr.vx = (curr.x - prev.x) / dt;
                curr.vy = (curr.y - prev.y) / dt;
            } else {
                curr.vx = 0;
                curr.vy = 0;
            }
        }

        if (this.data.length % 60 === 0) console.log("[GazeData] Count:", this.data.length);
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
                } else if (prevIdx >= 0) {
                    curr.x = this.data[prevIdx].x;
                    curr.y = this.data[prevIdx].y;
                } else if (nextIdx < this.data.length) {
                    curr.x = this.data[nextIdx].x;
                    curr.y = this.data[nextIdx].y;
                }
            }
        }

        // 2. Gaussian Smoothing (Sigma=3)
        const sigma = 3;
        const radius = Math.ceil(3 * sigma);
        const kernelSize = 2 * radius + 1;
        const kernel = new Float32Array(kernelSize);
        let sumK = 0;
        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            const val = Math.exp(-(x * x) / (2 * sigma * sigma));
            kernel[i] = val;
            sumK += val;
        }
        for (let i = 0; i < kernelSize; i++) kernel[i] /= sumK;

        for (let i = 0; i < this.data.length; i++) {
            let sumX = 0, sumY = 0, wSum = 0;
            for (let k = 0; k < kernelSize; k++) {
                const idx = i + (k - radius);
                if (idx >= 0 && idx < this.data.length) {
                    sumX += this.data[idx].x * kernel[k];
                    sumY += this.data[idx].y * kernel[k];
                    wSum += kernel[k];
                }
            }
            this.data[i].gx = sumX / wSum;
            this.data[i].gy = sumY / wSum;
        }

        // 3. Velocity Calculation
        for (let i = 0; i < this.data.length; i++) {
            if (i === 0) {
                this.data[i].vx = 0;
                this.data[i].vy = 0;
            } else {
                const dt = this.data[i].t - this.data[i - 1].t;
                if (dt > 0) {
                    this.data[i].vx = (this.data[i].x - this.data[i - 1].x) / dt;
                    this.data[i].vy = (this.data[i].y - this.data[i - 1].y) / dt;
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

        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,InkY_Px,AlgoLineIndex,TargetY_Px,AvgCoolGazeY_Px,ReplayX,ReplayY,InkSuccess,DidFire,Debug_Median,Debug_Threshold,Debug_RealtimeVX\n";
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

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute("download", `${deviceType}_gaze_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.exportChartImage(deviceType, startTime, endTime);
    }

    async uploadToCloud(sessionId) {
        if (!window.firebase || !window.FIREBASE_CONFIG) {
            console.error("[Firebase] SDK or Config not loaded.");
            alert("Firebase not configured. Cannot upload.");
            return;
        }
        console.log(`[Firebase] Uploading session [${sessionId}]...`);
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
            this.preprocessData();
            const rawPayload = {
                meta: {
                    timestamp: Date.now(),
                    userAgent: navigator.userAgent,
                    lineMetadata: this.lineMetadata,
                    totalSamples: this.data.length
                },
                data: this.data
            };
            const payload = JSON.parse(JSON.stringify(rawPayload, (key, value) => {
                if (typeof value === 'number' && isNaN(value)) return null;
                return value;
            }));
            const db = firebase.database();
            await db.ref('sessions/' + sessionId).set(payload);
            console.log("[Firebase] Upload Complete! ✅");
            const toast = document.createElement("div");
            toast.innerText = `☁️ Cloud Upload Done: ${sessionId}`;
            toast.style.cssText = "position:fixed; bottom:50px; left:50%; transform:translateX(-50%); background:#0d47a1; color:white; padding:10px 20px; border-radius:20px; z-index:99999;";
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } catch (e) {
            console.error("[Firebase] Upload Failed", e);
            alert(`Upload Failed: ${e.message}`);
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
        const link = document.createElement('a');
        link.download = `${deviceType}_gaze_chart_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        link.href = mainCanvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

    // --- NEW: MAX-MIN CASCADE TRIGGER ---
    // Rule:
    // 1. Detect Position Peak (SmoothX Rising -> Falling)
    // 2. Detect Velocity Valley (VelX Falling -> Rising & Deeper than -0.4)
    // 3. Trigger IF Valley happens within 200ms of Peak
    detectRealtimeReturnSweep(lookbackMs = 2000) {
        try {
            const len = this.data.length;
            if (len < 5) return false;

            const d0 = this.data[len - 1]; // Current (t)
            const d1 = this.data[len - 2]; // Previous (t-1)
            const d2 = this.data[len - 3]; // Prev-Prev (t-2)
            const now = d0.t;

            // 1. Calculate Realtime SMOOTH X (Approximate)
            // Note: Full Gaussian is expensive, use simple weighted avg for realtime smoothing
            // Or assume raw x is okay if smoothed offline? No, we need smoothness.
            // Let's use 3-tap avg for realtime smooth X to detect peaks reliably.
            const smoothX = (d0.x * 0.5 + d1.x * 0.3 + d2.x * 0.2); // Simple Low Pass
            d0.gx = smoothX; // Store it (approx)
            if (d1.gx === null) d1.gx = d1.x; // Fallback
            if (d2.gx === null) d2.gx = d2.x;

            // -- STEP A: POSITION PEAK DETECTION --
            // Condition: Prev (d2~d1) was rising, Now (d1~d0) is falling?
            // Actually, we are at t. Peak happened at t-1 if d2 < d1 > d0.
            // Let's use smoothed values
            const sx0 = d0.gx || d0.x;
            const sx1 = d1.gx || d1.x;
            const sx2 = d2.gx || d2.x;

            const isPosPeak = (sx1 > sx2) && (sx1 > sx0);
            if (isPosPeak) {
                this.lastPosPeakTime = d1.t;
                // console.log(`[RS] Peak at ${d1.t}`);
            }

            // -- STEP B: VELOCITY VALLEY DETECTION --
            // Instant Velocity Calculation
            const repairVX = (d) => { if (d.vx === null || d.vx === undefined || isNaN(d.vx)) return 0; return d.vx; };
            if (d0.vx === null) { const dt = d0.t - d1.t; d0.vx = dt > 0 ? (d0.x - d1.x) / dt : 0; }

            const v0 = repairVX(d0); // t
            const v1 = repairVX(d1); // t-1 (Possible Valley)
            const v2 = repairVX(d2); // t-2

            // Condition: v2 > v1 < v0 (V-Shape) AND v1 < -0.4 (Depth)
            const isVelValley = (v2 > v1) && (v1 < v0);
            const isDeepEnough = v1 < -0.4;

            // -- STEP C: CASCADE CHECK --
            if (this.lastTriggerTime && (now - this.lastTriggerTime < 300)) return false;

            if (isVelValley && isDeepEnough) {
                const timeSincePeak = d1.t - this.lastPosPeakTime;
                // Validation: Must occur within 200ms of a Position Peak
                if (timeSincePeak > 0 && timeSincePeak < 200) {
                    this.lastTriggerTime = now;
                    d0.didFire = true;
                    console.log(`[RS] 💥 CASCADE TRIGGER! Peak->Valley: ${timeSincePeak}ms | VX:${v1.toFixed(2)}`);
                    // Reset Peak Time to prevent double firing? (Optional, but safe)
                    this.lastPosPeakTime = 0;
                    return true;
                } else {
                    // Valley detected but no preceding peak? Maybe just noise or non-reading saccade.
                    // console.log(`[RS] Ignored Valley (No Peak). dt: ${timeSincePeak}ms`);
                }
            }
            return false;

        } catch (e) {
            console.error("[ReturnSweep Error]", e);
            return false;
        }
    }

    logDebugEvent(key, val) {
        if (this.data.length > 0) {
            this.data[this.data.length - 1][key] = val;
        }
    }
}
