/**
 * CalibrationManager
 * Handles SeeSo calibration callbacks, logic, and rendering.
 */
export class CalibrationManager {
    constructor(context) {
        this.ctx = context; // { logI, logW, logE, setStatus, setState, requestRender, onCalibrationFinish }

        this.state = {
            point: null,         // {x,y}
            progress: 0,
            displayProgress: 0,  // Smoothed
            running: false,
            pointCount: 0,
            isFinishing: false,
            watchdogTimer: null,
        };
    }

    reset() {
        this.state.pointCount = 0;
        this.state.point = null;
        this.state.progress = 0;
        this.state.isFinishing = false;
        this.state.running = false;
        if (this.state.watchdogTimer) clearTimeout(this.state.watchdogTimer);
        if (this.state.safetyTimer) clearTimeout(this.state.safetyTimer);
    }

    /**
     * Binds to the SeeSo instance.
     */
    bindTo(seeso) {
        if (!seeso) return;
        const { logI, logW, logE, setStatus, setState, requestRender, onCalibrationFinish } = this.ctx;

        // 1. Next Point
        if (typeof seeso.addCalibrationNextPointCallback === "function") {
            seeso.addCalibrationNextPointCallback((x, y) => {
                this.state.isFinishing = false;
                this.state.pointCount = (this.state.pointCount || 0) + 1;

                // Clear previous watchdog
                if (this.state.watchdogTimer) {
                    clearTimeout(this.state.watchdogTimer);
                    this.state.watchdogTimer = null;
                }
                // Clear safety timer
                if (this.state.safetyTimer) {
                    clearTimeout(this.state.safetyTimer);
                    this.state.safetyTimer = null;
                }

                this.state.point = { x, y };
                this.state.running = true;
                this.state.progress = 0;
                this.state.displayProgress = 0;

                logI("cal", `onCalibrationNextPoint (#${this.state.pointCount}) x=${x} y=${y}`);

                // Update UI
                const statusEl = document.getElementById("calibration-status");
                if (statusEl) {
                    statusEl.textContent = `Look at the Magic Orb! (${this.state.pointCount}/1)`;
                    statusEl.style.color = "#0f0";
                    statusEl.style.textShadow = "0 0 10px #0f0";
                }

                const btn = document.getElementById("btn-calibration-start");
                if (btn) {
                    btn.style.display = "inline-block";
                    btn.textContent = `Start Point ${this.state.pointCount}`;
                    btn.style.pointerEvents = "auto";
                }
            });
            logI("sdk", "addCalibrationNextPointCallback bound (CalibrationManager)");
        }

        // 2. Progress
        if (typeof seeso.addCalibrationProgressCallback === "function") {
            seeso.addCalibrationProgressCallback((progress) => {
                if (this.state.isFinishing) return;

                this.state.progress = progress;
                const pct = Math.round(progress * 100);
                setStatus(`Calibrating... ${pct}% (Point ${this.state.pointCount}/1)`);
                setState("cal", `running (${pct}%)`);

                // Watchdog & Safety
                // If progress > 70% and stalls for 5s, force finish.
                if (progress > 0.7 && !this.state.safetyTimer) {
                    this.state.safetyTimer = setTimeout(() => {
                        logW("cal", `Safety timeout (5s) triggered at >70%`);

                        // Force finish if still running
                        if (this.state.running) {
                            logW("cal", "Force finishing calibration (stalled)");
                            this.finishSequence();
                        }
                    }, 5000);
                }

                if (progress >= 1.0) {
                    if (this.state.watchdogTimer) clearTimeout(this.state.watchdogTimer);

                    this.state.watchdogTimer = setTimeout(() => {
                        this.state.watchdogTimer = null;
                        if (this.state.running && this.state.pointCount >= 1) {
                            logW("cal", "Force finishing calibration (watchdog 100%)");
                            this.finishSequence();
                        }
                    }, 700);
                } else {
                    if (this.state.watchdogTimer) {
                        clearTimeout(this.state.watchdogTimer);
                        this.state.watchdogTimer = null;
                    }

                }

                // Trigger render update
                requestRender();
            });
            logI("sdk", "addCalibrationProgressCallback bound (CalibrationManager)");
        }


        // 3. Finish
        if (typeof seeso.addCalibrationFinishCallback === "function") {
            seeso.addCalibrationFinishCallback((calibrationData) => {
                logI("cal", "onCalibrationFinished - Success");
                this.state.isFinishing = true;
                // Force visual 100%
                this.state.progress = 1.0;
                this.state.displayProgress = 1.0;
                requestRender();

                setStatus("Calibration Complete!");
                setState("cal", "finished");

                // Wait 2s then finish
                setTimeout(() => {
                    this.finishSequence();
                }, 2000);
            });
            logI("sdk", "addCalibrationFinishCallback bound (CalibrationManager)");
        }
    }

    finishSequence() {
        this.state.running = false;
        this.state.point = null;

        // Clear all timers
        if (this.state.watchdogTimer) { clearTimeout(this.state.watchdogTimer); this.state.watchdogTimer = null; }
        if (this.state.safetyTimer) { clearTimeout(this.state.safetyTimer); this.state.safetyTimer = null; }

        this.ctx.requestRender();

        const stage = document.getElementById("stage");
        if (stage) stage.classList.remove("visible");

        if (this.ctx.onCalibrationFinish) {
            this.ctx.onCalibrationFinish();
        }
    }

    // Draw Logic
    render(ctx, width, height, toCanvasLocalPoint) {
        if (!this.state.running || !this.state.point) return;

        const pt = toCanvasLocalPoint(this.state.point.x, this.state.point.y) || this.state.point;

        // Smooth lerp
        const target = this.state.progress || 0;
        this.state.displayProgress += (target - this.state.displayProgress) * 0.1;

        const p = this.state.displayProgress;

        // Draw Orb
        const r = 255;
        const g = Math.round(255 * (1 - p));
        const b = Math.round(255 * (1 - p));
        const color = `rgb(${r}, ${g}, ${b})`;
        const scale = 12.5;

        const cx = pt.x;
        const cy = pt.y;

        // Glow
        const grad = ctx.createRadialGradient(cx, cy, scale * 0.2, cx, cy, scale * 2.0);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // Text
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(p * 100)}%`, cx, cy - 30);
    }
}
