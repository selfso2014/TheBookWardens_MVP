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
        // this.startReadingSession(); // Removed duplicate call, switchScreen handles it
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
        "Alice was beginning to / get very tired / of sitting by her sister / on the bank, / and of having nothing to do: / once or twice / she had peeped into the book / her sister was reading, / but it had no pictures / or conversations / in it."
    ],
    quizzes: [
        { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 }
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
    chunkDelay: 1000, // delay between chunks
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
        this.renderedNodes = []; // Track text nodes for eraser
        Game.state.ink = 0; // Reset Ink
        Game.hasExported = false; // Reset export flag
        Game.updateUI();

        // Initialize Context
        if (window.gazeDataManager) {
            window.gazeDataManager.setContext({
                lineIndex: 0,
                charIndex: 0
            });
        }

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
        this.currentLineIndex = 0; // Legacy / Fallback
        this.visualLineIndex = 0;  // Actual visual line
        this.lastOffsetTop = undefined;
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
        if (window.gazeDataManager) {
            console.log("[Game] Resetting Gaze Data for new session (Start from blink 1)");
            window.gazeDataManager.reset();
        }

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
        let insertedNode = null;

        // 1. Chunk End Handling
        if (char === '/') {
            // Insert chunk separator (space) as SPAN
            const separator = document.createElement("span");
            separator.innerText = " ";
            this.currentP.insertBefore(separator, this.cursorBlob);
            insertedNode = separator;

            this.renderedNodes.push({ node: separator, line: this.visualLineIndex || 0 });

            this.charIndex++; // Skip the slash

            // Skip any immediate space after slash
            while (this.charIndex < this.currentText.length && this.currentText[this.charIndex] === ' ') {
                this.charIndex++;
            }

            // Eraser Check (also for separator)
            this.applyMagicEraser();

            const delay = this.chunkDelay || 1000;
            console.log(`[Game] Chunk Pause: ${delay}ms`);
            this.timer = setTimeout(() => this.tick(), delay);
            return;
        }

        // 2. Normal Character Printing
        if (this.charIndex < this.currentText.length) {
            const charNode = document.createElement("span");
            charNode.innerText = char;
            this.currentP.insertBefore(charNode, this.cursorBlob);
            insertedNode = charNode;

            if (char === ' ') this.wordCount++;

            this.charIndex++;
        }

        // 3. Visual Line Detection
        const currentTop = this.cursorBlob.offsetTop;
        if (this.lastOffsetTop === undefined) {
            this.lastOffsetTop = currentTop;
        } else {
            // Check difference (> 5px threshold for new line)
            if (currentTop > this.lastOffsetTop + 5) {
                this.visualLineIndex = (this.visualLineIndex || 0) + 1;
                this.lastOffsetTop = currentTop;
            }
        }

        // 4. Track Node & Magic Eraser
        if (insertedNode) {
            this.renderedNodes.push({ node: insertedNode, line: this.visualLineIndex || 0 });
            this.applyMagicEraser();
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

            // User Requirement: End recording 3 seconds after last character
            console.log("[Game] Text finished. Waiting 3s for final gaze data...");
            setTimeout(() => {
                let detectedLines = 0;
                if (window.gazeDataManager) {
                    // 1. Line Detection Algorithm
                    detectedLines = window.gazeDataManager.detectLinesMobile();
                    console.log(`[Game] Line Detection Result: ${detectedLines}`);

                    // 2. Display on UI
                    const resEl = document.getElementById("line-detect-result");
                    if (resEl) resEl.innerText = `Line detection: ${detectedLines}`;

                    // 3. Export CSV (End of Recording)
                    if (!Game.hasExported) {
                        console.log("[Game] 3s elapsed. Exporting CSV.");
                        window.gazeDataManager.exportCSV();
                        Game.hasExported = true;
                    }
                }

                // 4. Proceed to Visuals
                this.showVillainQuiz();
            }, 3000);
        } else {
            // Speed Logic
            let nextDelay = this.baseSpeed;
            const lastChar = char;
            if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
                nextDelay = 600;
            }
            this.timer = setTimeout(() => this.tick(), nextDelay);
        }

        if (window.gazeDataManager) {
            window.gazeDataManager.setContext({
                lineIndex: this.visualLineIndex || 0,
                charIndex: this.charIndex
            });
        }
    },

    applyMagicEraser() {
        const ERASE_START_LINE = 2; // When starting (index 2), erase (index 0)
        const currentLine = this.visualLineIndex || 0;

        if (currentLine >= ERASE_START_LINE) {
            // Erase nodes from line (currentLine - 2) or older
            if (this.renderedNodes.length > 0) {
                const head = this.renderedNodes[0];
                if (head.line <= currentLine - 2) {
                    const item = this.renderedNodes.shift();
                    // Use opacity to hide but keep space
                    item.node.style.opacity = "0";
                    item.node.style.transition = "opacity 0.2s"; // Smooth fade
                }
            }
        }
    },

    showVillainQuiz() {
        console.log("Reading Finished. Visualizing Fixations...");

        // 1. Draw Fixation Overlay on screen-read
        // let overlay; // Removed to avoid redeclaration below
        if (!window.gazeDataManager) {
            this.openQuizModal();
            return;
        }

        const allData = window.gazeDataManager.getAllData();
        // Filter data starting from t > 3000 (after initial delay)
        const validData = allData.filter(d => d.t > 3000);

        if (validData.length === 0) {
            console.warn("[Game] No valid gaze data found (t > 3000).");
            this.openQuizModal();
            return;
        }

        const container = document.getElementById("screen-read");

        // Create full-screen overlay for animation
        let overlay = document.getElementById("fixation-anim-overlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "fixation-anim-overlay";
            overlay.style.position = "absolute";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = "999";
            overlay.style.background = "rgba(0,0,0,0.1)";
            if (container) container.appendChild(overlay);
        } else {
            overlay.innerHTML = ""; // Clear previous
        }

        // Calculate Shift Offset
        // Target: "Alice" (Start of text)
        let startX = 0, startY = 0;
        try {
            if (this.currentP && this.currentP.firstChild) {
                const range = document.createRange();
                range.setStart(this.currentP.firstChild, 0);
                range.setEnd(this.currentP.firstChild, 1);
                const rect = range.getBoundingClientRect();
                startX = rect.left;
                startY = rect.top + (rect.height / 2);
            }
        } catch (e) {
            console.warn("[Game] Failed to get range rect for startX:", e);
        }

        // Fallback
        if ((startX === 0 && startY === 0) && this.currentP) {
            const pRect = this.currentP.getBoundingClientRect();
            startX = pRect.left + 10;
            startY = pRect.top + 15;
            console.log("[Game] Used fallback rect.");
        }

        console.log(`[Game] Text Target: (${startX}, ${startY})`);

        const firstGaze = validData.find(d => d.x > 0 && d.y > 0) || validData[0];
        const offsetX = startX - firstGaze.x;
        const offsetY = startY - firstGaze.y;

        console.log(`[Game] Animation Offset: dx=${offsetX}, dy=${offsetY}`);

        // Prepare Animation Data
        // Shift all points and Compress Time (10% duration for 10x speed)
        const baseTime = validData[0].t;
        const animData = validData.map(d => ({
            t: baseTime + (d.t - baseTime) * 0.1,
            x: d.x + offsetX,
            y: d.y + offsetY
        }));

        const startTime = animData[0].t;
        const endTime = animData[animData.length - 1].t;
        const duration = endTime - startTime;

        console.log(`[Game] Animation Start: ${startTime}ms, Duration: ${duration}ms`);

        const animStartTs = performance.now();

        const animate = () => {
            const now = performance.now();
            const elapsed = now - animStartTs;
            const currentSimTime = startTime + elapsed; // Simulation time

            // Draw points that are "due" (t <= currentSimTime) and not yet drawn
            // Optimization: animData should be sorted by t. We keep an index.
            while (this.animIndex < animData.length && animData[this.animIndex].t <= currentSimTime) {
                const pt = animData[this.animIndex];

                const dot = document.createElement("div");
                dot.style.position = "fixed";
                dot.style.left = (pt.x - 5) + "px"; // r=5 -> width=10, center offset -5
                dot.style.top = (pt.y - 5) + "px";
                dot.style.width = "10px";
                dot.style.height = "10px";
                dot.style.borderRadius = "50%";
                dot.style.backgroundColor = "rgba(255, 0, 0, 0.5)"; // Semi-transparent red
                // dot.style.boxShadow = "0 0 2px rgba(255,0,0,0.5)";
                overlay.appendChild(dot);

                this.animIndex++;
            }

            if (this.animIndex < animData.length) {
                requestAnimationFrame(animate);
            } else {
                console.log("[Game] Animation Finished.");
                // Animation done. Wait 1 sec then show quiz
                setTimeout(() => {
                    if (overlay) overlay.remove();

                    // Ink Calculation (Legacy logic moved here)
                    const earnedInk = this.currentText ? this.currentText.replace(/\//g, "").length : 50;
                    Game.state.ink = (Game.state.ink || 0) + earnedInk;
                    Game.updateUI();

                    this.openQuizModal();
                }, 1000);
            }
        };

        this.animIndex = 0;
        requestAnimationFrame(animate);
    },

    openQuizModal() {
        console.log("[Game] openQuizModal called");

        // Export Gaze Data as CSV (User Requirement: Output when villain dialogue appears)
        // Prevent double export: check if we just exported
        if (window.gazeDataManager && !Game.hasExported) {
            console.log("Exporting Gaze CSV...");
            window.gazeDataManager.exportCSV();
            Game.hasExported = true; // Set flag
        }

        // Safety check for quiz index
        if (this.currentParaIndex === undefined) this.currentParaIndex = 0;

        const modal = document.getElementById("villain-modal");
        const quizContainer = document.getElementById("quiz-container"); // Define quizContainer
        const rewardContainer = document.getElementById("reward-container");

        // Show Quiz immediately
        if (modal) modal.style.display = "flex";
        if (quizContainer) quizContainer.style.display = "block";
        if (rewardContainer) rewardContainer.style.display = "none";

        const qEl = document.getElementById("quiz-text");
        const oEl = document.getElementById("quiz-options");

        // Add or Update Gem Display in Modal
        let gemDisplay = document.getElementById("modal-gem-display");
        if (!gemDisplay) {
            gemDisplay = document.createElement("div");
            gemDisplay.id = "modal-gem-display";
            gemDisplay.style.cssText = "position: absolute; top: 20px; right: 20px; font-size: 1.5rem; color: #00d4ff; font-weight: bold; background: rgba(0,0,0,0.5); padding: 5px 10px; border-radius: 20px;";
            // Append to villain-card, not container directly if possible, but modal works too 
            const card = modal.querySelector(".villain-card");
            if (card) card.appendChild(gemDisplay);
        }
        gemDisplay.textContent = `💎 ${Game.state.gems || 0}`;

        if (!qEl || !oEl) {
            console.error("Quiz elements missing");
            this.onQuizCorrect();
            return;
        }

        // Setup Quiz
        const debugIndex = (this.currentParaIndex || 0) % this.quizzes.length;
        const qData = this.quizzes[debugIndex];

        console.log("[Game] Quiz Data:", qData, "Index:", debugIndex);

        if (!qData) {
            console.warn("No quiz data found");
            this.onQuizCorrect();
            if (modal) modal.style.display = "none";
            return;
        }

        qEl.textContent = qData.q;
        oEl.innerHTML = "";

        qData.o.forEach((optText, idx) => {
            const btn = document.createElement("button");
            btn.className = "quiz-btn";
            btn.textContent = optText;
            btn.onclick = () => {
                const display = document.getElementById("modal-gem-display");
                if (idx === qData.a) {
                    btn.classList.add("correct");
                    Game.state.gems = (Game.state.gems || 0) + 1;
                    if (display) {
                        display.textContent = `💎 ${Game.state.gems} (+1)`;
                        display.style.color = "#00ff00"; // Green for gain
                    }
                    Game.updateUI();

                    setTimeout(() => {
                        modal.style.display = "none";
                        this.onQuizCorrect();
                    }, 1000);
                } else {
                    btn.classList.add("wrong");
                    Game.state.gems = Math.max(0, (Game.state.gems || 0) - 1);
                    if (display) {
                        display.textContent = `💎 ${Game.state.gems} (-1)`;
                        display.style.color = "#ff4444"; // Red for loss
                    }
                    Game.updateUI();

                    setTimeout(() => {
                        btn.classList.remove("wrong");
                        // Reset color after brief delay
                        if (display) {
                            display.textContent = `💎 ${Game.state.gems}`;
                            display.style.color = "#00d4ff";
                        }
                    }, 500);
                }
            };
            oEl.appendChild(btn);
        });
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
                    // alert(`Boss Defeated! You sealed the rift with ${Game.state.ink} Ink and ${Game.state.gems} Gems!`);
                    Game.updateUI(); // Update UI before switching to win screen
                    Game.switchScreen("screen-win");
                } else {
                    // Boss Damage
                    Game.state.gems = Math.max(0, (Game.state.gems || 0) - 10); // Big penalty
                    Game.updateUI();

                    if (Game.state.gems <= 0) {
                        alert("Game Over! Your Gems have been depleted.");
                        location.reload();
                    } else {
                        // Visual feedback for wrong answer instead of alert
                        btn.classList.add("wrong");
                        setTimeout(() => btn.classList.remove("wrong"), 500);
                        // Optional: Shake effect on screen
                    }
                }
            };
            oEl.appendChild(btn);
        });
    },

    showFullTextReview() {
        Game.switchScreen("screen-review");
        const container = document.getElementById("full-text-container");
        if (container) {
            // Join paragraphs and clean up slashes
            const fullText = this.paragraphs.join("\n\n").replace(/\//g, "");
            container.textContent = fullText;

            // --- DRAW FIXATIONS ---
            if (window.gazeDataManager) {
                const fixations = window.gazeDataManager.getFixations();
                console.log("[Game] Fixations to draw:", fixations.length);

                // We need to map screen coordinates to the container relative coords?
                // Or just absolute positioning over the container.
                // Since the container scrolls, absolute positioning over it might move with scroll ONLY if appended to container.
                // But container has textContent set, which kills children.
                // So let's wrap text in a div and append dots to the container.
                container.innerHTML = `<div style="position:relative; z-index:1;">${fullText}</div>`;

                // Get container bounds to offset if needed, but gaze is screen coordinates usually (clientXY).
                // However, container position on screen matters.
                // If gaze is screen coordinates (pageX/Y-ish), we need to place dots absolutely in body OR relative to a full-screen overlay.
                // Let's create a canvas overlay on top of the container text.
                // Simpler approach: Just append absolute divs to the container or body.
                // CAUTION: Text might scroll. Fixations captured DURING reading might align with WHERE the text was.
                // But here we are just reviewing. The gaze data collected was from the previous screen ("screen-read").
                // The coordinates form the reading session won't match the new "Review" screen layout!
                // The user request says: "위 자료구조를 활용해 텍스트 지문을 읽고 나서 화면에 픽세이션인 점을을... 그린다."
                // Since the layout is different (Reading Mode vs Review Mode), the dots will be in "wrong" places relative to text content 
                // UNLESS the prompt implies plotting them WHERE THEY WERE LOOKING during reading (spatial heatmap) 
                // OR plotting them relative to the text (which is very hard without word-level timestamp mapping).

                // Given "Reading Game", assuming we just overlay where they looked on the SCREEN to show their pattern.
                // But the review screen has the text. If we just plot X,Y coords, and the text layout changed, 
                // it might look weird. However, re-creating the EXACT reading environment is complex.
                // We will assume plotting the RAW screen coordinates is the goal (to show scan path pattern).
                // We will append a fullscreen transparent container for dots.

                const dotContainer = document.createElement("div");
                dotContainer.style.position = "absolute";
                dotContainer.style.top = "0";
                dotContainer.style.left = "0";
                dotContainer.style.width = "100%";
                dotContainer.style.height = "100%";
                dotContainer.style.pointerEvents = "none";
                dotContainer.style.zIndex = "100";
                document.getElementById("screen-review").appendChild(dotContainer); // Append to screen-review to keep scoped

                fixations.forEach(fix => {
                    // Filter out 0,0 or invalid
                    if (fix.x <= 0 && fix.y <= 0) return;

                    const dot = document.createElement("div");
                    dot.className = "fixation-dot";
                    dot.style.position = "fixed"; // Use fixed to match screen coords
                    dot.style.left = (fix.x - 5) + "px"; // Radius 5px -> width 10px? "반지름 5px" means width 10px
                    dot.style.top = (fix.y - 5) + "px";
                    dot.style.width = "10px";
                    dot.style.height = "10px";
                    dot.style.borderRadius = "50%";
                    dot.style.backgroundColor = "rgba(255, 0, 0, 0.5)"; // Semi-transparent red
                    dot.style.zIndex = "999";
                    dotContainer.appendChild(dot);
                });
            }
        }
    },

    showSummaryShare() {
        Game.switchScreen("screen-share");
    },

    async shareResult() {
        const shareData = {
            title: 'The Book Wardens',
            text: `I just finished reading Alice's Adventures in Wonderland with ${Game.state.ink} Ink and ${Game.state.gems} Gems!`,
            url: window.location.href
        };

        // Try to share image if supported (requires File object usually, checking generic support first)
        if (navigator.share) {
            try {
                // Fetch the image to create a File object
                const response = await fetch('./alice_summary_card.png');
                const blob = await response.blob();
                const file = new File([blob], 'reading_summary.png', { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: shareData.title,
                        text: shareData.text
                    });
                } else {
                    await navigator.share(shareData);
                }
            } catch (err) {
                console.error("Share failed:", err);
                alert("Sharing failed, but you can screenshot this!");
            }
        } else {
            alert("Sharing is not supported on this browser/device. Try taking a screenshot!");
        }
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
