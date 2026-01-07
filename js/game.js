/**
 * The Book Wardens: Game Logic
 */

const Game = {
    state: {
        gems: 0,
        currentWordIndex: 0,
        readProgress: 0, // 0..100
        isTracking: false,
    },

    init() {
        console.log("Game Init");
        this.bindEvents();
        this.updateUI();

        // 3. Auto-start if redirected from In-App Browser
        const params = new URLSearchParams(window.location.search);
        if (params.get("skip") === "1" && !this.isInAppBrowser()) {
            console.log("Auto-starting game due to skip param");
            const startBtn = document.getElementById("btn-start-game");
            if (startBtn) {
                // Short delay to ensure page is settled
                setTimeout(() => startBtn.click(), 500);
            }
        }
    },

    bindEvents() {
        const startBtn = document.getElementById("btn-start-game");
        if (startBtn) {
            startBtn.onclick = async () => {
                // 1. Check In-App Browser
                if (this.isInAppBrowser()) {
                    this.openSystemBrowser();
                    return;
                }

                // 2. Normal Flow
                // UI Animation: Fake progress bar
                startBtn.style.display = "none";
                const loader = document.getElementById("loader-container");
                const bar = document.getElementById("loader-bar");
                if (loader && bar) {
                    loader.style.display = "block";
                    // Force reflow to ensure transition happens
                    bar.getBoundingClientRect();
                    bar.style.width = "100%";
                }

                // Switch screen after animation (800ms)
                setTimeout(() => {
                    this.switchScreen("screen-word");
                }, 800);

                // Initialize in background
                this.trackingInitPromise = (async () => {
                    try {
                        if (typeof window.startEyeTracking === "function") {
                            const ok = await window.startEyeTracking();
                            if (!ok) {
                                throw new Error("Permission denied or initialization failed.");
                            }
                            return true;
                        } else {
                            console.warn("window.startEyeTracking not found.");
                            return false; // Fallback mode?
                        }
                    } catch (e) {
                        console.error(e);
                        alert("Eye tracking initialization failed: " + e.message);
                        this.switchScreen("screen-home");

                        // Reset UI
                        if (startBtn) {
                            startBtn.style.display = "inline-block";
                            startBtn.disabled = false;
                            startBtn.textContent = "Enter the Rift";
                        }
                        if (loader && bar) {
                            loader.style.display = "none";
                            bar.style.width = "0%";
                        }
                        return false;
                    }
                })();
            };
        }
    },

    onCalibrationFinish() {
        console.log("Calibration done. Entering Reading Rift...");
        // Wait a moment for user to see success message
        setTimeout(() => {
            this.switchScreen("screen-read");
        }, 1000);
    },

    isInAppBrowser() {
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        return (
            /KAKAOTALK/i.test(ua) ||
            /FBAV/i.test(ua) ||
            /Line/i.test(ua) ||
            /Instagram/i.test(ua) ||
            /Snapchat/i.test(ua) ||
            /Twitter/i.test(ua) ||
            /DaumApps/i.test(ua)
        );
    },

    openSystemBrowser() {
        const url = window.location.href;
        if (/Android/i.test(navigator.userAgent)) {
            // Android: Intent to open Chrome
            // Append skip=1 to URL so we know to auto-start
            let newUrl = url;
            if (newUrl.indexOf("?") === -1) newUrl += "?skip=1";
            else if (newUrl.indexOf("skip=1") === -1) newUrl += "&skip=1";

            const noProtocol = newUrl.replace(/^https?:\/\//, "");
            const intentUrl = `intent://${noProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
            window.location.href = intentUrl;
        } else {
            // iOS/Others: Alert and Clipboard
            alert("Please copy the URL and open it in Safari or Chrome to play.");
            navigator.clipboard.writeText(url).then(() => {
                alert("URL copied to clipboard!");
            }).catch(() => { });
        }
    },

    switchScreen(screenId) {
        // Hide all
        document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
        // Show target
        const target = document.getElementById(screenId);
        if (target) target.classList.add("active");

        // Logic per screen
        if (screenId === "screen-read") {
            this.startReadingSession();
        }
    },

    updateUI() {
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.state.gems;
    },

    // --- 1. Word Forge ---
    async checkVocab(optionIndex) {
        // In a real app, check vs data. Luminous -> 1 (Shining)
        const isCorrect = (optionIndex === 1);
        if (isCorrect) {
            alert("Correct! +10 Gems");
            this.state.gems += 10;
            this.updateUI();

            // Move to Calibration before Reading
            // Ensure tracking is ready
            if (this.trackingInitPromise) {
                const ok = await this.trackingInitPromise;
                if (!ok) return; // Already handled in background, but stop here
            }

            this.switchScreen("screen-calibration");

            setTimeout(() => {
                if (typeof window.startCalibrationRoutine === "function") {
                    window.startCalibrationRoutine();
                } else {
                    // Fallback
                    this.switchScreen("screen-read");
                }
            }, 500);
        } else {
            alert("Try again!");
        }
    },

    // --- 2. Reading Rift ---
    startReadingSession() {
        this.state.readProgress = 0;
        this.state.isTracking = true;
        console.log("Reading session started. Waiting for gaze...");

        // Show gaze dot indefinitely (user request)
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }
    },

    confrontVillain() {
        this.state.isTracking = false;
        this.switchScreen("screen-boss");
    },

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Only active in reading screen
        const readScreen = document.getElementById("screen-read");
        if (!readScreen.classList.contains("active")) return;

        // Hit test: is the user looking at the text?
        const el = document.elementFromPoint(x, y);
        if (el && (el.tagName === 'P' || el.closest('.book-container'))) {
            // Glow effect on text logic could go here
            // For now, simple progress accumulation
            this.state.readProgress += 0.2; // fill speed
            this.updateProgressBar();
        }
    },

    updateProgressBar() {
        const bar = document.getElementById("read-progress");
        if (bar) {
            // Cap at 100
            let p = Math.min(100, this.state.readProgress);
            bar.style.width = p + "%";

            // Note: Auto-redirection removed. User clicks "Confront Villain" manually.
        }
    },

    // --- 3. Boss Battle ---
    checkBoss(optionIndex) {
        // Correct answer for "Why did Alice follow?" -> B. Bored / Curiosity (in simplified text)
        // Here we used "Bred" vs "Late". Text says "nothing to do".
        // Let's say Option 1 (Index 1) is correct.
        const isCorrect = (optionIndex === 1);

        if (isCorrect) {
            alert("Direct Hit! The Shadow fades...");
            this.state.gems += 50;
            this.updateUI();
            this.switchScreen("screen-win");
        } else {
            alert("The Shadow deflects your attack! Try reading carefully.");
        }
    }
};

// Expose to window for HTML onclicks
window.Game = Game;

// Boot game when DOM ready
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});
