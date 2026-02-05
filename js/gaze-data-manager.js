
/**
 * Gaze Data Management
 * Stores and processes raw gaze data into structured format with Gaussian smoothing and velocity calculation.
 */
import { detectVelXSpikes } from "./velx-spike-detector.js";

export class GazeDataManager {
    constructor() {
        this.data = []; // { t, x, y, gx, gy, vx, vy, gvx, gvy, type ... }
        this.buffer = []; // for smoothing window
        // 5-tap kernel approx for Gaussian
        this.KERNEL = [0.05, 0.25, 0.4, 0.25, 0.05];
        this.firstTimestamp = null;
        this.context = {}; // Initialize context
        this.lineMetadata = {}; // Store per-line metadata (Ink success, coverage, etc.)
    }

    /**
     * Process a single gaze frame from SeeSo SDK
     * @param {Object} gazeInfo - GazeInfo object from SeeSo SDK
     */
    processGaze(gazeInfo) {
        if (!gazeInfo) return;

        // Initialize start time
        if (this.firstTimestamp === null) {
            this.firstTimestamp = gazeInfo.timestamp;
        }

        // Relative timestamp in ms (integer)
        const t = Math.floor(gazeInfo.timestamp - this.firstTimestamp);
        const x = gazeInfo.x;
        const y = gazeInfo.y;

        // Ensure valid numbers (NaN or non-numbers check)
        // Store as RAW, even if NaN or 0,0. Preprocessing will handle gaps.

        // 3. Eye Movement Classification
        // 0: Fixation, 2: Saccade, Others: Unknown

        // 3. Eye Movement Classification
        // 0: Fixation, 2: Saccade, Others: Unknown
        let type = 'Unknown';
        if (gazeInfo.eyemovementState === 0) type = 'Fixation';
        else if (gazeInfo.eyemovementState === 2) type = 'Saccade';

        // We will calculate velocity in post-processing to refine type if needed.

        const entry = {
            t,
            x, y,
            // Pre-allocate fields for post-processing
            gx: null, gy: null,
            vx: null, vy: null,
            targetY: null, avgY: null, // Persisted Analysis Data
            type,
            // Original raw fixation from SDK if present
            sdkFixationX: gazeInfo.fixationX,
            sdkFixationY: gazeInfo.fixationY,
            // Context data (LineIndex, CharIndex, InkY)
            ...(this.context || {})
        };

        this.data.push(entry);

        // REAL-TIME VELOCITY CALC (Critical for Return Sweep Detection)
        if (this.data.length > 1) {
            const prev = this.data[this.data.length - 2];
            const curr = this.data[this.data.length - 1];
            // Simple finite difference (Raw)
            const dt = curr.t - prev.t;
            if (dt > 0) {
                curr.vx = (curr.x - prev.x) / dt;
                curr.vy = (curr.y - prev.y) / dt;
            } else {
                curr.vx = 0;
                curr.vy = 0;
            }
        }

        // Debug Log (Raw Stream Check)
        // User Request: "콘솔로 시선좌표 및 fixation saccade인지 띄워라."
        // console.log(`[GazeRaw] Frame T:${t} | (${x.toFixed(1)}, ${y.toFixed(1)}) | Type: ${type} | State: ${gazeInfo.eyemovementState}`);

        // Debug Log (Every ~1 sec aka 60 frames)
        if (this.data.length % 60 === 0) console.log("[GazeData] Count:", this.data.length, "Latest VX:", entry.vx ? entry.vx.toFixed(2) : "null");
    }

