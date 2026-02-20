export class UIManager {
    constructor(game) {
        this.game = game;
        this.toastTimer = null;
        this._animRafs = []; // [FIX] Track animateValue RAFs for cancellation
    }

    // --- Screen Management ---
    switchScreen(screenId) {
        // [FIX] Force close known overlay screens
        const overlays = ['screen-new-share', 'screen-new-score', 'screen-final-boss', 'alice-final-screen', 'alice-battle-simple-container', 'alice-screen'];
        overlays.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== screenId) {
                el.style.display = 'none';
                el.classList.remove('active');
            }
        });

        // Delegate to SceneManager for DOM class toggling
        if (this.game && this.game.sceneManager) {
            this.game.sceneManager.show(screenId);
        } else {
            // Fallback
            document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
            const target = document.getElementById(screenId);
            if (target) {
                target.classList.add("active");
                target.style.display = ""; // Clear inline display:none
            }
        }

        // [FIX] Ensure the new screen is clickable
        const newScreen = document.getElementById(screenId);
        if (newScreen) {
            newScreen.style.pointerEvents = 'auto';
            newScreen.style.zIndex = '9000'; // Make sure it's above canvas
        }

        // Reset Context Latching for Reader (Game specific logic linked to screen)
        if (screenId === "screen-read" && this.game) {
            this.game.lastValidContext = null;
        }
    }

    // --- Notifications ---
    showToast(msg, duration = 3000) {
        let toast = document.getElementById("game-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "game-toast";
            document.body.appendChild(toast);
        }

        // Clear existing timer if updating
        if (this.toastTimer) clearTimeout(this.toastTimer);

        toast.textContent = msg;
        toast.classList.add("show");

        this.toastTimer = setTimeout(() => {
            toast.classList.remove("show");
            this.toastTimer = null;
        }, duration);
    }

    // --- Loading Modal ---
    updateLoadingProgress(progress, status) {
        const modal = document.getElementById("sdk-loading-modal");
        if (modal && modal.style.display === "flex") {
            const bar = modal.querySelector(".sdk-progress-bar");
            const txt = modal.querySelector(".sdk-status-text");
            if (bar) bar.style.width = `${progress}%`;
            if (txt) txt.textContent = `${status} (${progress}%)`;

            // Auto-close if ready
            if (progress >= 100) {
                setTimeout(() => {
                    modal.style.display = "none";
                    // Resume pending action if game logic requires it (callback?)
                    // UIManager usually shouldn't know about game state pending actions.
                    // But Game can hook into this via status check or callback.
                    // For now, simple UI update.
                    if (this.game && this.game.onLoadingComplete) {
                        this.game.onLoadingComplete();
                    }
                }, 500);
            }
        } else {
            // Toast fallback
            if (progress < 100) {
                this.showToast(`${status} (${progress}%)`, 2000);
            }
        }
    }

    // [FIX] Cancel all in-flight animateValue loops (call before screen transition)
    cancelAnims() {
        this._animRafs.forEach(id => cancelAnimationFrame(id));
        this._animRafs = [];
    }

    // --- Utilities ---
    animateValue(id, start, end, duration, prefix = "", suffix = "", startDelay = 0) {
        setTimeout(() => {
            const obj = document.getElementById(id);
            if (!obj) return;
            let startTimestamp = null;
            let rafId;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                // Ease-out effect
                const ease = 1 - Math.pow(1 - progress, 3);
                const current = Math.floor(ease * (end - start) + start);
                obj.innerText = prefix + current.toLocaleString() + suffix;
                if (progress < 1) {
                    rafId = window.requestAnimationFrame(step);
                    // Keep the latest id in the list (replace old)
                    const idx = this._animRafs.indexOf(rafId);
                    if (idx === -1) this._animRafs.push(rafId);
                } else {
                    // Animation complete — remove from tracking list
                    this._animRafs = this._animRafs.filter(r => r !== rafId);
                }
            };
            rafId = window.requestAnimationFrame(step);
            this._animRafs.push(rafId);
        }, startDelay);
    }
}
