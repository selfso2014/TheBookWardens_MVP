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
    // --- FACE CHECK LOGIC ---
    startFaceCheck() {
        this.ctx.logI("cal", "Starting Face Check Mode");

        const faceScreen = document.getElementById("screen-face-check");
        const calScreen = document.getElementById("screen-calibration");

        if (faceScreen) {
            faceScreen.classList.add("active");
            faceScreen.style.display = "flex"; // Ensure flex display
        }
        if (calScreen) {
            calScreen.classList.remove("active");
            calScreen.style.display = "none";
        }

        // Reset UI
        this.updateFaceCheckUI(false);

        // Bind Next Button
        const btnNext = document.getElementById("btn-face-next");
        if (btnNext) {
            btnNext.onclick = () => {
                this.ctx.logI("cal", "Face Check Passed. Proceeding to Calibration.");
                // Hide Face Check
                if (faceScreen) {
                    faceScreen.classList.remove("active");
                    faceScreen.style.display = "none";
                }
                // Show Calibration Screen
                if (calScreen) {
                    calScreen.classList.add("active");
                    calScreen.style.display = "block";
                }

                // Start Actual Calibration
                // This will trigger 'startCalibration' in app.js if wired correctly,
                // But here we might need to callback to app.js or call seeso directly.
                // Better pattern: The 'Start Game' button in app.js should call this manager,
                // and this manager calculates when to call app.startCalibration().
                if (this.ctx.onFaceCheckSuccess) {
                    this.ctx.onFaceCheckSuccess();
                }
            };
        }
    }

    handleFaceCheckGaze(trackingState) {
        // trackingState: 0 (TRACKING), 1 (FILTER), 2 (FACE_MISSING) usually.
        // We consider 0 as success.
        const isTracking = (trackingState === 0);
        this.updateFaceCheckUI(isTracking);
    }

    updateFaceCheckUI(isTracking) {
        const icon = document.getElementById("face-guide-icon");
        const status = document.getElementById("face-check-status");
        const btn = document.getElementById("btn-face-next");
        const frame = document.querySelector(".face-frame");

        if (isTracking) {
            // Success
            if (icon) icon.style.opacity = "1";
            if (status) {
                status.textContent = "Perfect! Hold this position.";
                status.style.color = "#00ff00";
            }
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
                btn.style.boxShadow = "0 0 15px #00e5ff";
            }
            if (frame) frame.style.borderColor = "#00ff00";
        } else {
            // Fail
            if (icon) icon.style.opacity = "0";
            if (status) {
                status.textContent = "Face not detected...";
                status.style.color = "#aaa";
            }
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
                btn.style.boxShadow = "none";
            }
            if (frame) frame.style.borderColor = "rgba(255, 255, 255, 0.3)";
        }
    }

    /**
     * Called when calibration starts (after Face Check).
     */
    startCollection() {
        this.ctx.logI("cal", "startCollection: Starting strict watchdog (10s)");

        // Clear old
        if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);

        // 10 seconds max wait for the whole calibration or single point?
        // Let's allow 10s per point to be safe.
        this.state.maxWaitTimer = setTimeout(() => {
            if (this.state.running) {
                this.ctx.logW("cal", "Calibration timed out (10s limit). Showing fail popup.");
                this.showFailPopup();
            }
        }, 10000);
    }

    showFailPopup() {
        const popup = document.getElementById("cal-fail-popup");
        if (popup) {
            popup.style.display = "flex";

            // Re-bind buttons dynamically to ensure they work even after DOM updates
            const btnRetry = document.getElementById("btn-cal-retry");
            const btnSkip = document.getElementById("btn-cal-skip");

            // Remove old listeners (cloning is a quick hack, or just reassign onclick)
            // Assigning onclick overrides previous handlers, which is safer here.

            if (btnRetry) {
                btnRetry.onclick = () => {
                    popup.style.display = "none";
                    this.retryPoint();
                };
            }
            if (btnSkip) {
                btnSkip.onclick = () => {
                    popup.style.display = "none";
                    this.ctx.logW("cal", "User skipped calibration via popup.");
                    this.finishSequence(); // Proceed to game
                };
            }
        } else {
            this.ctx.logE("cal", "Fail popup not found in DOM!");
            // Fallback: Just finish if UI is broken
            this.finishSequence();
        }
    }

    retryPoint() {
        this.ctx.logI("cal", "Retrying calibration point...");
        // Reset local state
        this.state.running = true;
        this.state.progress = 0;
        this.state.displayProgress = 0;

        // Restart timeout
        this.startCollection();

        // If we need to trigger SDK again:
        // In some SDK versions, you just need to wait. In others, you might re-call startCollectSamples.
        // For SeeSo, if collection timed out, we might need to restart it.
        // We'll rely on app.js or the user clicking "Start Point" again if we reset UI.

        // Let's reset the UI button to "Retry" so user can physically click it again
        const btn = document.getElementById("btn-calibration-start");
        if (btn) {
            btn.style.display = "inline-block";
            btn.textContent = "Retry Point";
            btn.style.pointerEvents = "auto";
        }
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

                // Clear wait timer (will re-start in startCollection if manual, or here?)
                // Actually startCollection is called manually by button click usually.
                // But for Point 2+, it's automatic?
                // For 1-point, this is called once.

                this.state.point = { x, y };
                this.state.running = true;
                this.state.progress = 0;
                this.state.displayProgress = 0;

                logI("cal", `onCalibrationNextPoint (#${this.state.pointCount}) x=${x} y=${y}`);

                // Update UI
                const statusEl = document.getElementById("calibration-status");
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.textContent = "Look at the Magic Orb!";
                    statusEl.style.color = "#0f0";
                    statusEl.style.textShadow = "0 0 10px #0f0";
                }

                const btn = document.getElementById("btn-calibration-start");
                if (btn) {
                    // Show button for user to 'Start Collection'
                    btn.style.display = "inline-block";
                    btn.textContent = "Start";
                    btn.style.pointerEvents = "auto";

                    // Reset styling
                    btn.style.position = '';
                    btn.style.left = '';
                    btn.style.top = '';
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
                setStatus(`Calibrating... ${pct}%`);
                setState("cal", `running (${pct}%)`);

                if (progress >= 1.0) {
                    // Clear timeout on success
                    if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
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

                // Clear timeouts
                if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);

                this.state.isFinishing = true;
                this.state.progress = 1.0;
                this.state.displayProgress = 1.0;
                requestRender();

                setStatus("Calibration Complete!");
                setState("cal", "finished");

                // Wait 1.5s then finish
                setTimeout(() => {
                    this.finishSequence();
                }, 1500);
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

        const calScreen = document.getElementById("screen-calibration");
        if (calScreen) calScreen.style.display = 'none';

        if (this.ctx.onCalibrationFinish) {
            this.ctx.onCalibrationFinish();
        }
    }

    // Draw Logic
    render(ctx, width, height, toCanvasLocalPoint) {
        // ... (Keep existing renderer)
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
    }
}
