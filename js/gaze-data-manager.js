
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
        for (let i = 0; i < this.data.length; i++) {
            if (i === 0) {
                this.data[i].vx = 0;
                this.data[i].vy = 0;
            } else {
                const dt = this.data[i].t - this.data[i - 1].t;
                if (dt > 0) {
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
            if (lineYCount[k] > 0) {
                lineYAvg[k] = lineYSum[k] / lineYCount[k];
            }
        });

        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,InkY_Px,AlgoLineIndex,Extrema,TargetY_Px,AvgCoolGazeY_Px,ReplayX,ReplayY,InkSuccess,InkCoverage_Px,isLagFix,IsArmed,DidFire,Debug_Samples,Debug_Median,Debug_ZScore,Debug_RealtimeVX\n";

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
                (d.debugZScore !== undefined) ? d.debugZScore.toFixed(3) : "",
                (d.debugVX !== undefined) ? d.debugVX.toFixed(3) : ""
            ];
            csv += row.join(",") + "\n";
        });

        const ua = navigator.userAgent.toLowerCase();
        let deviceType = "desktop";
        if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
            deviceType = "smartphone";
        } else if (/tablet|ipad|playbook|silk/i.test(ua)) {
            deviceType = "tablet";
        }

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

    async exportChartImage(deviceType, startTime = 0, endTime = Infinity) {
        if (typeof Chart === 'undefined') {
            console.warn("Chart.js is not loaded. Skipping chart export.");
            return;
        }

        const chartData = this.data.filter(d => d.t >= startTime && d.t <= endTime);
        if (chartData.length === 0) {
            console.warn("No data for chart export in range.");
            return;
        }

        const cols = 1;
        const rows = 4;
        const chartWidth = 1000;
        const chartHeight = 350;
        const padding = 20;
        const totalWidth = chartWidth * cols;
        const totalHeight = (chartHeight + padding) * rows;

        const chartTypes = ['RawData', 'SmoothedData', 'Velocity', 'LineIndices'];

        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = totalWidth;
        mainCanvas.height = totalHeight;
        const ctx = mainCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, totalWidth, totalHeight);

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

        const lineStarts = [];
        const posMaxs = [];

        chartData.forEach(d => {
            if (d.extrema === 'LineStart') lineStarts.push({ x: d.t, y: d.gx });
            if (d.extrema === 'PosMax') posMaxs.push({ x: d.t, y: d.gx });
        });

        for (let i = 0; i < chartTypes.length; i++) {
            const chartName = chartTypes[i];
            const yOffset = i * (chartHeight + padding);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = chartWidth;
            tempCanvas.height = chartHeight;

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

            if (chartName === 'RawData') {
                configData.datasets.push(
                    { label: 'RawX', data: datasets.RawX, borderColor: 'blue', borderWidth: 1, pointRadius: 0 },
                    { label: 'RawY', data: datasets.RawY, borderColor: 'orange', borderWidth: 1, pointRadius: 0 }
                );
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
                plugins: [intervalPlugin]
            };

            await new Promise(resolve => {
                const chart = new Chart(tempCanvas, chartConfig);
                setTimeout(() => {
                    ctx.drawImage(tempCanvas, 0, yOffset);
                    chart.destroy();
                    resolve();
                }, 100);
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

        const samples = validDataSlice.map(d => ({
            ts_ms: d.t,
            velX: d.vx < 0 ? d.vx : 0
        }));

        const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 1.5, gapMs: 120, expandOneSample: true });
        console.log(`[GazeDataManager] Running MAD with k=1.5 on ${samples.length} samples.`);

        const candidates = spikeIntervals.filter(interval => {
            if (validDataSlice[interval.startIndex] && validDataSlice[interval.endIndex]) {
                const startX = validDataSlice[interval.startIndex].gx;
                const endX = validDataSlice[interval.endIndex].gx;
                const displacement = startX - endX;
                if (displacement < 100) return false;
            } else {
                return false;
            }
            return true;
        });

        candidates.sort((a, b) => a.start_ms - b.start_ms);

        let observedMinLineDur = Infinity;
        let curLineIdxForDur = -1;
        let curLineStartTForDur = -1;

        for (let i = 0; i < validDataSlice.length; i++) {
            const d = validDataSlice[i];
            if (d.lineIndex !== null && d.lineIndex !== undefined && d.lineIndex !== "") {
                const idx = Number(d.lineIndex);
                if (idx !== curLineIdxForDur) {
                    if (curLineIdxForDur !== -1) {
                        const duration = d.t - curLineStartTForDur;
                        if (duration > 50 && duration < observedMinLineDur) {
                            observedMinLineDur = duration;
                        }
                    }
                    curLineIdxForDur = idx;
                    curLineStartTForDur = d.t;
                }
            }
        }

        if (observedMinLineDur === Infinity) observedMinLineDur = 300;
        const MIN_LINE_DURATION = observedMinLineDur * 0.5;
        console.log(`[GazeDataManager] Dynamic Threshold: MinObserved=${observedMinLineDur}ms -> Threshold=${MIN_LINE_DURATION}ms`);

        const validSweeps = [];
        let currentLineNum = 1;
        let lastSweepEndTime = -Infinity;

        let lastKnownLineIndex = null;
        for (let i = 0; i < validDataSlice.length; i++) {
            const d = validDataSlice[i];
            if (d.lineIndex !== null && d.lineIndex !== undefined && d.lineIndex !== "") {
                lastKnownLineIndex = d.lineIndex;
            } else if (lastKnownLineIndex !== null) {
            }
        }

        for (const sweep of candidates) {
            const sweepData = validDataSlice[sweep.startIndex];
            const sweepTime = sweepData.t;

            const timeSinceLast = sweepData.t - lastSweepEndTime;
            if (validSweeps.length > 0 && timeSinceLast < MIN_LINE_DURATION) {
                console.log(`[Reject Sweep] Rapid Fire: dt=${timeSinceLast}ms < ${MIN_LINE_DURATION}ms at T=${sweepTime}`);
                continue;
            }

            let currentLineIndex = sweepData.lineIndex;
            if (currentLineIndex === null || currentLineIndex === undefined) {
                for (let k = sweep.startIndex; k >= 0; k--) {
                    if (validDataSlice[k].lineIndex !== null && validDataSlice[k].lineIndex !== undefined) {
                        currentLineIndex = validDataSlice[k].lineIndex;
                        break;
                    }
                }
            }

            const startX = validDataSlice[sweep.startIndex].gx;
            const endX = validDataSlice[sweep.endIndex].gx;
            const displacement = startX - endX;

            if (currentLineIndex !== null && currentLineIndex !== undefined) {
                const startLineVal = Number(currentLineIndex);
                let lineIncreased = false;
                let lineDecreased = false;
                const toleranceWindow = 500;
                const searchUntil = sweep.end_ms + toleranceWindow;

                for (let k = sweep.endIndex; k < validDataSlice.length; k++) {
                    const d = validDataSlice[k];
                    if (d.t > searchUntil) break;
                    if (d.lineIndex !== null && d.lineIndex !== undefined) {
                        const val = Number(d.lineIndex);
                        if (val > startLineVal) {
                            lineIncreased = true;
                            break;
                        }
                        if (val < startLineVal) {
                            lineDecreased = true;
                        }
                    }
                }

                if (lineDecreased) {
                    console.warn(`[Accept Sweep] Metadata Regression (${startLineVal} -> Decreased). Accepted to match Chart 11 logic. Disp=${displacement.toFixed(0)}`);
                }

                if (lineIncreased) {
                    console.log(`[Accept Sweep] Valid Line Increase (${startLineVal} -> Increased). Disp=${displacement.toFixed(0)}`);
                } else {
                    console.warn(`[Accept Sweep] LineIndex Unchanged (${startLineVal}). Accepted as Valid Sweep (Non-Regression). Disp=${displacement.toFixed(0)}`);
                }
            }

            validSweeps.push(sweep);
            lastSweepEndTime = sweep.end_ms;
            currentLineNum++;
        }

        for (let i = 0; i < this.data.length; i++) {
            delete this.data[i].detectedLineIndex;
            delete this.data[i].extrema;
            delete this.data[i].isReturnSweep;
        }

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

            if (lineEndRelIdx > lastEndRelIdx) {
                markLine(lastEndRelIdx, lineEndRelIdx, lineNum);
            }
            lineNum++;

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
     * Real-time Check for Return Sweep using Modified Z-Score (Robust MAD)
     * Detects outliers based on statistical deviation, resistant to jitter.
     * @param {number} lookbackMs 
     * @returns {boolean}
     */
    detectRealtimeReturnSweep(lookbackMs = 600) {
        if (this.data.length < 5) return false;

        const d0 = this.data[this.data.length - 1]; // Current
        const now = d0.t;
        const cutoff = now - lookbackMs;

        // 1. Calculate Velocity if missing (Instant Calculation)
        if (d0.vx === null || d0.vx === undefined) {
            const prev = this.data[this.data.length - 2];
            if (prev && prev.t < d0.t) {
                const dt = d0.t - prev.t;
                d0.vx = (d0.x - prev.x) / dt;
            } else {
                d0.vx = 0;
            }
        }

        // 2. Collect Samples for MAD (Negative Velocity Context)
        const samples = [];
        for (let i = this.data.length - 1; i >= 0; i--) {
            const d = this.data[i];
            if (d.t < cutoff) break;
            if (d.vx !== undefined && d.vx < 0) {
                samples.push(d.vx);
            }
        }

        if (samples.length < 5) return false;

        // 3. Calculate Robust Statistics (Median & MAD)
        samples.sort((a, b) => a - b);
        const mid = Math.floor(samples.length / 2);
        const median = samples.length % 2 !== 0 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;

        const deviations = samples.map(v => Math.abs(v - median));
        deviations.sort((a, b) => a - b);
        const madMid = Math.floor(deviations.length / 2);
        const mad = deviations.length % 2 !== 0 ? deviations[madMid] : (deviations[madMid - 1] + deviations[madMid]) / 2;

        // 4. Calculate Modified Z-Score
        // Formula: M_Z = 0.6745 * (Value - Median) / MAD
        const currentVX = d0.vx;
        const safeMAD = mad === 0 ? 0.001 : mad; // Prevent division by zero

        const zScore = (0.6745 * (currentVX - median)) / safeMAD;

        // Debug Data Injection
        d0.debugMedian = median;
        d0.debugZScore = zScore;
        d0.debugVX = currentVX;
        d0.debugThreshold = 0; // Legacy field

        // 5. TRIGGER LOGIC: Z-Score Threshold
        // Standard is |Z| > 3.5. We use Z < -3.5 (Negative Outlier)
        // Adjust to -3.0 for better responsiveness if needed.
        const Z_THRESHOLD = -3.0;

        // Cooldown Check (300ms)
        if (this.lastTriggerTime && (now - this.lastTriggerTime < 300)) {
            return false;
        }

        if (zScore < Z_THRESHOLD) {
            // --- TRIGGER CONFIRMED ---
            this.lastTriggerTime = now;
            d0.didFire = true;
            console.log(`[RS] 💥 Z-SCORE TRIGGER! Z:${zScore.toFixed(2)} (Limit:${Z_THRESHOLD}) | VX:${currentVX.toFixed(2)}`);
            return true;
        }

        return false;
    }

    /**
     * Helper to update context for debugging
     */
    logDebugEvent(key, val) {
        if (this.data.length > 0) {
            this.data[this.data.length - 1][key] = val;
        }
    }
}