    /**
     * Post-processing: Interpolation -> Smoothing -> Velocity
     * Called before Line Detection or CSV Export
     */
    preprocessData() {
        if (this.data.length < 2) return;

        // 1. Interpolation (Fill Gaps / NaN / 0,0)
        for (let i = 0; i < this.data.length; i++) {
            const curr = this.data[i];
            const isMissing = isNaN(curr.x) || isNaN(curr.y) || (curr.x === 0 && curr.y === 0) || typeof curr.x !== 'number';

            if (isMissing) {
                // Find prev valid
                let prevIdx = i - 1;
                while (prevIdx >= 0) {
                    const p = this.data[prevIdx];
                    if (typeof p.x === 'number' && !isNaN(p.x) && !isNaN(p.y) && (p.x !== 0 || p.y !== 0)) break;
                    prevIdx--;
                }

                // Find next valid
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
        // Kernel: size = 6*3 + 1 = 19
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

        // Apply Smoothing to X and Y
        // We can write directly to data[i].gx, data[i].gy
        // But need to read from raw x/y.
        // To avoid boundary issues, handle edges carefully or just clamp.
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

        // 3. Velocity Calculation (Based on Smoothed Data)
        // Simple finite difference: v[i] = (p[i] - p[i-1]) /dt
        for (let i = 0; i < this.data.length; i++) {
            if (i === 0) {
                this.data[i].vx = 0;
                this.data[i].vy = 0;
            } else {
                const dt = this.data[i].t - this.data[i - 1].t;
                if (dt > 0) {
                    // User Request: Use Raw X/Y (Interpolated) for Velocity Calculation
                    this.data[i].vx = (this.data[i].x - this.data[i - 1].x) / dt; // px/ms
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

    /**
     * Store metadata for a specific line (e.g., Ink success status)
     * @param {number} lineIndex 
     * @param {Object} metadata 
     */
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
    }

    getCharIndexTimeRange() {
        let startTime = null;
        let endTime = null;

        for (let i = 0; i < this.data.length; i++) {
            const d = this.data[i];
            // Check if charIndex is valid (not null/undefined)
            // Note: charIndex 0 is valid.
            if (d.charIndex !== undefined && d.charIndex !== null) {
                if (startTime === null) startTime = d.t;
                endTime = d.t;
            }
        }

        if (startTime === null) return { startTime: 0, endTime: Infinity };
        return { startTime, endTime };
    }

    exportCSV(startTime = 0, endTime = Infinity) {
        if (!this.data || this.data.length === 0) {
            alert("No gaze data to export.");
            return;
        }

        // Ensure data is preprocessed (Interpolated, Smoothed, Velocity) before export
        this.preprocessData();

        // RUN ADVANCED LINE DETECTION (MAD Algorithm) automatically
        // This populates 'detectedLineIndex' and 'isReturnSweep' fields
        this.detectLinesMobile(startTime, endTime);

        // Create Map for Target Y (Ref Y) from Game.typewriter
        const targetYMap = {};
        if (window.Game && window.Game.typewriter && window.Game.typewriter.lineYData) {
            window.Game.typewriter.lineYData.forEach(item => {
                targetYMap[item.lineIndex] = item.y;
            });
        }

        // Calculate Average SmoothY (gy) per LineIndex
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
            if (lineYCount[k] > 0) {
                lineYAvg[k] = lineYSum[k] / lineYCount[k];
            }
        });

        // CSV Header
        // CSV Header
        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,InkY_Px,AlgoLineIndex,Extrema,TargetY_Px,AvgCoolGazeY_Px,ReplayX,ReplayY,InkSuccess,InkCoverage_Px,isLagFix,IsArmed,DidFire,Debug_Samples,Debug_Median,Debug_Threshold,Debug_RealtimeVX\n";

        // Rows
        this.data.forEach(d => {
            if (d.t < startTime || d.t > endTime) return;

            // Get Metadata
            const lIdx = d.lineIndex;
            let targetY = "";
            let avgY = "";

            if (lIdx !== undefined && lIdx !== null) {
                // Store in Data Structure Permanently
                d.targetY = targetYMap[lIdx] !== undefined ? targetYMap[lIdx] : null;

                // V18 Fix: Preserve pre-calculated avgY from Game.js if available
                if (d.avgY === undefined || d.avgY === null) {
                    d.avgY = lineYAvg[lIdx] !== undefined ? parseFloat(lineYAvg[lIdx].toFixed(2)) : null;
                }

                targetY = d.targetY !== null ? d.targetY : "";
                avgY = d.avgY !== null ? d.avgY : "";
            }

            const row = [
                d.t,
                d.x, d.y,
                d.gx !== undefined && d.gx !== null ? d.gx.toFixed(2) : "",
                d.gy !== undefined && d.gy !== null ? d.gy.toFixed(2) : "",
                d.vx !== undefined && d.vx !== null ? d.vx.toFixed(4) : "",
                d.vy !== undefined && d.vy !== null ? d.vy.toFixed(4) : "",
                d.type,
                (d.isReturnSweep ? "TRUE" : ""),
                (d.lineIndex !== undefined && d.lineIndex !== null) ? d.lineIndex : "",
                (d.charIndex !== undefined && d.charIndex !== null) ? d.charIndex : "",
                (d.inkY !== undefined && d.inkY !== null) ? d.inkY.toFixed(0) : "",
                (d.detectedLineIndex !== undefined) ? d.detectedLineIndex : "",
                (d.extrema !== undefined) ? d.extrema : "",
                targetY,
                avgY,
                (d.rx !== undefined && d.rx !== null) ? d.rx.toFixed(2) : "",
                (d.ry !== undefined && d.ry !== null) ? d.ry.toFixed(2) : "",
                (this.lineMetadata[lIdx] && this.lineMetadata[lIdx].success) ? "TRUE" : "FALSE",
                (this.lineMetadata[lIdx] && this.lineMetadata[lIdx].coverage !== undefined) ? this.lineMetadata[lIdx].coverage.toFixed(0) : "",
                (d.isLagCorrection ? "TRUE" : ""),
                (d.isArmed ? "TRUE" : ""),
                (d.didFire ? "TRUE" : ""),
                (d.debugSamples !== undefined) ? d.debugSamples : "",
                (d.debugMedian !== undefined) ? d.debugMedian.toFixed(3) : "",
                (d.debugThreshold !== undefined) ? d.debugThreshold.toFixed(3) : "",
                (d.debugVX !== undefined) ? d.debugVX.toFixed(3) : ""
            ];
            csv += row.join(",") + "\n";
        });

        // Detect Device Type for Filename
        const ua = navigator.userAgent.toLowerCase();
        let deviceType = "desktop";
        if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
            deviceType = "smartphone";
        } else if (/tablet|ipad|playbook|silk/i.test(ua)) {
            deviceType = "tablet";
        }

        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute("download", `${deviceType}_gaze_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Also export chart image with same range
        this.exportChartImage(deviceType, startTime, endTime);
    }

    async exportChartImage(deviceType, startTime = 0, endTime = Infinity) {
        if (typeof Chart === 'undefined') {
            console.warn("Chart.js is not loaded. Skipping chart export.");
            return;
        }

        // Filter Data for Chart
        const chartData = this.data.filter(d => d.t >= startTime && d.t <= endTime);
        if (chartData.length === 0) {
            console.warn("No data for chart export in range.");
            return;
        }

        // Configuration: 4 Charts (Raw, Smooth, Vel, LineIndex)
        // 1. Raw X/Y + Events
        // 2. Smooth X/Y
        // 3. Velocity X/Y
        // 4. Line Index / Algo Index
        const cols = 1;
        const rows = 4;
        const chartWidth = 1000;
        const chartHeight = 350; // Increased height to prevent overlap
        const padding = 20; // Padding between charts
        const totalWidth = chartWidth * cols;
        const totalHeight = (chartHeight + padding) * rows;

        const chartTypes = ['RawData', 'SmoothedData', 'Velocity', 'LineIndices'];

        // Create a single large canvas to draw everything on
        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = totalWidth;
        mainCanvas.height = totalHeight;
        const ctx = mainCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, totalWidth, totalHeight);

        // Prepare Data Arrays
        const times = chartData.map(d => d.t);
        const datasets = {
            RawX: chartData.map(d => d.x),
            RawY: chartData.map(d => d.y),
            SmoothX: chartData.map(d => d.gx),
            SmoothY: chartData.map(d => d.gy),
            VelX: chartData.map(d => d.vx),
            VelY: chartData.map(d => d.vy),
            LineIndex: chartData.map(d => d.lineIndex || null),
            AlgoLineIndex: chartData.map(d => d.detectedLineIndex || null)
        };

        // Identify Return Sweep Intervals for Shading
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

        // Helper for intervals
        const intervalPlugin = {
            id: 'intervalShading',
            beforeDatasetsDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                if (!chartArea) return;
                const x = scales.x;
                ctx.save();
                ctx.fillStyle = 'rgba(255, 0, 255, 0.15)'; // Magenta tint for Return Sweeps

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

        // Extrema Points (Filtered)
        const lineStarts = [];
        const posMaxs = [];
        const ignValleys = [];
        const ignPeaks = [];

        chartData.forEach(d => {
            if (d.extrema === 'LineStart') lineStarts.push({ x: d.t, y: d.gx });
            if (d.extrema === 'PosMax') posMaxs.push({ x: d.t, y: d.gx });
            // Assuming ignored are still relevant? If not, skip.
        });

        // Loop through each chart type
        for (let i = 0; i < chartTypes.length; i++) {
            const chartName = chartTypes[i];
            const yOffset = i * (chartHeight + padding); // Include padding

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = chartWidth;
            tempCanvas.height = chartHeight;

            // Explicitly Fill White Background on Temp Canvas
            const tCtx = tempCanvas.getContext('2d');
            tCtx.fillStyle = 'white';
            tCtx.fillRect(0, 0, chartWidth, chartHeight);

            let configData = { labels: times, datasets: [] };
            let options = {
                responsive: false,
                animation: false,
                plugins: {
                    title: { display: true, text: chartName, font: { size: 16 } },
                    legend: { display: true, position: 'top' }
                },
                layout: {
                    padding: { left: 10, right: 10, top: 10, bottom: 10 }
                },
                scales: {
                    x: { display: true, ticks: { maxTicksLimit: 20 } },
                    y: { beginAtZero: false }
                }
            };

            // Build Datasets per Chart Type
            if (chartName === 'RawData') {
                configData.datasets.push(
                    { label: 'RawX', data: datasets.RawX, borderColor: 'blue', borderWidth: 1, pointRadius: 0 },
                    { label: 'RawY', data: datasets.RawY, borderColor: 'orange', borderWidth: 1, pointRadius: 0 }
                );
                // Add Extrema Markers
                configData.datasets.push(
                    { label: 'LineStart', data: lineStarts, type: 'scatter', backgroundColor: 'green', pointRadius: 5, pointStyle: 'triangle', rotation: 180 },
                    { label: 'PosMax', data: posMaxs, type: 'scatter', backgroundColor: 'red', pointRadius: 5, pointStyle: 'triangle' }
                );
            } else if (chartName === 'SmoothedData') {
                configData.datasets.push(
                    { label: 'SmoothX', data: datasets.SmoothX, borderColor: 'dodgerblue', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 5] },
                    { label: 'SmoothY', data: datasets.SmoothY, borderColor: 'darkorange', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 5] }
                );
            } else if (chartName === 'Velocity') {
                configData.datasets.push(
                    { label: 'VelX', data: datasets.VelX, borderColor: 'purple', borderWidth: 1, pointRadius: 0 },
                    { label: 'VelY', data: datasets.VelY, borderColor: 'brown', borderWidth: 1, pointRadius: 0 }
                );
            } else if (chartName === 'LineIndices') {
                configData.datasets.push(
                    { label: 'LineIndex', data: datasets.LineIndex, borderColor: 'cyan', borderWidth: 2, pointRadius: 1, stepped: true },
                    { label: 'AlgoLineIndex', data: datasets.AlgoLineIndex, borderColor: 'magenta', borderWidth: 2, pointRadius: 2, pointStyle: 'crossRot', showLine: false }
                );
            }

            const chartConfig = {
                type: 'line',
                data: configData,
                options: options,
                plugins: [intervalPlugin] // Apply shading to all charts
            };

            // Render
            await new Promise(resolve => {
                const chart = new Chart(tempCanvas, chartConfig);
                setTimeout(() => {
                    ctx.drawImage(tempCanvas, 0, yOffset);
                    chart.destroy();
                    resolve();
                }, 100);
            });
        }

        // Download Main Canvas
        const link = document.createElement('a');
        link.download = `${deviceType}_gaze_chart_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        link.href = mainCanvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // --- Line Detection Algorithm (MAD-based) ---
    detectLinesMobile(startTime = 0, endTime = Infinity) {
        if (this.data.length < 10) return 0;
        this.preprocessData(); // Ensure velX is calculated

        // 1. Find the index range in the global array
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < this.data.length; i++) {
            const t = this.data[i].t;
            if (t >= startTime && startIndex === -1) startIndex = i;
            if (t <= endTime) endIndex = i;
        }

        if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
            console.warn("[GazeDataManager] No data in specified time range.");
            return 0;
        }

        const validDataSlice = this.data.slice(startIndex, endIndex + 1);
        if (validDataSlice.length < 10) return 0;

        // 2. Prepare samples using NEGATIVE VELOCITY ONLY
        // High WPM creates high positive velocity, which inflates MAD and hides return sweeps.
        // By zeroing out positive velocity, we treat reading as "silence" and return sweeps as "signal".
        const samples = validDataSlice.map(d => ({
            ts_ms: d.t,
            velX: d.vx < 0 ? d.vx : 0
        }));

        // 3. Detect Spikes using MAD (Sensitivity k=1.5)
        // With positive velocities removed, the baseline noise is low. Revert k to 3.0 to avoid noise.
        const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 1.5, gapMs: 120, expandOneSample: true });
        console.log(`[GazeDataManager] Running MAD with k=1.5 on ${samples.length} samples.`);

        // 4. Identify Potential Return Sweeps (First Pass: Displacement & Basic Validity)
        const candidates = spikeIntervals.filter(interval => {
            // Check Displacement (Distinguish Return Sweep from Regression)
            // interval.startIndex/endIndex are relative to validDataSlice
            if (validDataSlice[interval.startIndex] && validDataSlice[interval.endIndex]) {
                const startX = validDataSlice[interval.startIndex].gx;
                const endX = validDataSlice[interval.endIndex].gx;
                const displacement = startX - endX; // Moving Left: Start > End, so Disp > 0

                // Threshold: 100px (Assumes Return Sweep covers significant screen width)
                if (displacement < 100) return false;
            } else {
                return false;
            }
            return true;
        });

        // Sort by time
        candidates.sort((a, b) => a.start_ms - b.start_ms);

        // --- Advanced Validation (Algorithm 1 & 2) ---
        // 0. Dynamic Threshold Calculation (Algorithm 2)
        // Calculate MIN_LINE_DURATION based on the shortest observed line reading duration (50% of min).
        let observedMinLineDur = Infinity;
        let curLineIdxForDur = -1;
        let curLineStartTForDur = -1;

        for (let i = 0; i < validDataSlice.length; i++) {
            const d = validDataSlice[i];
            // Check for valid LineIndex
            if (d.lineIndex !== null && d.lineIndex !== undefined && d.lineIndex !== "") {
                const idx = Number(d.lineIndex);
                if (idx !== curLineIdxForDur) {
                    // Line Change Detected
                    if (curLineIdxForDur !== -1) {
                        const duration = d.t - curLineStartTForDur;
                        // Filter out noise/glitches (e.g. < 50ms) to avoid setting threshold too low
                        if (duration > 50 && duration < observedMinLineDur) {
                            observedMinLineDur = duration;
                        }
                    }
                    curLineIdxForDur = idx;
                    curLineStartTForDur = d.t;
                }
            }
        }

        // Fallback default if no multi-line data found
        if (observedMinLineDur === Infinity) observedMinLineDur = 300;

        const MIN_LINE_DURATION = observedMinLineDur * 0.5;
        console.log(`[GazeDataManager] Dynamic Threshold: MinObserved=${observedMinLineDur}ms -> Threshold=${MIN_LINE_DURATION}ms`);

        const validSweeps = [];
        let currentLineNum = 1;
        let lastSweepEndTime = -Infinity;

        // Ensure LineIndex integrity (Carry-Forward) for validation
        // We do this locally on the slice to avoid mutating global state permanently if not desired, 
        // but for 'detectLines', we want best best effort.
        let lastKnownLineIndex = null;
        for (let i = 0; i < validDataSlice.length; i++) {
            const d = validDataSlice[i];
            if (d.lineIndex !== null && d.lineIndex !== undefined && d.lineIndex !== "") {
                lastKnownLineIndex = d.lineIndex;
            } else if (lastKnownLineIndex !== null) {
                // Determine if we should fill in? For validation purposes, yes.
                // But we just need it during the sweep check.
            }
        }

        for (const sweep of candidates) {
            // Get Data Point at Sweep Start (for Context Check)
            const sweepData = validDataSlice[sweep.startIndex];
            const sweepTime = sweepData.t;

            // --- Algorithm 2: Time Gap Validation ---
            const timeSinceLast = sweepData.t - lastSweepEndTime;
            if (validSweeps.length > 0 && timeSinceLast < MIN_LINE_DURATION) {
                console.log(`[Reject Sweep] Rapid Fire: dt=${timeSinceLast}ms < ${MIN_LINE_DURATION}ms at T=${sweepTime}`);
                continue;
            }

            // --- Algorithm 1: LineNum Constraint with Strong Sweep Override ---
            let currentLineIndex = sweepData.lineIndex;
            if (currentLineIndex === null || currentLineIndex === undefined) {
                for (let k = sweep.startIndex; k >= 0; k--) {
                    if (validDataSlice[k].lineIndex !== null && validDataSlice[k].lineIndex !== undefined) {
                        currentLineIndex = validDataSlice[k].lineIndex;
                        break;
                    }
                }
            }

            // Calculate Displacement (Just for logging/debug, NOT for filtering)
            const startX = validDataSlice[sweep.startIndex].gx;
            const endX = validDataSlice[sweep.endIndex].gx;
            const displacement = startX - endX;

            if (currentLineIndex !== null && currentLineIndex !== undefined) {
                const startLineVal = Number(currentLineIndex);
                let lineIncreased = false;
                let lineDecreased = false;
                // Look ahead 500ms for LineIndex update
                const toleranceWindow = 500;
                const searchUntil = sweep.end_ms + toleranceWindow;

                for (let k = sweep.endIndex; k < validDataSlice.length; k++) {
                    const d = validDataSlice[k];
                    if (d.t > searchUntil) break;
                    if (d.lineIndex !== null && d.lineIndex !== undefined) {
                        const val = Number(d.lineIndex);
                        if (val > startLineVal) {
                            lineIncreased = true; // Confirmed Next Line
                            break;
                        }
                        if (val < startLineVal) {
                            lineDecreased = true; // Confirmed Regression (Previous Line)
                        }
                    }
                }

                // V25 Logic: Removed Displacement Threshold per User Request.
                // Rely on k=1.5 MAD + Metadata Logic.

                if (lineDecreased) {
                    // Explicit Regression in Metadata -> NOW ACCEPTED (As per User Request to match Chart 11)
                    // The physical eye movement is trusted more than the metadata lag.
                    console.warn(`[Accept Sweep] Metadata Regression (${startLineVal} -> Decreased). Accepted to match Chart 11 logic. Disp=${displacement.toFixed(0)}`);
                    // continue; // REMOVED REJECTION
                }

                if (lineIncreased) {
                    // Explicit Increase -> ACCEPT
                    console.log(`[Accept Sweep] Valid Line Increase (${startLineVal} -> Increased). Disp=${displacement.toFixed(0)}`);
                } else {
                    // LineIndex Unchanged (0 -> 0)
                    // We accept it as Valid Sweep (Game Lag Case) since it was detected by MAD.
                    console.warn(`[Accept Sweep] LineIndex Unchanged (${startLineVal}). Accepted as Valid Sweep (Non-Regression). Disp=${displacement.toFixed(0)}`);
                }
            }

            // If passed all checks
            validSweeps.push(sweep);
            lastSweepEndTime = sweep.end_ms; // Update Last Time
            currentLineNum++;
        }

        // 5. Reset detections
        for (let i = 0; i < this.data.length; i++) {
            delete this.data[i].detectedLineIndex;
            delete this.data[i].extrema;
            delete this.data[i].isReturnSweep;
        }

        // 6. Apply Valid Lines
        let lineNum = 1;
        let lastEndRelIdx = 0;

        const markLine = (relStart, relEnd, num) => {
            if (relEnd <= relStart) return;
            const globalStart = startIndex + relStart;
            const globalEnd = startIndex + relEnd;

            for (let k = globalStart; k < globalEnd; k++) {
                if (this.data[k]) this.data[k].detectedLineIndex = num;
            }
            if (this.data[globalStart]) this.data[globalStart].extrema = "LineStart";
            if (this.data[globalEnd - 1]) this.data[globalEnd - 1].extrema = "PosMax";
        };

        for (const sweep of validSweeps) {
            const lineEndRelIdx = sweep.startIndex;

            // V22 Fix: Mark segment if data exists, but ALWAYS increment lineNum for a valid sweep
            if (lineEndRelIdx > lastEndRelIdx) {
                markLine(lastEndRelIdx, lineEndRelIdx, lineNum);
            }
            lineNum++; // Increment unconditionally

            lastEndRelIdx = sweep.endIndex + 1;

            for (let k = sweep.startIndex; k <= sweep.endIndex; k++) {
                const globalIdx = startIndex + k;
                if (this.data[globalIdx]) this.data[globalIdx].isReturnSweep = true;
            }
        }

        if (samples.length - lastEndRelIdx > 5) {
            markLine(lastEndRelIdx, samples.length, lineNum);
        }

        console.log(`[GazeDataManager] MAD Line Detection (Adv): Found ${lineNum} lines. Range: ${startTime}~${endTime}ms.`);

        return lineNum;
    }

