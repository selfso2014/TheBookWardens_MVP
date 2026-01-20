
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

        // Ensure valid numbers
        if (typeof x !== 'number' || typeof y !== 'number') return;

        // 1. Gaussian Smoothing (x, y -> gx, gy)
        this.buffer.push({ x, y });
        if (this.buffer.length > 5) this.buffer.shift();

        let gx = x, gy = y;
        if (this.buffer.length === 5) {
            let sumX = 0, sumY = 0, sumK = 0;
            for (let i = 0; i < 5; i++) {
                sumX += this.buffer[i].x * this.KERNEL[i];
                sumY += this.buffer[i].y * this.KERNEL[i];
                sumK += this.KERNEL[i];
            }
            gx = sumX / sumK;
            gy = sumY / sumK;
        }

        // 2. Velocity Calculation (vx, vy & gvx, gvy)
        let vx = 0, vy = 0, gvx = 0, gvy = 0;
        const last = this.data[this.data.length - 1];
        if (last) {
            const dt = t - last.t;
            if (dt > 0) {
                vx = (x - last.x) / dt;
                vy = (y - last.y) / dt;
                gvx = (gx - last.gx) / dt;
                gvy = (gy - last.gy) / dt;
            }
        }

        // 3. Eye Movement Classification
        // 0: Fixation, 2: Saccade, Others: Unknown
        let type = 'Unknown';
        if (gazeInfo.eyemovementState === 0) type = 'Fixation';
        else if (gazeInfo.eyemovementState === 2) type = 'Saccade';

        // --- Fallback: Velocity-based Identification (IVT) ---
        // If SDK returns Unknown or doesn't support state, use velocity threshold.
        // Threshold: e.g., 0.5 px/ms (approx 30 deg/sec depending on geometry, but pixels are easier here)
        // Adjust threshold as needed.
        if (type === 'Unknown') {
            const v = Math.sqrt(vx * vx + vy * vy);
            // Simple threshold: if velocity is very low, it's a fixation.
            // Note: v is in pixels / ms. 
            // 0.5 px/ms = 500 px/sec. 
            if (v < 0.5) type = 'Fixation';
            else type = 'Saccade';
        }

        // 4. Extremes (Simple placeholder logic)
        // Ideally needs a window to check if current point is peak/valley compared to neighbors
        let isPeakX = false;
        let isValleyX = false;
        if (this.data.length >= 2) {
            const prev = this.data[this.data.length - 1];
            const prev2 = this.data[this.data.length - 2];
            // Simple check: if direction changed? 
            // Or strictly local maxima/minima? 
            // Current point isn't peak until we see the "next" point go down.
            // So we actually detect peaks for the *previous* point here, or delay processing.
            // For now, leaving as placeholder or naive check against immediate history.
        }

        const entry = {
            t,
            x, y,
            gx, gy,
            vx, vy,
            gvx, gvy,
            type,
            isPeakX,
            isValleyX,
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

        // CSV Header
        let csv = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,LineIndex,CharIndex\n";

        // Rows
        this.data.forEach(d => {
            const row = [
                d.t,
                d.x, d.y,
                d.gx !== undefined ? d.gx.toFixed(2) : "",
                d.gy !== undefined ? d.gy.toFixed(2) : "",
                d.vx !== undefined ? d.vx.toFixed(4) : "",
                d.vy !== undefined ? d.vy.toFixed(4) : "",
                d.type,
                (d.lineIndex !== undefined && d.lineIndex !== null) ? d.lineIndex : "",
                (d.charIndex !== undefined && d.charIndex !== null) ? d.charIndex : ""
            ];
            csv += row.join(",") + "\n";
        });

        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `gaze_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    // --- Line Detection Algorithm (Mobile / Typewriter) ---
    detectLinesMobile() {
        if (this.data.length < 10) return 0;

        // 1. Gaussian Smoothing (Sigma = 3)
        // Kernel generation: size = 6*sigma + 1 = 19
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
        // Normalize
        for (let i = 0; i < kernelSize; i++) kernel[i] /= sumK;

        // Apply Convolution to X
        const x1 = new Float32Array(this.data.length);
        for (let i = 0; i < this.data.length; i++) {
            let sum = 0;
            let wSum = 0;
            for (let k = 0; k < kernelSize; k++) {
                const idx = i + (k - radius);
                if (idx >= 0 && idx < this.data.length) {
                    sum += this.data[idx].x * kernel[k];
                    wSum += kernel[k];
                }
            }
            x1[i] = sum / wSum;
        }

        // 2. Find Extremes
        const maxima = [];
        const minima = [];
        const win = 10;
        for (let i = win; i < x1.length - win; i++) {
            let isMax = true;
            let isMin = true;
            for (let j = 1; j <= win; j++) {
                if (x1[i] <= x1[i - j] || x1[i] <= x1[i + j]) isMax = false;
                if (x1[i] >= x1[i - j] || x1[i] >= x1[i + j]) isMin = false;
            }
            if (isMax) maxima.push({ index: i, value: x1[i], t: this.data[i].t });
            if (isMin) minima.push({ index: i, value: x1[i], t: this.data[i].t });
        }

        // 3. Regularity Assessment
        const validPeaks = [];
        const AMP_THRESHOLD = 50;
        const TIME_THRESHOLD = 500;

        for (let i = 0; i < maxima.length; i++) {
            const max = maxima[i];
            let prevMin = null;
            // Find most recent preceding min
            for (let j = minima.length - 1; j >= 0; j--) {
                if (minima[j].t < max.t) {
                    prevMin = minima[j];
                    break;
                }
            }

            if (prevMin) {
                const amp = max.value - prevMin.value;
                const duration = max.t - prevMin.t;

                if (amp > AMP_THRESHOLD && duration > 200) {
                    const lastValid = validPeaks[validPeaks.length - 1];
                    // Ensure not duplicate of same line scan (or too close)
                    if (!lastValid || (max.t - lastValid.t) > TIME_THRESHOLD) {
                        validPeaks.push(max);
                    }
                }
            }
        }

        const count = validPeaks.length;
        console.log(`[GazeDataManager] Line Detection: Found ${count} lines.`, validPeaks);
        return count;
    }
}
