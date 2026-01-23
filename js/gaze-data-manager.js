
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
            // Context data (LineIndex, CharIndex)
            ...(this.context || {})
        };

        this.data.push(entry);

        // Debug Log (Raw Stream Check)
        // User Request: "콘솔로 시선좌표 및 fixation saccade인지 띄워라."
        console.log(`[GazeRaw] Frame T:${t} | (${x.toFixed(1)}, ${y.toFixed(1)}) | Type: ${type} | State: ${gazeInfo.eyemovementState}`);

        // Debug Log (Every ~1 sec aka 60 frames)
        if (this.data.length % 60 === 0) console.log("[GazeData] Count:", this.data.length, "Latest:", entry);
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
                    this.data[i].vx = (this.data[i].gx - this.data[i - 1].gx) / dt; // px/ms
                    this.data[i].vy = (this.data[i].gy - this.data[i - 1].gy) / dt;
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
        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,AlgoLineIndex,Extrema,TargetY_Px,AvgCoolGazeY_Px,ReplayX,ReplayY\n";

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
                d.avgY = lineYAvg[lIdx] !== undefined ? parseFloat(lineYAvg[lIdx].toFixed(2)) : null;

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
                (d.detectedLineIndex !== undefined) ? d.detectedLineIndex : "",
                (d.extrema !== undefined) ? d.extrema : "",
                targetY,
                avgY,
                (d.rx !== undefined && d.rx !== null) ? d.rx.toFixed(2) : "",
                (d.ry !== undefined && d.ry !== null) ? d.ry.toFixed(2) : ""
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

        // 2. Prepare samples (Velocity Data)
        const samples = validDataSlice.map(d => ({
            ts_ms: d.t,
            velX: d.vx
        }));

        // 3. Detect Spikes using MAD (Sensitivity k=5)
        // Adjusted to 3.5 to be MORE sensitive, catching missed return sweeps
        const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 3.5, gapMs: 120, expandOneSample: true });

        // 4. Identify Return Sweeps
        const returnSweeps = spikeIntervals.filter(interval => {
            let sum = 0;
            let count = 0;
            for (let i = interval.startIndex; i <= interval.endIndex; i++) {
                if (i >= 0 && i < samples.length) {
                    sum += samples[i].velX;
                    count++;
                }
            }
            const meanVel = count > 0 ? sum / count : 0;
            return meanVel < 0; // Moving Left
        });

        // Sort by time
        returnSweeps.sort((a, b) => a.start_ms - b.start_ms);

        // 5. Reset detections ONLY within the target range? 
        // Or global reset? User likely wants a clean slate for this session.
        // Let's do global reset for safety as we usually process session-by-session.
        for (let i = 0; i < this.data.length; i++) {
            delete this.data[i].detectedLineIndex;
            delete this.data[i].extrema;
            delete this.data[i].isReturnSweep;
        }

        // 6. Apply Lines (Adjusting for startIndex offset)
        let lineNum = 1;

        // Note: interval.startIndex is relative to 'samples' (validDataSlice)
        // We must add 'startIndex' to map to 'this.data'

        // Track the end of the last sweep (Relative Index)
        let lastEndRelIdx = 0;

        const markLine = (relStart, relEnd, num) => {
            if (relEnd <= relStart) return;
            // Map to Global
            const globalStart = startIndex + relStart;
            const globalEnd = startIndex + relEnd;

            for (let k = globalStart; k < globalEnd; k++) {
                if (this.data[k]) this.data[k].detectedLineIndex = num;
            }

            if (this.data[globalStart]) this.data[globalStart].extrema = "LineStart";

            // PosMax is usually the last point of the line
            if (this.data[globalEnd - 1]) this.data[globalEnd - 1].extrema = "PosMax";
        };

        for (const sweep of returnSweeps) {
            // sweep.startIndex, sweep.endIndex are RELATIVE to slice

            const lineEndRelIdx = sweep.startIndex;

            // Check segment length
            if (lineEndRelIdx - lastEndRelIdx > 5) {
                markLine(lastEndRelIdx, lineEndRelIdx, lineNum);
                lineNum++;
            }

            // Next line starts after sweep
            lastEndRelIdx = sweep.endIndex + 1;

            // Mark Return Sweep in Data (Map to Global)
            for (let k = sweep.startIndex; k <= sweep.endIndex; k++) {
                const globalIdx = startIndex + k;
                if (this.data[globalIdx]) this.data[globalIdx].isReturnSweep = true;
            }
        }

        // Process final segment
        if (samples.length - lastEndRelIdx > 5) {
            markLine(lastEndRelIdx, samples.length, lineNum);
        }

        console.log(`[GazeDataManager] MAD Line Detection: Found ${lineNum} lines. Range: ${startTime}~${endTime}ms (Indices: ${startIndex}~${endIndex})`);

        return lineNum;
    }
}
