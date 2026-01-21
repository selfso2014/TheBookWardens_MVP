
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

    exportCSV() {
        if (!this.data || this.data.length === 0) {
            alert("No gaze data to export.");
            return;
        }

        // Ensure data is preprocessed (Interpolated, Smoothed, Velocity) before export
        this.preprocessData();

        // CSV Header
        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,AlgoLineIndex,Extrema\n";

        // Rows
        this.data.forEach(d => {
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
                (d.extrema !== undefined) ? d.extrema : ""
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

        // Also export chart image
        this.exportChartImage(deviceType);
    }

    async exportChartImage(deviceType) {
        if (typeof Chart === 'undefined') {
            console.warn("Chart.js is not loaded. Skipping chart export.");
            return;
        }

        // Configuration: 2x2 grid for requested 4 charts
        const cols = 2;
        const rows = 2;
        const chartWidth = 1000;
        const chartHeight = 400;
        const totalWidth = chartWidth * cols;
        const totalHeight = chartHeight * rows;

        const charts = ['SmoothX', 'SmoothY', 'LineIndex', 'AlgoLineIndex'];

        // Create a single large canvas to draw everything on
        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = totalWidth;
        mainCanvas.height = totalHeight;
        const ctx = mainCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, totalWidth, totalHeight);

        // Prepare Data
        const times = this.data.map(d => d.t);
        const datasets = {
            RawX: this.data.map(d => d.x),
            RawY: this.data.map(d => d.y),
            SmoothX: this.data.map(d => d.gx),
            SmoothY: this.data.map(d => d.gy),
            VelX: this.data.map(d => d.vx),
            VelY: this.data.map(d => d.vy),
            LineIndex: this.data.map(d => d.lineIndex || 0),
            CharIndex: this.data.map(d => d.charIndex || 0),
            AlgoLineIndex: this.data.map(d => d.detectedLineIndex || null)
        };

        // Extrema Points
        const lineStarts = [];
        const posMaxs = [];
        const posMaxLasts = [];

        this.data.forEach(d => {
            if (d.extrema === 'LineStart') lineStarts.push({ x: d.t, y: d.gx });
            if (d.extrema === 'PosMax') posMaxs.push({ x: d.t, y: d.gx });
            if (d.extrema === 'PosMax(Last)') posMaxLasts.push({ x: d.t, y: d.gx });
        });

        // Loop through each chart type and draw to a temp canvas
        for (let i = 0; i < charts.length; i++) {
            const chartName = charts[i];
            // Grid Position
            const col = i % cols;
            const row = Math.floor(i / cols);
            const xOffset = col * chartWidth;
            const yOffset = row * chartHeight;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = chartWidth;
            tempCanvas.height = chartHeight;

            const chartConfig = {
                type: 'line',
                data: {
                    labels: times,
                    datasets: [{
                        label: chartName,
                        data: datasets[chartName],
                        borderColor: 'rgba(33, 150, 243, 0.7)',
                        borderWidth: 1.5,
                        pointRadius: 2,
                        tension: 0.1,
                        fill: false
                    }]
                },
                options: {
                    responsive: false,
                    animation: false,
                    layout: { padding: { left: 20, right: 40, top: 20, bottom: 20 } },
                    plugins: {
                        title: { display: true, text: chartName },
                        legend: { display: false }
                    },
                    scales: {
                        x: { display: true, ticks: { maxTicksLimit: 10 } },
                        y: { beginAtZero: false } // Auto scale
                    }
                }
            };

            // Add Extrema to SmoothX
            if (chartName === 'SmoothX') {
                chartConfig.data.datasets.push({
                    label: 'Extrema: LineStart',
                    data: lineStarts,
                    type: 'scatter',
                    backgroundColor: 'green',
                    pointRadius: 6,
                    pointStyle: 'triangle',
                    rotation: 180,
                    parsing: { xAxisKey: 'x', yAxisKey: 'y' }
                });
                chartConfig.data.datasets.push({
                    label: 'Extrema: PosMax',
                    data: posMaxs,
                    type: 'scatter',
                    backgroundColor: 'red',
                    pointRadius: 6,
                    pointStyle: 'triangle',
                    parsing: { xAxisKey: 'x', yAxisKey: 'y' }
                });

                // Add Ignored Extrema Visualization
                const valleyIgnored = [];
                const peakIgnored = [];
                this.data.forEach(d => {
                    if (d.extrema === 'Valley(Ignored)') valleyIgnored.push({ x: d.t, y: d.gx });
                    if (d.extrema === 'Peak(Ignored)') peakIgnored.push({ x: d.t, y: d.gx });
                });

                chartConfig.data.datasets.push({
                    label: 'Ignored Valley',
                    data: valleyIgnored,
                    type: 'scatter',
                    backgroundColor: 'rgba(50,50,50,0.5)',
                    pointRadius: 4,
                    pointStyle: 'triangle',
                    rotation: 180,
                    parsing: { xAxisKey: 'x', yAxisKey: 'y' }
                });
                chartConfig.data.datasets.push({
                    label: 'Ignored Peak',
                    data: peakIgnored,
                    type: 'scatter',
                    backgroundColor: 'rgba(50,50,50,0.5)',
                    pointRadius: 4,
                    pointStyle: 'triangle',
                    parsing: { xAxisKey: 'x', yAxisKey: 'y' }
                });

                chartConfig.options.plugins.legend = { display: true };
            }

            // Render Chart on Temp Canvas
            // Note: Chart.js renders asynchronously usually, but with animation:false it might be sync enough for image capture??
            // Actually, we need to wait for it.

            await new Promise(resolve => {
                const chart = new Chart(tempCanvas, chartConfig);
                setTimeout(() => {
                    // Draw temp canvas onto main canvas
                    ctx.drawImage(tempCanvas, xOffset, yOffset);
                    chart.destroy();
                    resolve();
                }, 100); // Small delay to ensure render
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
    detectLinesMobile() {
        if (this.data.length < 10) return 0;
        this.preprocessData(); // Ensure velX is calculated

        // Prepare samples for MAD detector
        const samples = this.data.map(d => ({
            ts_ms: d.t,
            velX: d.vx
        }));

        // Detect Spikes using MAD
        // Using k=3 based on user request (approx 30-50% robust sensitivity)
        const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 3, gapMs: 120, expandOneSample: true });

        // Identify Return Sweeps (Large Negative Velocity)
        // We filter spikes where the mean velocity is negative
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

        // Reset existing detection
        for (let i = 0; i < this.data.length; i++) {
            delete this.data[i].detectedLineIndex;
            delete this.data[i].extrema;
            delete this.data[i].isReturnSweep;
        }

        let lineNum = 1;
        let lastEndIdx = 0;

        const markLine = (start, end, num) => {
            if (end <= start) return;
            for (let k = start; k < end; k++) {
                this.data[k].detectedLineIndex = num;
            }
            if (this.data[start]) this.data[start].extrema = "LineStart";
            if (this.data[end - 1]) this.data[end - 1].extrema = "PosMax";
        };

        for (const sweep of returnSweeps) {
            // Found a sweep. The segment BEFORE this sweep is a line.
            // Sweep starts at sweep.startIndex.
            const lineEndIdx = sweep.startIndex;

            // Heuristic section length check (e.g. > 100ms or 5 samples)
            if (lineEndIdx - lastEndIdx > 5) {
                markLine(lastEndIdx, lineEndIdx, lineNum);
                lineNum++;
            }

            // Next line starts after sweep
            lastEndIdx = sweep.endIndex + 1;

            // Mark Return Sweep in Data
            for (let k = sweep.startIndex; k <= sweep.endIndex; k++) {
                if (this.data[k]) this.data[k].isReturnSweep = true;
            }
        }

        // Process final segment
        if (this.data.length - lastEndIdx > 5) {
            markLine(lastEndIdx, this.data.length, lineNum);
        }

        console.log(`[GazeDataManager] MAD Line Detection: Found ${lineNum} lines from ${spikeIntervals.length} spikes (${returnSweeps.length} sweeps). Threshold: ${threshold.toFixed(4)}`);

        return lineNum;
    }
}
