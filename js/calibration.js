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
        if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
    }

    /**
     * Called when the user clicks "Start Point" button.
     * We start a strict timer here. If calibration doesn't finish in 8-10s, we force finish.
     */
    startCollection() {
        this.ctx.logI("cal", "startCollection: Starting strict watchdog (10s)");

        // Clear old
        if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);

        // 10 seconds max wait for 1 point
        this.state.maxWaitTimer = setTimeout(() => {
            if (this.state.running) {
                this.ctx.logW("cal", "Calibration timed out (10s limit). Showing fail popup.");
                this.showFailPopup();
            }
        }, 10000);
    }

    showFailPopup() {
        // Stop visual updates but keep session alive?
        // Ideally we want to let user choose.
        const popup = document.getElementById("cal-fail-popup");
        if (popup) {
            popup.style.display = "flex";

            // Bind buttons if not already (simple way: onclick property)
            const btnRetry = document.getElementById("btn-cal-retry");
            const btnSkip = document.getElementById("btn-cal-skip");

            if (btnRetry) {
                btnRetry.onclick = () => {
                    popup.style.display = "none";
                    this.retryPoint();
                };
            }
            if (btnSkip) {
                btnSkip.onclick = () => {
                    popup.style.display = "none";
                    this.finishSequence();
                };
            }
        }
    }

    retryPoint() {
        this.ctx.logI("cal", "Retrying calibration point...");
        // Reset local state for this point
        this.state.running = true; // Keep running or wait for button?
        this.state.progress = 0;
        this.state.displayProgress = 0;

        // Strategy: Show the "Start Point" button again so user can position themselves and click.
        const btn = document.getElementById("btn-calibration-start");
        if (btn) {
            btn.style.display = "inline-block";
            btn.textContent = "Retry Point";
            btn.style.pointerEvents = "auto";
        }

        // We technically interrupt the current "collection" (visual only). 
        // SDK might still be thinking it's collecting. 
        // When user clicks "Start", we call `seeso.startCollectSamples()` again. This usually resets collection for the point.
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

                // (Old safety timer logic removed - we now strictly use startCollection timer)

                if (progress >= 1.0) {
                    // If progress reaches 1.0, clear the maxWaitTimer as we're proceeding to finish
                    if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
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
        if (this.state.maxWaitTimer) { clearTimeout(this.state.maxWaitTimer); this.state.maxWaitTimer = null; }

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
        // Smooth lerp, but snap to 0 if target is 0 to avoid artifacts
        const target = this.state.progress || 0;
        if (target === 0) {
            this.state.displayProgress = 0;
        } else {
            this.state.displayProgress += (target - this.state.displayProgress) * 0.1;
        }

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

        // Only show % if > 0 to maintain clean look? Or user wants 0%?
        // User said "Start from 0%". So always show.
        ctx.fillText(`${Math.round(p * 100)}%`, cx, cy - 30);
    }
}
