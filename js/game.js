/**
 * The Book Wardens: Game Logic
 */

const Game = {
    state: {
        gems: 0,
        currentWordIndex: 0,
        readProgress: 0, // 0..100
        isTracking: false,
        rift: {
            currentWord: null,
            dwellTime: 0,
            requiredDwell: 1000, // 1 second to fix
            totalRifts: 0,
            fixedRifts: 0
        }
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

        // Count total rifts
        const rifts = document.querySelectorAll('.rift-word');
        this.state.rift.totalRifts = rifts.length;
        this.state.rift.fixedRifts = 0;
        this.updateProgressBar();
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
            // Show only if enough rifts are sealed (e.g. > 90%)
            const riftsTotal = this.state.rift.totalRifts || 1;
            const fixed = this.state.rift.fixedRifts;
            const isReady = (fixed / riftsTotal) > 0.9;
            btnConfront.style.display = isReady ? "block" : "none";
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

        // Rift Cleansing Logic
        const el = document.elementFromPoint(x, y);

        // 1. hit test for rift words
        if (el && el.classList.contains('rift-word') && !el.classList.contains('fixed')) {
            if (this.state.rift.currentWord !== el) {
                // New word target
                this.state.rift.currentWord = el;
                this.state.rift.dwellTime = 0;
                // Optional: visuals for 'locking on'
                el.style.transform = "scale(1.1)";
            } else {
                // Dwell
                this.state.rift.dwellTime += 100; // approximate since onGaze is throttled or called per frame
                if (this.state.rift.dwellTime >= this.state.rift.requiredDwell) {
                    this.cleanseRiftWord(el);
                }
            }
        } else {
            // Lost focus
            if (this.state.rift.currentWord) {
                this.state.rift.currentWord.style.transform = ""; // Reset scale
                this.state.rift.currentWord = null;
                this.state.rift.dwellTime = 0;
            }

            // Standard reading progress (fallback)
            if (el && (el.tagName === 'P' || el.closest('.book-container'))) {
                // Slow background progress just for reading text
                // this.state.readProgress += 0.05; 
                // this.updateProgressBar();
            }
        }
    },

    cleanseRiftWord(el) {
        el.classList.add('fixed');
        // Reset state
        this.state.rift.currentWord = null;
        this.state.rift.dwellTime = 0;
        el.style.transform = ""; // Reset scale

        // Gems/Score
        this.state.gems += 5;
        this.updateUI();

        // Progress
        this.state.rift.fixedRifts++;
        this.updateProgressBar();
        this.updatePageUI();

        // Sound or detailed visual effect could trigger here
    },

    onCalibrationFinish() {
        console.log("Calibration finished. Starting Owl Scene.");
        this.startOwlScene();
    },

    updateProgressBar() {
        const bar = document.getElementById("read-progress");
        if (bar) {
            // Calculate based on fixed rifts
            const total = this.state.rift.totalRifts || 1;
            const fixed = this.state.rift.fixedRifts;
            const pct = Math.min(100, Math.floor((fixed / total) * 100));

            bar.style.width = pct + "%";
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

// --- Typewriter Mode Logic (New) ---
typewriter: {
    paragraphs: [
        "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”",

        "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",

        "There was nothing so VERY remarkable in that; nor did Alice think it so VERY much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!” (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural);",

        "But when the Rabbit actually TOOK A WATCH OUT OF ITS WAISTCOAT-POCKET, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it.",

        "In another moment down went Alice after it, never once considering how in the world she was to get out again. The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well."
    ],
        quizzes: [
            { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
            { q: "What did Alice see?", o: ["A White Rabbit.", "A Cheshire Cat.", "A Mad Hatter."], a: 0 },
            { q: "What did the Rabbit say?", o: ["I'm hungry!", "Oh dear! I shall be late!", "Hello Alice!"], a: 1 },
            { q: "What did the Rabbit pull out?", o: ["A carrot.", "A watch.", "A map."], a: 1 },
            { q: "Where did Alice fall?", o: ["Up a tree.", "Into a deep well.", "Into a river."], a: 1 }
        ],
            currentParaIndex: 0,
                currentText: "",
                    charIndex: 0,
                        timer: null,
                            isPaused: false,

                                start() {
        // Reset
        this.currentParaIndex = 0;
        const el = document.getElementById("book-content");
        if (el) {
            el.innerHTML = "";
            el.style.columnCount = "1"; // Reset column layout if any
            el.style.height = "auto";
            el.style.overflowY = "auto";
        }
        this.playNextParagraph();
    },

    playNextParagraph() {
        const el = document.getElementById("book-content");
        if (!el) return;

        // Clear screen for new paragraph (User Req: 1. Empty screen ... 4. Like this repeatedly)
        // Wait, User said: "1. Empty screen... 4. Like this repeatedly (implying sequence)... 5. After paragraph ends... 6. If all done..."
        // "1번으로 돌아간다" means after quiz, screen clears again.
        el.innerHTML = "";

        if (this.currentParaIndex >= this.paragraphs.length) {
            Game.switchScreen("screen-win");
            return;
        }

        this.currentText = this.paragraphs[this.currentParaIndex];
        this.charIndex = 0;
        this.isPaused = false;

        // Create P
        this.currentP = document.createElement("p");
        // Add style for visibility
        this.currentP.style.fontSize = "1.8rem";
        this.currentP.style.lineHeight = "1.8";
        this.currentP.style.fontFamily = "'Crimson Text', serif";
        this.currentP.style.margin = "20px";
        el.appendChild(this.currentP);

        // Start typing
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.tick(), 50); // Speed 50ms
    },

    tick() {
        if (this.isPaused) return;

        this.charIndex++;
        this.currentP.textContent = this.currentText.substring(0, this.charIndex);

        // Auto-scroll to bottom if needed (User mentioned 'scroll up' code, assuming we just follow bottom)
        const el = document.getElementById("book-content");
        if (el) el.scrollTop = el.scrollHeight;

        if (this.charIndex >= this.currentText.length) {
            clearInterval(this.timer);
            this.isPaused = true;

            // 1 sec delay then Quiz
            setTimeout(() => {
                this.showVillainQuiz();
            }, 1000);
        }
    },

    showVillainQuiz() {
        const modal = document.getElementById("villain-modal");
        const qEl = document.getElementById("quiz-text");
        const oEl = document.getElementById("quiz-options");

        if (!modal || !qEl || !oEl) return;

        // Get quiz
        const qData = this.quizzes[this.currentParaIndex] || { q: "Continue?", o: ["Yes", "No", "Maybe"], a: 0 };

        qEl.textContent = qData.q;
        oEl.innerHTML = "";

        qData.o.forEach((optText, idx) => {
            const btn = document.createElement("button");
            btn.className = "quiz-btn";
            btn.textContent = optText;
            btn.onclick = () => {
                if (idx === qData.a) {
                    btn.classList.add("correct");
                    setTimeout(() => {
                        modal.style.display = "none";
                        this.onQuizCorrect();
                    }, 500);
                } else {
                    btn.classList.add("wrong");
                    setTimeout(() => btn.classList.remove("wrong"), 500);
                }
            };
            oEl.appendChild(btn);
        });

        modal.style.display = "flex";
    },

    onQuizCorrect() {
        this.currentParaIndex++;
        this.playNextParagraph();
    }
},

// Override startReadingSession
startReadingSession() {
    console.log("Starting Typewriter Logic...");

    // Show gaze dot?
    if (typeof window.showGazeDot === "function") window.showGazeDot(999999);

    // Setup UI
    const el = document.getElementById("book-content");
    if (el) {
        // Reset styles specific to Rift mode if any
        el.style.columnWidth = "auto";
        el.style.columnGap = "normal";
    }

    // Hide rift specific UI
    const bar = document.querySelector(".rift-seal-bar");
    if (bar) bar.style.display = "none";

    // Start Typewriter
    this.typewriter.start();
}
};

// Expose to window for HTML onclicks
window.Game = Game;

// Boot game when DOM ready
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});
