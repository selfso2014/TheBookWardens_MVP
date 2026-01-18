
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
    }

    /**
     * Process a single gaze frame from SeeSo SDK
     * @param {Object} gazeInfo - GazeInfo object from SeeSo SDK
     */
    processGaze(gazeInfo) {
        if (!gazeInfo) return;

        const t = gazeInfo.timestamp;
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
            sdkFixationY: gazeInfo.fixationY
        };

        this.data.push(entry);
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
    }

    exportCSV() {
        if (!this.data || this.data.length === 0) {
            alert("No gaze data to export.");
            return;
        }

        // CSV Header
        let csv = "Timestamp,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type\n";

        // Rows
        this.data.forEach(d => {
            const row = [
                d.t,
                d.x, d.y,
                d.gx !== undefined ? d.gx.toFixed(2) : "",
                d.gy !== undefined ? d.gy.toFixed(2) : "",
                d.vx !== undefined ? d.vx.toFixed(4) : "",
                d.vy !== undefined ? d.vy.toFixed(4) : "",
                d.type
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
}