    /**
     * Real-time Check for Return Sweep (K=1.5 equivalent logic)
     * Look back 'lookbackMs' and see if a strong negative velocity spike exists.
     * @param {number} lookbackMs 
     * @returns {boolean}
     */
    detectRealtimeReturnSweep(lookbackMs = 600) {
        if (this.data.length < 5) return false;

        const now = this.data[this.data.length - 1].t;
        const cutoff = now - lookbackMs;

        // 1. Get recent samples (smoothed velocity needed)
        // We assume vx is already calculated for recent frames via preprocessData or on-the-fly?
        // preprocessData is usually offline. For real-time, we must calc VX for the latest point here.

        // Quick Calc for latest point if missing
        const latestInfo = this.data[this.data.length - 1];
        if (latestInfo.vx === null || latestInfo.vx === undefined) {
            // Calculate on the fly for the tail
            const prev = this.data[this.data.length - 2];
            if (prev) {
                const dt = latestInfo.t - prev.t;
                if (dt > 0) {
                    latestInfo.vx = (latestInfo.x - prev.x) / dt;
                }
            }
        }

        // 2. Scan recent buffer
        let foundSpike = false;
        let minVel = 0;

        // MAD Algorithm Implementation (K=1.5)
        // 1. Collect Neg Velocity Samples from buffer
        const samples = [];
        for (let i = this.data.length - 1; i >= 0; i--) {
            const d = this.data[i];
            if (d.t < cutoff) break;
            // Use only negative velocities for Return Sweep Analysis (like detectLinesMobile)
            if (d.vx !== undefined && d.vx < 0) {
                samples.push(d.vx);
            }
        }

        if (samples.length < 5) return false;

        // 2. Calculate Median
        samples.sort((a, b) => a - b);
        const mid = Math.floor(samples.length / 2);
        const median = samples.length % 2 !== 0 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;

        // 3. Calculate MAD (Median Absolute Deviation)
        const deviations = samples.map(v => Math.abs(v - median));
        deviations.sort((a, b) => a - b);
        const madMid = Math.floor(deviations.length / 2);
        const mad = deviations.length % 2 !== 0 ? deviations[madMid] : (deviations[madMid - 1] + deviations[madMid]) / 2;

        // 4. Determine Dynamic Threshold (K=1.5)
        // Return Sweep is an outlier to the LEFT (Negative)
        const k = 1.5;
        // Ideally: Threshold = Median - k * MAD? 
        // Since we are looking for extreme negatives, and Median of neg vels is likely near 0 or small neg.
        const dynamicThreshold = median - (k * mad);

        // Safety Fallback: Ensure threshold is at least somewhat negative to avoid noise triggering
        // e.g. if median is -0.01 and MAD is 0.01, threshold is -0.025 which is too sensitive.
        // Let's rely on the K=1.5 primarily but maybe check if it's statistically significant?
        // Actually, if K=1.5 works in your experiments, let's trust it.

        // Scan Again for Spike AND Log Debug Info to Data Stream
        for (let i = this.data.length - 1; i >= 0; i--) {
            const d = this.data[i];
            if (d.t < cutoff) break;

            // INJECT DEBUG INFO (For all checking points)
            if (d.vx !== undefined && d.vx !== null) {
                d.debugSamples = samples.length;
                d.debugMedian = median;
                d.debugThreshold = dynamicThreshold;
                d.debugVX = d.vx;
            }

            if (d.vx && d.vx < dynamicThreshold) { // More negative than threshold
                foundSpike = true;
                minVel = d.vx;

                d.realtimeRS = true;
                console.log(`[RS-DETECT] MAD HIT! VX=${d.vx.toFixed(2)} < Thresh=${dynamicThreshold.toFixed(2)} (Med=${median.toFixed(2)}, MAD=${mad.toFixed(2)})`);
                break;
            }
        }

        return foundSpike;
    }

    /**
     * Helper to update context for debugging
     */
    logDebugEvent(key, val) {
        // Find latest data point and inject
        if (this.data.length > 0) {
            this.data[this.data.length - 1][key] = val;
        }
    }
}
