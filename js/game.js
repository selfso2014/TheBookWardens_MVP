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

    // --- 1.5 Rune Sealing Mini-Game ---
    runeGame: {
        isActive: false,
        runes: [],
        sequence: [],
        currentIndex: 0,
        score: 0,
        timeLeft: 120,
        timer: null,
        gazeTimer: null,
        currentGazedRune: null,
        gazeDuration: 0,
        requiredGazeDuration: 500, // 0.5 seconds to activate (very fast)
        totalRounds: 3,
        currentRound: 0,
        runeSymbols: ['◈', '◆', '◇', '◉', '◎', '○', '●', '◐', '◑', '◒', '◓', '☆'],
    },

    startOwlScene() {
        this.state.isTracking = true;
        this.state.isOwlTracker = true;
        this.state.isRuneGame = false; // Not started yet
        this.switchScreen("screen-owl");
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }

        // Reset button text
        const btn = document.getElementById('btn-rune-game');
        if (btn) btn.textContent = 'Start Sealing';
    },

    startRuneGame() {
        // Initialize game
        this.runeGame.isActive = true;
        this.runeGame.currentRound = 0;
        this.runeGame.score = 0;
        this.runeGame.timeLeft = 120;
        this.state.isRuneGame = true;
        this.state.isOwlTracker = false;

        // Hide button, show game
        const btn = document.getElementById('btn-rune-game');
        if (btn) btn.style.display = 'none';

        // Update instruction
        const instruction = document.getElementById('rune-instruction');
        if (instruction) instruction.textContent = 'Gaze at the glowing runes in sequence!';

        // Start first round
        this.startRuneRound();
        this.startRuneTimer();
    },

    startRuneRound() {
        this.runeGame.currentRound++;
        this.runeGame.currentIndex = 0;
        this.runeGame.currentGazedRune = null;
        this.runeGame.gazeDuration = 0;

        // Simple: Always 3 runes, sequence of 3
        const numRunes = 3;
        const sequenceLength = 3;

        this.generateRunes(numRunes, sequenceLength);
        this.updateRuneUI();
    },

    generateRunes(count, sequenceLength) {
        const container = document.getElementById('rune-container');
        if (!container) return;

        container.innerHTML = '';
        this.runeGame.runes = [];
        this.runeGame.sequence = [];

        const containerRect = container.getBoundingClientRect();
        const runeSize = 50; // Smaller runes
        const padding = 60; // More padding for corner placement

        // Fixed positions for 3 runes: top-left, top-right, bottom-center
        const positions = [
            { x: padding, y: padding }, // Top-left
            { x: containerRect.width - runeSize - padding, y: padding }, // Top-right
            { x: (containerRect.width - runeSize) / 2, y: containerRect.height - runeSize - padding } // Bottom-center
        ];

        // Generate exactly 3 runes in fixed positions
        for (let i = 0; i < Math.min(count, 3); i++) {
            const rune = document.createElement('div');
            rune.className = 'rune';
            rune.dataset.index = i;

            const pos = positions[i];
            rune.style.left = pos.x + 'px';
            rune.style.top = pos.y + 'px';

            // Create symbol
            const symbol = document.createElement('div');
            symbol.className = 'rune-symbol';
            const randomSymbol = this.runeGame.runeSymbols[i % this.runeGame.runeSymbols.length];
            symbol.setAttribute('data-symbol', randomSymbol);

            rune.appendChild(symbol);
            container.appendChild(rune);

            this.runeGame.runes.push({
                element: rune,
                x: pos.x,
                y: pos.y,
                index: i
            });
        }

        // Random sequence of all 3 runes
        const shuffled = [0, 1, 2].sort(() => Math.random() - 0.5);
        this.runeGame.sequence = shuffled;

        // Highlight first target
        this.highlightCurrentTarget();
    },

    checkRuneOverlap(x, y, size) {
        const minDist = size * 1.5;
        return this.runeGame.runes.some(rune => {
            const dx = rune.x - x;
            const dy = rune.y - y;
            return Math.sqrt(dx * dx + dy * dy) < minDist;
        });
    },

    highlightCurrentTarget() {
        // Remove all highlights
        this.runeGame.runes.forEach(rune => {
            rune.element.classList.remove('target', 'locked', 'active');
        });

        if (this.runeGame.currentIndex < this.runeGame.sequence.length) {
            const targetIndex = this.runeGame.sequence[this.runeGame.currentIndex];
            const targetRune = this.runeGame.runes[targetIndex];
            if (targetRune) {
                targetRune.element.classList.add('target');
            }

            // Make non-target runes active but dimmed
            this.runeGame.runes.forEach((rune, idx) => {
                if (idx !== targetIndex) {
                    rune.element.classList.add('active');
                }
            });
        }
    },

    startRuneTimer() {
        if (this.runeGame.timer) clearInterval(this.runeGame.timer);

        this.runeGame.timer = setInterval(() => {
            this.runeGame.timeLeft--;
            this.updateRuneUI();

            if (this.runeGame.timeLeft <= 0) {
                this.endRuneGame(false);
            }
        }, 1000);
    },

    checkRuneGaze(x, y) {
        if (!this.runeGame.isActive) return;

        const container = document.getElementById('rune-container');
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const relX = x - containerRect.left;
        const relY = y - containerRect.top;

        // Check which rune is being gazed at
        let gazedRune = null;
        for (const rune of this.runeGame.runes) {
            const runeRect = rune.element.getBoundingClientRect();
            const runeRelX = runeRect.left - containerRect.left + runeRect.width / 2;
            const runeRelY = runeRect.top - containerRect.top + runeRect.height / 2;

            const dist = Math.sqrt(Math.pow(relX - runeRelX, 2) + Math.pow(relY - runeRelY, 2));

            if (dist < 200) { // 200px radius
                gazedRune = rune;
                break;
            }
        }

        // Update gaze state
        if (gazedRune) {
            if (this.runeGame.currentGazedRune !== gazedRune) {
                // New rune gazed
                this.runeGame.currentGazedRune = gazedRune;
                this.runeGame.gazeDuration = 0;
                gazedRune.element.classList.add('gazing');
            } else {
                // Continue gazing
                this.runeGame.gazeDuration += 50; // Assuming 50ms update rate

                // Update progress bar
                const progress = Math.min(100, (this.runeGame.gazeDuration / this.runeGame.requiredGazeDuration) * 100);
                const progressBar = document.getElementById('rune-progress-bar');
                if (progressBar) progressBar.style.width = progress + '%';

                // Check if gaze duration met
                if (this.runeGame.gazeDuration >= this.runeGame.requiredGazeDuration) {
                    this.activateRune(gazedRune);
                }
            }
        } else {
            // No rune gazed
            if (this.runeGame.currentGazedRune) {
                this.runeGame.currentGazedRune.element.classList.remove('gazing');
                this.runeGame.currentGazedRune = null;
                this.runeGame.gazeDuration = 0;

                const progressBar = document.getElementById('rune-progress-bar');
                if (progressBar) progressBar.style.width = '0%';
            }
        }
    },

    activateRune(rune) {
        const targetIndex = this.runeGame.sequence[this.runeGame.currentIndex];

        if (rune.index === targetIndex) {
            // Correct rune!
            rune.element.classList.add('success');
            rune.element.classList.remove('gazing', 'target');

            this.runeGame.score += 100 * (this.runeGame.currentRound);
            this.runeGame.currentIndex++;

            // Reset gaze
            this.runeGame.currentGazedRune = null;
            this.runeGame.gazeDuration = 0;
            const progressBar = document.getElementById('rune-progress-bar');
            if (progressBar) progressBar.style.width = '0%';

            // Check if sequence complete
            if (this.runeGame.currentIndex >= this.runeGame.sequence.length) {
                setTimeout(() => {
                    if (this.runeGame.currentRound >= this.runeGame.totalRounds) {
                        this.endRuneGame(true);
                    } else {
                        this.startRuneRound();
                    }
                }, 500);
            } else {
                this.highlightCurrentTarget();
            }

            this.updateRuneUI();
        } else {
            // Wrong rune - penalty
            rune.element.classList.remove('gazing');
            this.runeGame.timeLeft = Math.max(0, this.runeGame.timeLeft - 3);
            this.runeGame.currentGazedRune = null;
            this.runeGame.gazeDuration = 0;

            const progressBar = document.getElementById('rune-progress-bar');
            if (progressBar) progressBar.style.width = '0%';
        }
    },

    updateRuneUI() {
        const scoreEl = document.getElementById('rune-score');
        const timerEl = document.getElementById('rune-timer');
        const comboEl = document.getElementById('rune-combo');

        if (scoreEl) scoreEl.textContent = this.runeGame.score;
        if (timerEl) timerEl.textContent = this.runeGame.timeLeft;
        if (comboEl) comboEl.textContent = `${this.runeGame.currentIndex}/${this.runeGame.sequence.length}`;
    },

    endRuneGame(success) {
        this.runeGame.isActive = false;
        this.state.isRuneGame = false;

        if (this.runeGame.timer) {
            clearInterval(this.runeGame.timer);
            this.runeGame.timer = null;
        }

        const messageEl = document.getElementById('game-message');
        const titleEl = document.getElementById('message-title');
        const textEl = document.getElementById('message-text');

        if (success) {
            if (titleEl) titleEl.textContent = 'Rift Sealed!';
            if (textEl) textEl.textContent = `You earned ${this.runeGame.score} points! The path to knowledge is open.`;
            this.state.gems += Math.floor(this.runeGame.score / 10);
            this.updateUI();
        } else {
            if (titleEl) titleEl.textContent = 'Time Ran Out!';
            if (textEl) textEl.textContent = `You scored ${this.runeGame.score} points. Try again to seal the Rift!`;
        }

        if (messageEl) messageEl.classList.remove('hidden');

        // Auto-proceed or retry
        setTimeout(() => {
            if (messageEl) messageEl.classList.add('hidden');

            if (success) {
                this.startReadingFromOwl();
            } else {
                // Reset for retry
                const btn = document.getElementById('btn-rune-game');
                if (btn) {
                    btn.style.display = 'inline-flex';
                    btn.textContent = 'Try Again';
                }
            }
        }, 3000);
    },

    // Called from Owl screen button to begin reading
    startOwlScene() {
        // Show owl with eye tracking (no rune game)
        this.state.isTracking = true;
        this.state.isOwlTracker = true;
        this.state.isRuneGame = false;
        this.switchScreen("screen-owl");
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }
    },

    startReadingFromOwl() {
        // Stop owl tracking and start reading
        this.state.isOwlTracker = false;
        this.state.isRuneGame = false;
        this.switchScreen("screen-read");
        this.startReadingSession();
    },

    // --- 2. Reading Rift ---
    startReadingSession() {
        this.state.readProgress = 0;
        this.state.isTracking = true;
        this.state.isOwlTracker = false; // Stop owl tracking
        console.log("Reading session started. Waiting for gaze...");

        // Initialize Pagination
        this.state.currentPage = 1;
        const el = document.getElementById("book-content");
        if (el) {
            // Force precise column width to match content width (clientWidth - padding)
            // Padding is 20px * 2 = 40px
            const contentWidth = el.clientWidth - 40;
            el.style.columnWidth = contentWidth + "px";
            el.style.columnGap = "80px";

            el.scrollLeft = 0;
            el.scrollTop = 0;

            // Delay to allow layout update
            setTimeout(() => {
                const gap = 80;
                const pageWidth = contentWidth + gap;
                // scrollWidth should now be large
                this.state.totalPages = Math.ceil(el.scrollWidth / pageWidth);
                if (this.state.totalPages < 1) this.state.totalPages = 1;
                this.updatePageUI();
            }, 200);
        }

        // Show gaze dot indefinitely (user request)
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }
    },

    confrontVillain() {
        this.state.isTracking = false;
        this.switchScreen("screen-boss");
    },

    prevPage() {
        const el = document.getElementById("book-content");
        if (!el) return;

        if (this.state.currentPage > 1) {
            this.state.currentPage--;
            const gap = 80;
            // Use content width (clientWidth - padding 40)
            const pageWidth = (el.clientWidth - 40) + gap;
            el.scrollTo({ left: (this.state.currentPage - 1) * pageWidth, behavior: 'smooth' });
            this.updatePageUI();
        }
    },

    nextPage() {
        const el = document.getElementById("book-content");
        if (!el) return;

        if (this.state.currentPage < this.state.totalPages) {
            this.state.currentPage++;
            const gap = 80;
            const pageWidth = (el.clientWidth - 40) + gap;
            el.scrollTo({ left: (this.state.currentPage - 1) * pageWidth, behavior: 'smooth' });
            this.updatePageUI();
        }
    },
    updatePageUI() {
        const ind = document.getElementById("page-indicator");
        const btnPrev = document.getElementById("btn-page-prev");
        const btnNext = document.getElementById("btn-page-next");
        const btnConfront = document.getElementById("btn-confront-villain");

        const total = this.state.totalPages || 1;
        const current = this.state.currentPage;
        const isLast = current >= total;

        if (ind) ind.textContent = `Page ${current} / ${total}`;
        if (btnPrev) btnPrev.disabled = (current <= 1);
        if (btnNext) btnNext.disabled = isLast;

        if (btnConfront) {
            // Show only on the last page
            btnConfront.style.display = isLast ? "block" : "none";
        }
    },

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Rune Game Interaction (highest priority)
        if (this.state.isRuneGame && this.runeGame.isActive) {
            this.checkRuneGaze(x, y);

            // Still move owl eyes in background
            const pupils = document.querySelectorAll('.pupil');
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const maxMove = 15;
            let dx = (x - cx) / (window.innerWidth / 2) * maxMove;
            let dy = (y - cy) / (window.innerHeight / 2) * maxMove;
            dx = Math.max(-maxMove, Math.min(maxMove, dx));
            dy = Math.max(-maxMove, Math.min(maxMove, dy));
            pupils.forEach(p => {
                p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            });
            return;
        }

        // Owl Interaction
        if (this.state.isOwlTracker) {
            const pupils = document.querySelectorAll('.pupil');
            const cx = window.innerWidth / 2;
            // Owl is vertically roughly center-ish? Let's assume center for simplicity
            const cy = window.innerHeight / 2;

            const maxMove = 20; // range of motion

            // Simple mapping: Gaze pos -> pupil offset
            let dx = (x - cx) / (window.innerWidth / 2) * maxMove;
            let dy = (y - cy) / (window.innerHeight / 2) * maxMove;

            // Clamp
            dx = Math.max(-maxMove, Math.min(maxMove, dx));
            dy = Math.max(-maxMove, Math.min(maxMove, dy));

            pupils.forEach(p => {
                p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            });
            return;
        }

        // Only active in reading screen
        const readScreen = document.getElementById("screen-read");
        if (!readScreen || !readScreen.classList.contains("active")) return;

        // Hit test: is the user looking at the text?
        const el = document.elementFromPoint(x, y);
        if (el && (el.tagName === 'P' || el.closest('.book-container'))) {
            // Glow effect on text logic could go here
            // For now, simple progress accumulation
            this.state.readProgress += 0.2; // fill speed
            this.updateProgressBar();
        }
    },

    onCalibrationFinish() {
        console.log("Calibration finished. Starting Owl Scene.");
        this.startOwlScene();
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
