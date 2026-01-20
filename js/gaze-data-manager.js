
/**
 * Gaze Data Management
 * Stores and processes raw gaze data into structured format with Gaussian smoothing and velocity calculation.
 */
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
        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,LineIndex,CharIndex,AlgoLineIndex,Extrema\n";

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
    }

    // --- Line Detection Algorithm V3 (Interpolation + Velocity Check) ---
    detectLinesMobile() {
        if (this.data.length < 10) return 0;

        // ---------------------------------------------------------
        // Step 0. Preprocessing (Interpolation, Smoothing, Velocity)
        // ---------------------------------------------------------
        // Ensure data fields (gx, vx) are populated
        this.preprocessData();

        // ---------------------------------------------------------
        // Step 1. Setup Time Window (Start Text - End Text + 2s)
        // ---------------------------------------------------------
        let tStart = -1, tEnd = -1;
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].lineIndex !== undefined && this.data[i].lineIndex !== null) {
                if (tStart === -1) tStart = this.data[i].t;
                tEnd = this.data[i].t;
            }
        }
        if (tEnd !== -1) tEnd += 2000;

        // ---------------------------------------------------------
        // Step 2. Find Extremes (Wide Window)
        // ---------------------------------------------------------
        const posMaxima = []; // X Maxima (Line End Candidates)
        const velMinima = []; // Vx Minima (Max Left-Speed Candidates)

        // Window expanded x3 -> 30 samples (~500ms at 60hz)
        const winPos = 30;
        const winVel = 5; // Velocity peak is sharp

        // Loop through data (skipping edges for window)
        for (let i = winPos; i < this.data.length - winPos; i++) {
            // Check Time Window
            const t = this.data[i].t;
            if (tStart !== -1 && (t < tStart || t > tEnd)) continue;

            // Use Pre-calculated Smoothed Data (gx) and Velocity (vx)
            const xVal = this.data[i].gx;
            const vxVal = this.data[i].vx;

            if (xVal === null || xVal === undefined) continue;

            // A. Position Maxima
            let isMax = true;
            for (let j = 1; j <= winPos; j++) {
                if (xVal <= this.data[i - j].gx || xVal <= this.data[i + j].gx) isMax = false;
            }
            if (isMax) posMaxima.push({ index: i, value: xVal, t: t });

            // B. Velocity Minima (Negative Peak = Fast Left Move)
            // Skip check if too close to edge for velocity win
            if (i < winVel || i >= this.data.length - winVel) continue;

            let isVelMin = true;
            for (let j = 1; j <= winVel; j++) {
                if (vxVal >= this.data[i - j].vx || vxVal >= this.data[i + j].vx) isVelMin = false;
            }
            // Must be significantly negative (e.g. < -0.1 px/ms)
            if (isVelMin && vxVal < -0.1) {
                velMinima.push({ index: i, value: vxVal, t: t });
            }
        }

        // Mark Extrema for Debug/CSV
        // Reset markings logic:
        // 1. PosMax: Line End (Orange)
        // 2. LineStart: Line Start (Blue - replaces VelMin for visual clarity)
        for (let i = 0; i < this.data.length; i++) delete this.data[i].extrema;

        // We will mark PosMax and LineStart within the loop below as we confirm them.

        // ---------------------------------------------------------
        // Step 3. Validate Lines using Velocity
        // ---------------------------------------------------------
        const validLines = [];
        let lineCounter = 1;

        // Strategy: Maxima -> Look for close Velocity Minima -> Confirm Return Sweep
        for (let i = 0; i < posMaxima.length; i++) {
            const pMax = posMaxima[i];

            // 1. Find nearest Velocity Minima shortly AFTER this Maxima
            // Return sweep usually happens 0~400ms after fixation on line end.
            const searchWindowMs = 400;
            const matchingVel = velMinima.find(v =>
                v.t > pMax.t && v.t < pMax.t + searchWindowMs
            );

            if (matchingVel) {
                // Return Sweep Detected!
                // Start of line: Find local minima preceding this max (Smoothed X)
                let prevMinIdx = 0;
                let minVal = 9999;

                // Define lower bound for search
                const lastLineEnd = (validLines.length > 0) ? validLines[validLines.length - 1].endIdx : 0;
                const searchLimit = Math.max(0, pMax.index - 200);
                const finalLimit = Math.max(lastLineEnd + 1, searchLimit);

                // Simple Min-Finding
                for (let k = pMax.index; k >= finalLimit; k--) {
                    const val = this.data[k].gx;
                    if (val !== null && val < minVal) {
                        minVal = val;
                        prevMinIdx = k;
                    }
                }

                if (prevMinIdx > lastLineEnd) {
                    validLines.push({
                        startIdx: prevMinIdx,
                        endIdx: pMax.index,
                        lineNum: lineCounter++
                    });

                    // Mark Extrema for CSV
                    this.data[prevMinIdx].extrema = "LineStart"; // Visual: Valley Bottom
                    this.data[pMax.index].extrema = "PosMax";    // Visual: Peak
                }
            }
        }

        // ---------------------------------------------------------
        // Step 3-1. Handle Last Line (which has NO Return Sweep)
        // ---------------------------------------------------------
        // Logic: Check remaining PosMaxima that were NOT used in validLines.
        // If there is a orphaned PosMax at the end that forms a valid line width with a preceding Min, add it.

        const lastDetectedEndInfo = (validLines.length > 0) ? validLines[validLines.length - 1] : null;
        const lastUsedEndIdx = lastDetectedEndInfo ? lastDetectedEndInfo.endIdx : -1;

        // Find potential Last Line Maxima: Must be after the last detected line
        // and NOT already processed (though our loop above pushes sequentially, so just checking index > lastUsedEndIdx is enough)

        // We iterate backwards from the last PosMax to find the best candidate for the final line end.
        let finalMaxCand = null;
        for (let i = posMaxima.length - 1; i >= 0; i--) {
            if (posMaxima[i].index > lastUsedEndIdx) {
                finalMaxCand = posMaxima[i];
                break; // Take the very last maxima available
            }
        }

        if (finalMaxCand) {
            // Check if this Maxima forms a valid line logic
            // Start of line: Find absolute min in interval [lastUsedEndIdx+1 ... finalMaxCand]
            let prevMinIdx = 0;
            let minVal = 9999;
            const searchStart = (lastUsedEndIdx === -1) ? 0 : lastUsedEndIdx + 1;

            // Search range limited to reasonable past (e.g., 5 seconds = ~300 samples) to avoid picking start of game as line start
            const searchLimit = Math.max(searchStart, finalMaxCand.index - 300);

            for (let k = finalMaxCand.index; k >= searchLimit; k--) {
                const val = this.data[k].gx;
                if (val !== null && val < minVal) {
                    minVal = val;
                    prevMinIdx = k;
                }
            }

            // Validate: Width > Threshold (80px)
            const width = finalMaxCand.value - minVal;
            const AMP_THRESHOLD = 80;

            if (width > AMP_THRESHOLD) {
                validLines.push({
                    startIdx: prevMinIdx,
                    endIdx: finalMaxCand.index,
                    lineNum: lineCounter++
                });
                // Mark this final max as detected for completeness
                this.data[prevMinIdx].extrema = "LineStart"; // Visual: Valley Bottom
                this.data[finalMaxCand.index].extrema = "PosMax(Last)";
            }
        }

        // Cap lines
        let maxActualLines = 999;
        if (this.data.length > 0) {
            for (let k = this.data.length - 1; k >= 0; k--) {
                if (this.data[k].lineIndex !== undefined && this.data[k].lineIndex !== null) {
                    maxActualLines = this.data[k].lineIndex + 1;
                    break;
                }
            }
        }
        if (validLines.length > maxActualLines) validLines.length = maxActualLines;

        // Mark Data
        for (let i = 0; i < this.data.length; i++) delete this.data[i].detectedLineIndex;
        validLines.forEach(line => {
            for (let k = line.startIdx; k <= line.endIdx; k++) {
                // Check if text existed
                if (this.data[k].lineIndex !== undefined && this.data[k].lineIndex !== null) {
                    this.data[k].detectedLineIndex = line.lineNum;
                }
            }
        });

        const count = validLines.length;
        console.log(`[GazeDataManager] V3 Line Detection: Found ${count} lines.`, validLines);
        return count;
    }
}
