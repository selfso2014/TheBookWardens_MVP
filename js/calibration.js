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

        // 5 seconds max wait for 1 point (Emergency Reduction)
        this.state.maxWaitTimer = setTimeout(() => {
            if (this.state.running) {
                this.ctx.logW("cal", "Calibration timed out (5s limit). Showing fail popup.");
                this.showFailPopup();
            }
        }, 5000);
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
                    btn.textContent = (this.state.pointCount === 1) ? "Look At The Dot" : "Next Point";

                    // [FIX] Reset Position to CSS Default (Bottom Center)
                    // Removing absolute overrides that placed it near the dot
                    btn.style.position = '';
                    btn.style.left = '';
                    btn.style.top = '';

                    /* Legacy: Placed near the dot
                    btn.style.position = 'absolute';
                    btn.style.left = (x - 40) + 'px'; // Center roughly (assuming button width ~80px)
                    btn.style.top = (y + 30) + 'px'; // Below the dot
                    */

                    btn.style.pointerEvents = "auto";

                    // Add delay logic to button click in index.html or here?
                    // Currently index.html calls seeso.startCollectSamples().
                    // We should override it here/ensure it works.
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
                    if (this.state.softFinishTimer) clearTimeout(this.state.softFinishTimer);

                    this.state.watchdogTimer = setTimeout(() => {
                        this.state.watchdogTimer = null;
                        if (this.state.running && this.state.pointCount >= 1) {
                            this.ctx.logW("cal", "Force finishing calibration (watchdog 100%)");
                            this.finishSequence();
                        }
                    }, 700);
                } else {
                    if (this.state.watchdogTimer) {
                        clearTimeout(this.state.watchdogTimer);
                        this.state.watchdogTimer = null;
                    }

                    // Soft Finish Guard: If we are > 85% done, don't let it hang forever.
                    if (progress > 0.85 && !this.state.softFinishTimer) {
                        this.state.softFinishTimer = setTimeout(() => {
                            this.ctx.logW("cal", "Soft finish triggered (>85% stuck)");
                            this.finishSequence();
                        }, 2500);
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

        // Smooth lerp for progress
        const target = this.state.progress || 0;
        if (target === 0) {
            this.state.displayProgress = 0;
        } else {
            this.state.displayProgress += (target - this.state.displayProgress) * 0.1;
        }

        const p = this.state.displayProgress;
        const cx = pt.x;
        const cy = pt.y;

        // --- NEW LOGIC: Rotating Ellipse ---
        // Initialize rotation angle if not present
        if (typeof this.rotationAngle === 'undefined') this.rotationAngle = 0;

        // 1. Calculate Rotation Speed (Base + Acceleration)
        // Base speed: 0.05 rad/frame (slow spin)
        // Acceleration: up to +0.4 rad/frame based on progress
        const speed = 0.05 + (p * 0.4);
        this.rotationAngle += speed;

        // 2. Color Shift (Blue -> Bright Cyan/White)
        // R: 0 -> 100
        // G: 100 -> 255
        // B: 255 (Always Blue base)
        const r = Math.round(p * 100);
        const g = Math.round(100 + p * 155);
        const b = 255;
        const color = `rgb(${r}, ${g}, ${b})`;

        // 3. Draw Rotating Ellipse
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.rotationAngle);

        ctx.beginPath();
        // Ellipse shape: Width 7.5, Height 2.4 (1.5x of previous 5x1.6)
        ctx.ellipse(0, 0, 7.5, 2.4, 0, 0, Math.PI * 2);
        ctx.lineWidth = 2.25; // 1.5 * 1.5
        ctx.strokeStyle = color;
        // Optional: Add glow
        ctx.shadowBlur = 6; // 4 * 1.5 = 6
        ctx.shadowColor = color;
        ctx.stroke();

        ctx.restore();

        // 4. Draw Center Fixed Dot (For Gaze Fixation)
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2); // 2 * 1.5 = 3
        ctx.fillStyle = "white";
        ctx.shadowBlur = 0; // Reset shadow for crisp dot
        ctx.fill();

        // Text (Optional - kept commented out as per original)
        /*
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(p * 100)}%`, cx, cy - 20);
        */
    }
}
