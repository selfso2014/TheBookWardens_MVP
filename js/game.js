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
            requiredDwell: 1000,
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
                startBtn.style.display = "none";
                const loader = document.getElementById("loader-container");
                const bar = document.getElementById("loader-bar");
                if (loader && bar) {
                    loader.style.display = "block";
                    bar.getBoundingClientRect();
                    bar.style.width = "100%";
                }

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
                            return false;
                        }
                    } catch (e) {
                        console.error(e);
                        alert("Eye tracking initialization failed: " + e.message);
                        this.switchScreen("screen-home");

                        if (startBtn) {
                            startBtn.style.display = "inline-block";
                            startBtn.disabled = false;
                            startBtn.textContent = "Enter the Rift";
                        }
                        return false;
                    }
                })();
            };
        }
    },

    onCalibrationFinish() {
        console.log("Calibration done. Entering Reading Rift...");
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
            let newUrl = url;
            if (newUrl.indexOf("?") === -1) newUrl += "?skip=1";
            else if (newUrl.indexOf("skip=1") === -1) newUrl += "&skip=1";

            const noProtocol = newUrl.replace(/^https?:\/\//, "");
            const intentUrl = `intent://${noProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
            window.location.href = intentUrl;
        } else {
            alert("Please copy the URL and open it in Safari or Chrome to play.");
            navigator.clipboard.writeText(url).then(() => {
                alert("URL copied to clipboard!");
            }).catch(() => { });
        }
    },

    switchScreen(screenId) {
        document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
        const target = document.getElementById(screenId);
        if (target) target.classList.add("active");

        if (screenId === "screen-read") {
            this.startReadingSession();
        }
    },

    updateUI() {
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.state.gems;

        const inkEl = document.getElementById("ink-count");
        if (inkEl) inkEl.textContent = this.state.ink || 0;
    },

    // --- 1. Word Forge ---
    async checkVocab(optionIndex) {
        const isCorrect = (optionIndex === 1);
        if (isCorrect) {
            alert("Correct! +10 Gems");
            this.state.gems += 10;
            this.updateUI();

            if (this.trackingInitPromise) {
                const ok = await this.trackingInitPromise;
                if (!ok) return;
            }

            this.switchScreen("screen-calibration");
            setTimeout(() => {
                if (typeof window.startCalibrationRoutine === "function") {
                    window.startCalibrationRoutine();
                } else {
                    this.switchScreen("screen-read");
                }
            }, 500);
        } else {
            alert("Try again!");
        }
    },

    // --- 1.5 Owl ---
    startOwlScene() {
        this.state.isTracking = true;
        this.state.isOwlTracker = true;
        this.switchScreen("screen-owl");
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }
    },

    startReadingFromOwl() {
        // Stop owl tracking and start reading
        this.state.isOwlTracker = false;
        this.switchScreen("screen-read");
        this.startReadingSession();
    },

    // --- 2. Reading Rift (Original Logic kept for reference, overlaid below) ---
    startReadingSession_OLD() {
        // ... existing logic ...
    },

    confrontVillain() {
        this.state.isTracking = false;
        this.switchScreen("screen-boss");
    },

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Owl Interaction
        if (this.state.isOwlTracker) {
            const pupils = document.querySelectorAll('.pupil');
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const maxMove = 20;

            let dx = (x - cx) / (window.innerWidth / 2) * maxMove;
            let dy = (y - cy) / (window.innerHeight / 2) * maxMove;
            dx = Math.max(-maxMove, Math.min(maxMove, dx));
            dy = Math.max(-maxMove, Math.min(maxMove, dy));

            pupils.forEach(p => {
                p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            });
            return;
        }

        // Typewriter Gaze Feedback
        if (this.typewriter && typeof this.typewriter.checkGazeDistance === "function") {
            // Pass Gaze Data
            this.typewriter.checkGazeDistance(x, y);
        }
    },

    onCalibrationFinish() {
        console.log("Calibration finished. Starting Owl Scene.");
        this.startOwlScene();
    },

    // --- 3. Boss Battle ---
    checkBoss(optionIndex) {
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
Game.typewriter = {
    paragraphs: [
        "Alice was beginning to get very tired / of sitting by her sister / on the bank, / and of having nothing to do: / once or twice / she had peeped into the book / her sister was reading, / but it had no pictures / or conversations / in it, / “and what is the use of a book,” / thought Alice / “without pictures / or conversations?”",

        "So she was considering / in her own mind / (as well as she could, / for the hot day / made her feel very sleepy / and stupid), / whether the pleasure / of making a daisy-chain / would be worth the trouble / of getting up / and picking the daisies, / when suddenly / a White Rabbit / with pink eyes / ran close by her.",

        "There was nothing / so very remarkable / in that; / nor did Alice think it / so very much out of the way / to hear the Rabbit / say to itself, / “Oh dear! / Oh dear! / I shall be late!” / (when she thought it over afterwards, / it occurred to her / that she ought to have wondered / at this, / but at the time / it all seemed quite natural); / but when the Rabbit / actually took a watch / out of its waistcoat-pocket, / and looked at it, / and then hurried on, / Alice started to her feet, / for it flashed across her mind / that she had never before seen / a rabbit / with either a waistcoat-pocket, / or a watch / to take out of it, / and burning with curiosity, / she ran across the field / after it, / and fortunately / was just in time / to see it / pop down / a large rabbit-hole / under the hedge.",

        "In another moment / down went Alice / after it, / never once considering / how in the world / she was to get out again.",

        "The rabbit-hole / went straight on / like a tunnel / for some way, / and then dipped / suddenly down, / so suddenly / that Alice had not a moment / to think about / stopping herself / before she found herself / falling down / a very deep well.",

        "Either the well / was very deep, / or she fell / very slowly, / for she had plenty of time / as she went down / to look about her / and to wonder / what was going to happen next. / First, / she tried to look down / and make out / what she was coming to, / but it was too dark / to see anything; / then she looked / at the sides of the well, / and noticed / that they were filled / with cupboards / and book-shelves; / here and there / she saw maps / and pictures / hung upon pegs. / She took down a jar / from one of the shelves / as she passed; / it was labelled / “ORANGE MARMALADE”, / but to her great disappointment / it was empty: / she did not like / to drop the jar / for fear of killing somebody underneath, / so managed to put it / into one of the cupboards / as she fell past it."
    ],
    quizzes: [
        { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
        { q: "What did Alice see?", o: ["A White Rabbit.", "A Cheshire Cat.", "A Mad Hatter."], a: 0 },
        { q: "What did the Rabbit say?", o: ["I'm hungry!", "Oh dear! I shall be late!", "Hello Alice!"], a: 1 },
        { q: "What did the Rabbit pull out?", o: ["A carrot.", "A watch.", "A map."], a: 1 },
        { q: "Where did Alice fall?", o: ["Up a tree.", "Into a deep well.", "Into a river."], a: 1 },
        { q: "What did she see on the shelves?", o: ["Orange Marmalade.", "Books only.", "Nothing."], a: 0 }
    ],
    currentParaIndex: 0,
    currentText: "",
    charIndex: 0,
    timer: null,
    isPaused: false,

    // Debug & Feedback Visuals
    debugEl100: null,
    debugEl300: null,
    labelEl: null,
    cursorBlob: null,

    // Speed and WPM
    baseSpeed: 30, // ms delay
    startTime: null,
    totalPausedTime: 0,
    pauseStartTimestamp: null,
    wordCount: 0,
    wpmInterval: null,

    start() {
        // Reset
        this.currentParaIndex = 0;
        this.baseSpeed = 30; // Reset speed
        this.wordCount = 0;
        this.startTime = null;
        this.totalPausedTime = 0;
        Game.state.ink = 0; // Reset Ink
        Game.updateUI();

        const el = document.getElementById("book-content");
        if (el) {
            el.innerHTML = "";
            el.style.columnCount = "auto";
            el.style.columnWidth = "auto";
            el.style.columnGap = "normal";
            el.style.display = "block";
            el.style.textAlign = "left";
            el.style.height = "60vh";
            el.style.overflowY = "auto";
            el.style.width = "100%";
        }

        // Start WPM Timer
        if (this.wpmInterval) clearInterval(this.wpmInterval);
        this.wpmInterval = setInterval(() => this.updateWPM(), 1000);

        this.playNextParagraph();
    },

    changeSpeed(delta) {
        this.baseSpeed -= delta;
        if (this.baseSpeed < 5) this.baseSpeed = 5;
        if (this.baseSpeed > 200) this.baseSpeed = 200;
    },

    updateWPM() {
        if (!this.startTime || this.isPaused) return;

        const now = Date.now();
        const elapsedSec = (now - this.startTime - this.totalPausedTime) / 1000;
        if (elapsedSec <= 0) return;

        const wpm = Math.round(this.wordCount / (elapsedSec / 60));
        const disp = document.getElementById("wpm-display");
        if (disp) disp.textContent = `${wpm} WPM`;
    },

    playNextParagraph() {
        const el = document.getElementById("book-content");
        if (!el) return;

        el.innerHTML = "";

        if (this.currentParaIndex >= this.paragraphs.length) {
            // Should have been handled by startBossBattle, but if we got here:
            this.startBossBattle();
            return;
        }

        this.currentText = this.paragraphs[this.currentParaIndex];
        this.charIndex = 0;

        if (this.pauseStartTimestamp) {
            this.totalPausedTime += Date.now() - this.pauseStartTimestamp;
            this.pauseStartTimestamp = null;
        }
        this.isPaused = false;

        // Init Start Time if First Paragraph
        if (this.currentParaIndex === 0 && !this.startTime) {
            this.startTime = Date.now();
        }

        this.currentP = document.createElement("p");

        // Font size ~10% smaller than 1.2rem -> ~1.1rem
        // Mobile layout adjustment
        const isMobile = window.innerWidth <= 768;
        this.currentP.style.fontSize = isMobile ? "1.0rem" : "1.1rem";
        this.currentP.style.textAlign = "left";
        this.currentP.style.lineHeight = "1.5";
        this.currentP.style.fontFamily = "'Crimson Text', serif";

        // Mobile Layout: Wider box, smaller margins
        if (isMobile) {
            this.currentP.style.margin = "10px 5px";
            el.style.padding = "10px";
            el.style.width = "98%";
        } else {
            this.currentP.style.margin = "20px";
            el.style.padding = "20px";
            el.style.width = "100%";
        }

        // Create Cursor
        this.cursorBlob = document.createElement("span");
        this.cursorBlob.className = "cursor";
        this.currentP.appendChild(this.cursorBlob);

        el.appendChild(this.currentP);

        if (this.timer) clearTimeout(this.timer);

        // Wait for 3 cursor blinks (0.8s * 3 = 2400ms) before starting
        setTimeout(() => {
            this.tick();
        }, 2400);
    },

    tick() {
        if (this.isPaused) {
            return;
        }

        // Advance character
        let char = this.currentText[this.charIndex];

        // Skip '/' delimiter but trigger pause logic
        let isChunkEnd = false;
        if (char === '/') {
            isChunkEnd = true;
            this.charIndex++;
            if (this.charIndex < this.currentText.length) {
                char = this.currentText[this.charIndex];
            } else {
                char = "";
            }
        }

        // Add char to P (insert before cursor)
        if (this.charIndex < this.currentText.length) {
            const charNode = document.createTextNode(char);
            this.currentP.insertBefore(charNode, this.cursorBlob);

            if (char === ' ') this.wordCount++;

            this.charIndex++;
        }

        // Auto-scroll
        const el = document.getElementById("book-content");
        if (el) el.scrollTop = el.scrollHeight;

        // Check if finished
        if (this.charIndex >= this.currentText.length) {
            this.pauseStartTimestamp = Date.now();

            if (this.currentP.contains(this.cursorBlob)) {
                this.currentP.removeChild(this.cursorBlob);
            }

            setTimeout(() => {
                this.showVillainQuiz();
            }, 1000);
        } else {
            // Speed Logic
            let nextDelay = this.baseSpeed;

            if (isChunkEnd) {
                nextDelay = 800; // Explicit chunk pause
            } else {
                const lastChar = char;
                if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
                    nextDelay = 600;
                }
            }

            this.timer = setTimeout(() => this.tick(), nextDelay);
        }
    },

    showVillainQuiz() {
        const modal = document.getElementById("villain-modal");
        const quizContainer = document.getElementById("quiz-container");
        const rewardContainer = document.getElementById("reward-container");
        const rewardValue = document.getElementById("reward-ink-value");

        if (!modal) {
            console.error("Villain modal not found");
            this.onQuizCorrect();
            return;
        }

        // Calculate Ink
        const earnedInk = this.currentText ? this.currentText.replace(/\//g, "").length : 50;

        // 1. Show Reward Animation
        modal.style.display = "flex";
        if (quizContainer) quizContainer.style.display = "none";
        if (rewardContainer) rewardContainer.style.display = "flex";

        // Animate Ink Count
        if (rewardValue) {
            let start = 0;
            let end = earnedInk;
            let duration = 2000; // Animation duration
            let startTime = null;

            function step(timestamp) {
                if (!startTime) startTime = timestamp;
                let progress = Math.min((timestamp - startTime) / duration, 1);
                // Ease out cubic
                progress = 1 - Math.pow(1 - progress, 3);

                rewardValue.textContent = "+" + Math.floor(progress * end);

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            }
            window.requestAnimationFrame(step);
        }

        // Add to global state
        Game.state.ink = (Game.state.ink || 0) + earnedInk;
        Game.updateUI();

        // 2. After 3 seconds, Show Quiz
        setTimeout(() => {
            if (rewardContainer) rewardContainer.style.display = "none";
            if (quizContainer) quizContainer.style.display = "block";

            const qEl = document.getElementById("quiz-text");
            const oEl = document.getElementById("quiz-options");

            if (!qEl || !oEl) {
                console.error("Quiz text/options elements missing");
                modal.style.display = "none";
                this.onQuizCorrect();
                return;
            }

            // Setup Quiz
            const qData = this.quizzes[this.currentParaIndex];

            if (!qData) {
                console.warn("No quiz data found for index " + this.currentParaIndex);
                // Fallback or skip
                modal.style.display = "none";
                this.onQuizCorrect();
                return;
            }

            qEl.textContent = qData.q;
            oEl.innerHTML = "";

            qData.o.forEach((optText, idx) => {
                const btn = document.createElement("button");
                btn.className = "quiz-btn";
                btn.textContent = optText;
                btn.onclick = () => {
                    if (idx === qData.a) {
                        // Correct
                        btn.classList.add("correct");
                        Game.state.gems = (Game.state.gems || 0) + 1;
                        Game.updateUI();

                        setTimeout(() => {
                            modal.style.display = "none";
                            this.onQuizCorrect();
                        }, 500);
                    } else {
                        // Wrong
                        btn.classList.add("wrong");
                        Game.state.gems = Math.max(0, (Game.state.gems || 0) - 1);
                        Game.updateUI();

                        setTimeout(() => btn.classList.remove("wrong"), 500);
                    }
                };
                oEl.appendChild(btn);
            });

        }, 3000);
    },

    onQuizCorrect() {
        this.currentParaIndex++;
        this.hideDebugVisuals();

        // Check if all paragraphs done -> Boss Battle
        if (this.currentParaIndex >= this.paragraphs.length) {
            this.startBossBattle();
        } else {
            this.playNextParagraph();
        }
    },

    startBossBattle() {
        if (this.wpmInterval) clearInterval(this.wpmInterval);
        this.hideDebugVisuals();
        Game.switchScreen("screen-boss");

        const qEl = document.getElementById("boss-question");
        const oEl = document.getElementById("boss-options");

        // Hard coded Boss Question for now
        qEl.textContent = "What is the true underlying theme of Alice's journey down the rabbit hole?";
        oEl.innerHTML = "";

        const options = [
            "The struggle against societal norms.",
            "The loss of childhood innocence.",
            "The chaotic nature of dream logic."
        ];
        const answerIdx = 1; // Let's say #2

        options.forEach((optText, idx) => {
            const btn = document.createElement("button");
            btn.className = "quiz-btn";
            btn.textContent = optText;
            btn.onclick = () => {
                if (idx === answerIdx) {
                    // Boss Defeated
                    alert(`Boss Defeated! You sealed the rift with ${Game.state.ink} Ink and ${Game.state.gems} Gems!`);
                    Game.switchScreen("screen-home");
                } else {
                    // Wrong -> Lose ALL Gems? Or just one? User said "Gem이 날라간다. Gem이 모두 소진하면 처음부터 다시"
                    Game.state.gems = (Game.state.gems || 0) - 10; // Big penalty
                    if (Game.state.gems < 0) {
                        alert("Game Over! Your Gems have been depleted.");
                        location.reload();
                    } else {
                        alert("The Shadow attacks! You lost 10 Gems. Try again!");
                        Game.updateUI();
                    }
                }
            };
            oEl.appendChild(btn);
        });
    },

    // --- Gaze Feedback Logic ---
    hideDebugVisuals() {
        if (this.debugEl100) this.debugEl100.style.display = "none";
        if (this.debugEl300) this.debugEl300.style.display = "none";
        const labelEl = document.getElementById("gaze-feedback-label");
        if (labelEl) labelEl.textContent = "";
    },

    checkGazeDistance(gazeX, gazeY) {
        if (!this.cursorBlob) return;
        // If cursor is removed (end of paragraph), hide debug
        if (!this.cursorBlob.isConnected) {
            this.hideDebugVisuals();
            return;
        }

        const rect = this.cursorBlob.getBoundingClientRect();
        // Center of cursor
        const cursorX = rect.left + rect.width / 2;
        const cursorY = rect.top + rect.height / 2;

        // Safety check if cursor is off-screen or hidden
        if (cursorX === 0 && cursorY === 0) return;

        const dist = Math.hypot(gazeX - cursorX, gazeY - cursorY);

        this.updateDebugVisuals(cursorX, cursorY, dist);
    },

    updateDebugVisuals(cx, cy, dist) {
        // Create circles if not exist
        if (!this.debugEl100) {
            this.debugEl100 = document.createElement("div");
            this.debugEl100.className = "debug-circle debug-circle-100";
            document.body.appendChild(this.debugEl100);

            this.debugEl300 = document.createElement("div");
            this.debugEl300.className = "debug-circle debug-circle-300";
            document.body.appendChild(this.debugEl300);

            // Note: labelEl is now static in HTML (#gaze-feedback-label)
        }

        // Update Position (Circles centered on cursor)
        this.debugEl100.style.left = cx + "px";
        this.debugEl100.style.top = cy + "px";
        this.debugEl100.style.display = "block";

        this.debugEl300.style.left = cx + "px";
        this.debugEl300.style.top = cy + "px";
        this.debugEl300.style.display = "block";

        // Update Label (Static Position above WPM)
        const labelEl = document.getElementById("gaze-feedback-label");
        if (!labelEl) return;

        if (dist <= 100) {
            labelEl.textContent = "Perfect";
            labelEl.style.color = "#00ff00";
            labelEl.style.textShadow = "0 0 5px #00ff00";
            labelEl.style.display = "block";

            if (this.cursorBlob) {
                this.cursorBlob.className = "cursor glow-perfect";
            }
        } else if (dist <= 300) {
            labelEl.textContent = "Good";
            labelEl.style.color = "#ffd700";
            labelEl.style.textShadow = "none";
            labelEl.style.display = "block";

            if (this.cursorBlob) {
                this.cursorBlob.className = "cursor glow-good";
            }
        } else {
            // > 300: Clear or show nothing
            labelEl.textContent = "";
            if (this.cursorBlob) {
                this.cursorBlob.className = "cursor"; // Normal
            }
        }
    }
};

// Override startReadingSession
Game.startReadingSession = function () {
    console.log("Starting Typewriter Logic...");
    if (typeof window.showGazeDot === "function") window.showGazeDot(999999);

    const el = document.getElementById("book-content");
    if (el) {
        el.style.columnWidth = "auto";
        el.style.columnGap = "normal";
    }
    const bar = document.querySelector(".rift-seal-bar");
    if (bar) bar.style.display = "none";

    this.typewriter.start();
};

window.Game = Game;
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});
