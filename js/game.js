/**
 * The Book Wardens: Game Logic (Algorithm V9.0 - Mean-Gaze Anchored Replay)
 */
const Game = {
    state: {
        gems: 0,
        currentWordIndex: 0,
        vocabIndex: 0, // Track Word Forge progress
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
                    this.state.vocabIndex = 0; // Reset
                    this.loadVocab(0);         // Load first word
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
    vocabList: [
        {
            word: "Luminous",
            sentence: "The <b>luminous</b> mushroom lit up the dark cave.",
            options: ["A. Very heavy and dark", "B. Full of light / Shining", "C. Related to the moon"],
            answer: 1
        },
        {
            word: "Cipher",
            sentence: "Alice found a cryptic <b>cipher</b> hidden in the scroll.",
            options: ["A. A delicious cake", "B. A secret code", "C. A type of flower"],
            answer: 1
        },
        {
            word: "Ethereal",
            sentence: "The Cheshire Cat had an <b>ethereal</b> glow.",
            options: ["A. Heavy and solid", "B. Delicate and light", "C. Angry and red"],
            answer: 1
        }
    ],

    loadVocab(index) {
        if (index >= this.vocabList.length) return;
        const data = this.vocabList[index];

        // Update Title and Sentence
        const titleEl = document.getElementById("vocab-word");
        if (titleEl) titleEl.textContent = data.word;

        // Find the sentence paragraph - assuming it's the <p> after title
        // Better to use a specific ID if possible, but structure is fixed in HTML
        // Let's rely on querySelector within .word-card if IDs aren't granular
        const card = document.querySelector(".word-card");
        if (card) {
            const p = card.querySelector("p");
            if (p) p.innerHTML = data.sentence;
        }

        // Update Counter (1/3)
        const counterDiv = document.querySelector("#screen-word > div:first-child");
        if (counterDiv) counterDiv.textContent = `WORD FORGE (${index + 1}/${this.vocabList.length})`;

        // Update Options
        const optionsDiv = document.getElementById("vocab-options");
        if (optionsDiv) {
            optionsDiv.innerHTML = ""; // Clear existing
            data.options.forEach((optText, idx) => {
                const btn = document.createElement("button");
                btn.className = "option-btn";
                btn.textContent = optText;
                btn.onclick = () => Game.checkVocab(idx);
                optionsDiv.appendChild(btn);
            });
        }
    },

    async checkVocab(optionIndex) {
        const currentIndex = this.state.vocabIndex || 0;
        const currentData = this.vocabList[currentIndex];

        const isCorrect = (optionIndex === currentData.answer);

        if (isCorrect) {
            // alert("Correct! +10 Gems"); // Removed alert for smoother flow
            this.state.gems += 10;
            this.updateUI();

            // Progress
            this.state.vocabIndex++;

            if (this.state.vocabIndex < this.vocabList.length) {
                // Next Word
                this.loadVocab(this.state.vocabIndex);
            } else {
                // All Done
                console.log("Word Forge Complete. Proceeding to WPM Selection...");
                this.switchScreen("screen-wpm");
            }
        } else {
            alert("Try again!");
        }
    },

    // --- 1.2 WPM Selection ---
    selectWPM(wpm) {
        console.log(`[Game] User selected WPM: ${wpm}`);
        // Formula: Delay (ms) = 10000 / WPM
        // 100 -> 100ms, 200 -> 50ms, 300 -> 33ms

        const delay = Math.floor(10000 / wpm);
        this.targetSpeed = delay; // Store for typewriter.start to pick up

        // Adjust Chunk Delay too (Pause between phrases)
        // Faster WPM -> Shorter Pause
        // Let's set pause roughly equal to typing 8 characters
        this.targetChunkDelay = delay * 8;
        console.log(`[Game] WPM: ${wpm} -> CharDelay: ${delay}ms, ChunkDelay: ${this.targetChunkDelay}ms`);

        // Initialize Eye Tracking & Calibration logic
        (async () => {
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
        })();
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
        if (this.typewriter) {
            // New Ink Logic
            if (typeof this.typewriter.updateGazeStats === "function") {
                this.typewriter.updateGazeStats(x, y);
            }
            // Legacy Logic (if exists)
            if (typeof this.typewriter.checkGazeDistance === "function") {
                this.typewriter.checkGazeDistance(x, y);
            }
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
    baseSpeed: 20, // ms delay
    chunkDelay: 800, // delay between chunks
    startTime: null,
    totalPausedTime: 0,
    pauseStartTimestamp: null,
    wordCount: 0,
    wpmInterval: null,

    // Gaze Coverage Logic
    currentLineMinX: 99999,
    currentLineMaxX: -99999,
    prevGazeX: null,
    prevGazeX: null,
    isReturnSweep: false,

    updateGazeStats(x, y) {
        // Only track if typing is active
        if (!this.startTime || this.isPaused) return;

        // 1. Min/Max Tracking
        if (x < this.currentLineMinX) this.currentLineMinX = x;
        if (x > this.currentLineMaxX) this.currentLineMaxX = x;

        // 2. Return Sweep Detection
        if (this.prevGazeX !== null) {
            const dx = x - this.prevGazeX;
            // Threshold: 20% negative jump
            const w = window.innerWidth;
            if (dx < -(w * 0.2)) {
                this.isReturnSweep = true;
                console.log(`[Game] Return Sweep! dx:${Math.round(dx)}`);
            }
        }
        this.prevGazeX = x;
    },

    checkLineConfidence(lineTop, lineIndex) {
        const coverage = this.currentLineMaxX - this.currentLineMinX;

        const contentEl = document.getElementById("book-content");
        const totalWidth = contentEl ? contentEl.clientWidth : window.innerWidth;
        const widthThreshold = totalWidth * 0.4;

        const isCoverageGood = coverage >= widthThreshold;
        const isReturnSweep = this.isReturnSweep; // Renamed from hasReturnSweep

        console.log(`[Line ${lineIndex}] Cov:${Math.round(coverage)} OR Sweep:${isReturnSweep}`);

        if (isReturnSweep || isCoverageGood) {
            this.spawnInkIcon(lineTop, lineIndex); // Pass lineIndex
        }

        // Store Line Metadata in Gaze Data Manager
        if (window.gazeDataManager && typeof window.gazeDataManager.setLineMetadata === 'function') {
            window.gazeDataManager.setLineMetadata(lineIndex, {
                success: (isReturnSweep || isCoverageGood),
                coverage: coverage,
                isReturnSweep: isReturnSweep
            });
        }

        // Reset
        this.currentLineMinX = 99999;
        this.currentLineMaxX = -99999;
        this.isReturnSweep = false;
    },

    spawnInkIcon(top, lineIndex) {
        const el = document.getElementById("book-content");
        if (!el) return;

        const ink = document.createElement("div");
        if (lineIndex !== undefined) ink.dataset.lineIndex = lineIndex; // Tag for Replay Lookup
        console.log("[Game] Spawning Ink Icon! 💧");
        ink.textContent = "💧";
        ink.className = "ink-drop";
        ink.style.position = "absolute";
        ink.style.right = "10px";
        ink.style.zIndex = "1000";
        // Correct Coordinate Calculation
        const rect = el.getBoundingClientRect();
        const scrollTop = el.scrollTop;
        const windowScroll = window.scrollY;

        const preciseTop = top - (rect.top + windowScroll) + scrollTop;
        ink.style.top = `${preciseTop - 10}px`;
        ink.style.fontSize = "1.2rem";
        ink.style.animation = "popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
        ink.style.filter = "drop-shadow(0 0 5px #00d4ff)";

        el.appendChild(ink);

        // Add to total ink
        Game.state.ink = (Game.state.ink || 0) + 1; // +1 Ink per line success
        Game.updateUI();
    },

    start() {
        // Reset
        this.currentParaIndex = 0;
        this.baseSpeed = Game.targetSpeed || 20; // Use user selected speed or default
        this.chunkDelay = Game.targetChunkDelay || 800; // Apply dynamic chunk delay
        console.log(`[Typewriter] Starting -> Base Speed: ${this.baseSpeed}ms, Chunk Delay: ${this.chunkDelay}ms`);

        this.wordCount = 0;
        this.startTime = null;
        this.totalPausedTime = 0;

        // Reset Gaze Stats
        this.currentLineMinX = 99999;
        this.currentLineMaxX = -99999;

        // Chunk Display Logic Init
        this.currentChunkNodes = []; // Nodes of currently typing chunk
        this.visibleChunksQueue = []; // Queue of completed chunks
        this.shouldClearOldestChunk = false;

        Game.state.ink = 0; // Reset Ink
        Game.hasExported = false; // Reset export flag
        Game.updateUI();
        this.lineYData = []; // Reset Y data

        // Reset Timestamps for Gaze Sync
        this.typingStartGazeTime = null;
        this.typingEndGazeTime = null;
        this.charIndex = 0; // Ensure reset

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
            el.style.position = "relative"; // For absolute ink positioning
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

        // Reset Gaze Stats for new Paragraph
        this.currentLineMinX = 99999;
        this.currentLineMaxX = -99999;

        // Reset Chunk Logic per Paragraph
        this.currentChunkNodes = [];
        this.visibleChunksQueue = [];
        this.shouldClearOldestChunk = false;

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
        this.currentP.style.lineHeight = "2.5"; // User Request: 1.5 -> 2.5
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

        // --- 1. CHUNK CLEARING LOGIC (Capacity Control) ---
        // Rule: "1st created, 2nd created. When 3rd created, delete 1st."
        // We maintain a visible window of 2 chunks (previous complete + current typing).

        if (this.shouldClearOldestChunk) {
            while (this.visibleChunksQueue.length >= 2) {
                console.log("[Game] Wiping out oldest chunk (Left->Right).");
                const chunkToRemove = this.visibleChunksQueue.shift();

                // Add staggered delay for "Sliding/Wiping" effect
                chunkToRemove.forEach((node, index) => {
                    // Delay increases by 30ms per character -> Left to Right wipe
                    node.style.transitionDelay = `${index * 30}ms`;
                    node.classList.add("chunk-fade-out");
                });
            }
            this.shouldClearOldestChunk = false;
        }

        // --- 2. TYPING LOGIC ---
        let nextDelay = this.baseSpeed;

        // Advance character
        let char = this.currentText[this.charIndex];

        // A. Chunk End Handling (Slash)
        if (char === '/') {
            // Insert chunk separator (space)
            const separatorSpan = document.createElement("span");
            separatorSpan.textContent = " ";
            this.currentP.insertBefore(separatorSpan, this.cursorBlob);

            // Add to current chunk
            this.currentChunkNodes.push(separatorSpan);

            // Archive the current chunk
            this.visibleChunksQueue.push([...this.currentChunkNodes]); // Copy array
            this.currentChunkNodes = []; // Reset for next chunk

            this.charIndex++; // Skip the slash

            // Skip any immediate space after slash in source text
            while (this.charIndex < this.currentText.length && this.currentText[this.charIndex] === ' ') {
                this.charIndex++;
            }

            // Trigger limit check on next tick
            this.shouldClearOldestChunk = true;

            nextDelay = this.chunkDelay || 1000;
            console.log(`[Game] Chunk End. Pause: ${nextDelay}ms.`);
        }
        // B. Normal Character
        else if (this.charIndex < this.currentText.length) {
            // Capture Gaze Timeline Start (First legitimate character printed)
            if (this.charIndex === 0 && this.typingStartGazeTime === null) {
                if (window.gazeDataManager) {
                    const allData = window.gazeDataManager.getAllData();
                    if (allData.length > 0) {
                        this.typingStartGazeTime = allData[allData.length - 1].t;
                        console.log(`[Game] Typing Started. Sync Gaze T: ${this.typingStartGazeTime}ms`);
                    } else {
                        // Fallback
                        this.typingStartGazeTime = 0;
                    }
                }
            }

            // Wrap character in SPAN for chunk control
            const charSpan = document.createElement("span");
            charSpan.textContent = char;
            this.currentP.insertBefore(charSpan, this.cursorBlob);

            // Track for current chunk
            this.currentChunkNodes.push(charSpan);

            this.charIndex++;
            if (char === ' ') this.wordCount++; // Moved this line to be conditional on space

            // --- Real-time Ink Coordinate Logging for Replay ---
            // Get Cursor's current vertical position relative to viewport or document
            // We align with Gaze's coordinate system (ClientX/Y usually).
            if (window.gazeDataManager && this.cursorBlob) {
                const rect = this.cursorBlob.getBoundingClientRect();

                // [User Request]: "정확하게 떨어지는 로직 (산수)"
                // Logic: Inline Box Height = Content Area + Leading.
                // Content Area = Font Size.
                // Leading is split equally top/bottom (Half-Leading).
                // Visual Center = Box Top + Half-Leading + (Font Size / 2).

                const style = window.getComputedStyle(this.cursorBlob); // or currentP
                // Note: cursorBlob is empty span, might not have metrics. Use parent P.
                const parentStyle = window.getComputedStyle(this.currentP);

                const fontSize = parseFloat(parentStyle.fontSize);
                const lineHeight = rect.height; // Use actual rect height for line height

                // Calculate Half-Leading
                const halfLeading = (lineHeight - fontSize) / 2;

                // Exact Center of the "Content Area" (Text Glyphs)
                const inkY = rect.top + halfLeading + (fontSize / 2);

                window.gazeDataManager.setContext({
                    inkY: inkY
                });
            }

            // Punctuation pause
            if (['.', '!', '?'].includes(char)) nextDelay += 300;
            else if (char === ',') nextDelay += 150;
        }

        // --- 3. VISUAL LINE DETECTION & INK LOGIC ---
        const rect = this.cursorBlob.getBoundingClientRect();
        const currentTop = rect.top + window.scrollY;

        // Debugging Line Detection
        if (this.charIndex % 30 === 0) {
            console.log(`[LineDetect] Top:${currentTop}, Last:${this.lastOffsetTop}, Line:${this.visualLineIndex}`);
        }

        if (this.lastOffsetTop === undefined) {
            this.lastOffsetTop = currentTop;
        } else {
            // Check difference (> 5px threshold for new line)
            if (currentTop > this.lastOffsetTop + 5) {
                // Line Break Detected - PREVIOUS LINE FINISHED
                this.recordLineY(this.lastOffsetTop, (this.visualLineIndex || 0));

                // CHECK READING CONFIDENCE (50% Width or Return Sweep)
                this.checkLineConfidence(this.lastOffsetTop, this.visualLineIndex);

                this.visualLineIndex = (this.visualLineIndex || 0) + 1;
                this.lastOffsetTop = currentTop;
            }
        }

        // Auto-scroll
        const el = document.getElementById("book-content");
        if (el) el.scrollTop = el.scrollHeight;

        // --- 4. CHECK TYPING END ---
        if (this.charIndex >= this.currentText.length) {
            // Record the very last line
            if (this.lastOffsetTop !== undefined) {
                this.recordLineY(this.lastOffsetTop, (this.visualLineIndex || 0));

                // CHECK LAST LINE CONFIDENCE
                this.checkLineConfidence(this.lastOffsetTop, this.visualLineIndex);
            }

            this.finishSession();
            return;
        }

        // Update Context
        if (window.gazeDataManager) {
            window.gazeDataManager.setContext({
                lineIndex: this.visualLineIndex || 0,
                charIndex: this.charIndex
            });
        }

        // Schedule Next Tick
        this.timer = setTimeout(() => this.tick(), nextDelay);
    },

    finishSession() {
        // Record the very last line
        if (this.lastOffsetTop !== undefined) {
            this.recordLineY(this.lastOffsetTop, (this.visualLineIndex || 0));
        }

        this.pauseStartTimestamp = Date.now();

        // Capture End Time
        if (window.gazeDataManager) {
            const allData = window.gazeDataManager.getAllData();
            if (allData.length > 0) {
                this.typingEndGazeTime = allData[allData.length - 1].t;
                console.log(`[Game] Typing Finished. Sync Gaze T: ${this.typingEndGazeTime}ms`);
            }
        }

        if (this.currentP.contains(this.cursorBlob)) {
            this.currentP.removeChild(this.cursorBlob);
        }

        // --- STOP CHAR INDEX STAMPING ---
        if (window.gazeDataManager) {
            window.gazeDataManager.setContext({ charIndex: null });
        }

        // --- TRIGGER FINAL WIPE (Smart & Natural) ---
        // Only select spans that are NOT already faded out
        const remainingSpans = this.currentP.querySelectorAll("span:not(.chunk-fade-out)");
        console.log(`[Game] Wiping out remaining text. Count: ${remainingSpans.length}`);

        // Wait briefly (200ms) after typing ends, then wipe quickly
        setTimeout(() => {
            remainingSpans.forEach((node, index) => {
                // Wipe fast: 10ms per char delay
                node.style.transitionDelay = `${index * 10}ms`;
                node.classList.add("chunk-fade-out");
            });
        }, 200);

        // Calculate transition time based on remaining spans only
        const transitionDuration = remainingSpans.length * 10 + 500; // +500ms buffer for CSS fade opacity
        const nextStepWait = Math.max(1000, transitionDuration); // At least 1 sec guaranteed

        console.log(`[Game] Next step in ${nextStepWait}ms`);

        setTimeout(() => {
            let detectedLines = 0;
            if (window.gazeDataManager) {
                const { startTime, endTime } = window.gazeDataManager.getCharIndexTimeRange();
                const tStart = startTime !== null ? startTime : 0;
                const tEnd = endTime !== null ? endTime : Infinity;

                console.log(`[Game] Processing Gaze Data: ${tStart}ms ~ ${tEnd}ms`);
                detectedLines = window.gazeDataManager.detectLinesMobile(tStart, tEnd);

                const resEl = document.getElementById("line-detect-result");
                if (resEl) resEl.innerText = `Line detection: ${detectedLines}`;

                this.calculateReplayCoords(tStart, tEnd);
            }

            this.startGazeReplay();
        }, 200 + nextStepWait);
    },

    recordLineY(y, index) {
        // Store
        if (!this.lineYData) this.lineYData = [];
        this.lineYData.push({ lineIndex: index, y: y });
    },

    applyMagicEraser() {
        // Feature disabled. Reverted to standard typewriter mode.
    },



    showVillainQuiz() {
        console.log("[Game] Transitioning to Villain Quiz...");

        // Ink Calculation
        const earnedInk = this.currentText ? this.currentText.replace(/\//g, "").length : 50;
        Game.state.ink = (Game.state.ink || 0) + earnedInk;
        Game.updateUI();

        // Directly open the modal
        this.openQuizModal();
    },

    openQuizModal() {
        console.log("[Game] openQuizModal called");

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
    // --- Gaze Replay Logic ---

    // NEW FUNCTION: Calculate Rx and Ry based on Ink Success Status
    // Fix: Use lineYData recorded during gameplay instead of getVisualLines (which fails if text is faded)
    calculateReplayCoords(tStart, tEnd) {
        console.log(`[Replay] Calculating Replay Coords (Chart 7 Logic: K=0.5 Segmentation) Range: ${tStart}~${tEnd}`);

        const contentEl = document.getElementById("book-content");
        if (!contentEl) return;

        // 1. Setup Globals
        const cRect = contentEl.getBoundingClientRect();
        const scrollX = window.scrollX;
        const style = window.getComputedStyle(contentEl);
        const padLeft = parseFloat(style.paddingLeft) || 0;
        const padRight = parseFloat(style.paddingRight) || 0;
        const globalLeft = cRect.left + scrollX + padLeft;
        const globalRight = cRect.right + scrollX - padRight;
        const globalWidth = globalRight - globalLeft;

        const lineYData = this.lineYData || [];
        if (lineYData.length === 0) { console.warn("[Replay] No lineYData recorded."); return; }

        // Approx Line Height
        let approxLineHeight = 40;
        if (lineYData.length >= 2) approxLineHeight = Math.abs(lineYData[1].y - lineYData[0].y);
        else {
            const p = contentEl.querySelector('p');
            if (p) { const lh = parseFloat(window.getComputedStyle(p).lineHeight); if (!isNaN(lh)) approxLineHeight = lh; }
        }

        const rawData = window.gazeDataManager.getAllData();
        const lineMetadata = window.gazeDataManager.lineMetadata || {};
        const validData = rawData.filter(d => d.t >= tStart && d.t <= tEnd && d.lineIndex !== null && d.lineIndex !== undefined);
        if (validData.length === 0) return;

        // 2. Chart 7 Segmentation Logic (K=0.5)
        // Reset Coords
        validData.forEach(d => { d.rx = null; d.ry = null; });

        // [Fix] Use current visual lines from DOM instead of stored lineYData
        // stored lineYData (snapshot) may mismatch due to scrolling/clamping.
        // visualLines gives the definitive current viewport position.
        // visualLines gives the definitive current viewport position.
        const visualLines = this.getVisualLines(this.currentP || contentEl);

        // [New Strategy: Ink Icon Mapping] (Priority 0)
        // Scan current DOM for Ink Icons to use as absolute anchors.
        const inkMap = {};
        const inkElements = document.querySelectorAll('.ink-drop');
        inkElements.forEach(ink => {
            const idx = parseInt(ink.dataset.lineIndex);
            if (!isNaN(idx)) {
                inkMap[idx] = ink.getBoundingClientRect();
            }
        });

        const K_VEL_THRESHOLD = 0.5;
        const segments = [];
        let segStart = 0;

        for (let i = 0; i < validData.length; i++) {
            const vx = (validData[i].vx !== undefined) ? validData[i].vx : 0;
            if (vx < -K_VEL_THRESHOLD) {
                // Sweep detected, close segment
                if (i > segStart + 2) segments.push({ start: segStart, end: i - 1 });
                segStart = i + 1;
            }
        }
        if (segStart < validData.length - 1) segments.push({ start: segStart, end: validData.length - 1 });

        // 3. Process Segments (Trim + Map)
        segments.forEach(seg => {
            const len = seg.end - seg.start;
            if (len < 5) return;
            const trimAmt = Math.floor(len * 0.10);
            const safeStart = seg.start + trimAmt;
            const safeEnd = seg.end - trimAmt;
            if (safeEnd <= safeStart) return;

            // Find Min/Max X and Mode LineIndex in Safe Zone
            let minX = Infinity, maxX = -Infinity;
            const lCounts = {};
            let maxC = 0, bestL = -1;

            for (let i = safeStart; i <= safeEnd; i++) {
                const d = validData[i];
                const val = d.gx || d.x;
                if (val < minX) minX = val;
                if (val > maxX) maxX = val;

                const l = Number(d.lineIndex);
                lCounts[l] = (lCounts[l] || 0) + 1;
                if (lCounts[l] > maxC) { maxC = lCounts[l]; bestL = l; }
            }

            // Determine TargetRy
            let targetRy = null;

            // [Strategy: Ink Icon Mapping] (Priority 0)
            // Absolute Trust: If an ink drop exists, align strictly with it.
            // Ink Top was originally set to (LineTop - 10px).
            // So LineTop = InkTop + 10px.
            // We want ReplayY = LineTop + fSize/4.
            // Therefore: ReplayY = InkTop + 10 + fSize/4.
            if (bestL !== -1 && inkMap[bestL]) {
                const inkRect = inkMap[bestL];
                const pStyle = window.getComputedStyle(this.currentP || contentEl);
                const fSize = parseFloat(pStyle.fontSize) || 16;
                // Use Ink's Viewport Top + window.scrollY (for Page Y) + offset restoration
                targetRy = inkRect.top + window.scrollY + 10 + (fSize / 4);
            }

            // [Strategy: CharIndex Mapping] (Priority 1)
            // Fixes "progressive drift" by targeting the exact character element in DOM.
            const charIndices = [];
            for (let k = safeStart; k <= safeEnd; k++) {
                if (validData[k].charIndex !== undefined && validData[k].charIndex !== null) {
                    charIndices.push(validData[k].charIndex);
                }
            }

            if (charIndices.length > 0) {
                charIndices.sort((a, b) => a - b);
                const medianCharIdx = charIndices[Math.floor(charIndices.length / 2)];

                if (this.currentP) {
                    // Filter valid char spans (exclude cursor, ink drops)
                    const spans = Array.from(this.currentP.querySelectorAll("span")).filter(s =>
                        !s.classList.contains("cursor") && !s.classList.contains("ink-drop") && !s.classList.contains("chunk-separator")
                    );

                    if (spans[medianCharIdx]) {
                        const targetSpan = spans[medianCharIdx];
                        const sRect = targetSpan.getBoundingClientRect();
                        const pStyle = window.getComputedStyle(this.currentP);
                        const fSize = parseFloat(pStyle.fontSize) || 16;

                        // Pixel-Perfect Positioning: Span Top + Scroll + Offset
                        targetRy = sRect.top + window.scrollY + (fSize / 4);
                    }
                }
            }

            // [Strategy: Majority LineIndex] (Fallback)
            if (targetRy === null && bestL !== -1) {
                // Prioritize Visual Lines from DOM (Current State)
                if (visualLines[bestL]) {
                    const vLine = visualLines[bestL];
                    const pStyle = window.getComputedStyle(this.currentP || contentEl);
                    const fSize = parseFloat(pStyle.fontSize) || 16;
                    targetRy = vLine.top + window.scrollY + (fSize / 4);
                }
                // Fallback to history if DOM lookup fails
                else {
                    const lineRec = lineYData.find(Rec => Rec.lineIndex === bestL);
                    if (lineRec) {
                        const pStyle = window.getComputedStyle(this.currentP || contentEl);
                        const fSize = parseFloat(pStyle.fontSize) || 16;
                        targetRy = lineRec.y + (fSize / 4);
                    }
                }
            }
            if (targetRy === null) {
                // Fallback: Average Gy
                let sGy = 0, cGy = 0;
                for (let k = safeStart; k <= safeEnd; k++) { sGy += (validData[k].gy || validData[k].y); cGy++; }
                targetRy = cGy ? sGy / cGy : 0;
            }

            // Assign Rx/Ry
            const range = maxX - minX;
            for (let k = safeStart; k <= safeEnd; k++) {
                const d = validData[k];
                let norm = 0;
                if (range > 1) norm = ((d.gx || d.x) - minX) / range;
                norm = Math.max(0, Math.min(1, norm));
                d.rx = globalLeft + norm * globalWidth;
                d.ry = targetRy;
            }
        });

        // 4. Fill Gaps (Interpolation)
        const fill = (prop) => {
            let lastIdx = -1;
            // Find first
            for (let i = 0; i < validData.length; i++) {
                if (validData[i][prop] !== null && validData[i][prop] !== undefined) { lastIdx = i; break; }
            }
            if (lastIdx === -1) return;

            // Fill Head
            for (let i = 0; i < lastIdx; i++) validData[i][prop] = validData[lastIdx][prop];

            // Fill Body
            for (let i = lastIdx + 1; i < validData.length; i++) {
                if (validData[i][prop] !== null && validData[i][prop] !== undefined) {
                    const sVal = validData[lastIdx][prop];
                    const eVal = validData[i][prop];
                    const steps = i - lastIdx;
                    for (let j = 1; j < steps; j++) {
                        validData[lastIdx + j][prop] = sVal + (eVal - sVal) * (j / steps);
                    }
                    lastIdx = i;
                }
            }
            // Fill Tail
            for (let i = lastIdx + 1; i < validData.length; i++) validData[i][prop] = validData[lastIdx][prop];
        };
        fill('rx');
        fill('ry');

        console.log("[Replay] Coords Updated with Chart 7 Logic (K=0.5 Segmentation + Interpolation).");
    },

    startGazeReplay() {
        console.log("[Game] Starting Gaze Replay Logic...");

        // [User Request] Restore vanished text for Replay Background
        if (this.currentP) {
            const hiddenSpans = this.currentP.querySelectorAll("span");
            console.log(`[Replay] Restoring text visibility for ${hiddenSpans.length} spans.`);
            hiddenSpans.forEach(span => {
                span.classList.remove("chunk-fade-out");
                span.style.opacity = "1";
                span.style.transition = "opacity 0.5s ease";
                span.style.transitionDelay = "0s"; // Reset delay
            });
        }

        try {
            // 1. Data Source (SeeSo SDK) with Time Range Filter
            const { startTime, endTime } = window.gazeDataManager.getCharIndexTimeRange();
            const tStart = startTime !== null ? startTime : 0;
            const tEnd = endTime !== null ? endTime : Infinity;

            // Filter by Time Range AND LineIndex AND ensure rx/ry are calculated
            const rawData = window.gazeDataManager.getAllData();
            const validData = rawData.filter(d =>
                d.t >= tStart &&
                d.t <= tEnd &&
                d.lineIndex !== undefined &&
                d.lineIndex !== null &&
                d.rx !== undefined // Check Rx is present (Ry might be null if edge-case)
            );
            console.log(`[Replay] Valid Data Count with Rx/Ry: ${validData.length}`);

            if (validData.length === 0) {
                console.warn("[Replay] No valid gaze data for replay (or rx/ry missing). Proceeding to Villain Quiz directly.");
                this.showVillainQuiz();
                return;
            }

            // 3. Build Replay Stream using stored rx/ry
            const replayData = [];
            let virtualTime = 0;
            let lastRawT = validData[0].t;

            validData.forEach((d, i) => {
                if (i > 0) {
                    const rawDelta = d.t - lastRawT;
                    virtualTime += rawDelta / 3; // 3x Speed
                }
                lastRawT = d.t;

                replayData.push({
                    t: virtualTime,
                    x: d.rx, // Use pre-calculated Rx
                    y: d.ry, // Use pre-calculated Ry (possibly null if edge gap)
                    r: 10, // Radius reduced by 50% (20 -> 10)
                    type: d.type
                });
            });

            if (replayData.length === 0) {
                console.warn("[Replay] Data processing resulted in empty replay stream.");
                this.showVillainQuiz();
                return;
            }

            // 4. Render
            const overlay = document.createElement('canvas');
            overlay.id = "gaze-replay-overlay";
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '9999';
            document.body.appendChild(overlay);

            overlay.width = window.innerWidth;
            overlay.height = window.innerHeight;

            const ctx = overlay.getContext('2d');
            const totalDuration = replayData.length > 0 ? replayData[replayData.length - 1].t : 0;
            let startAnimTime = null;

            const animate = (timestamp) => {
                if (!startAnimTime) startAnimTime = timestamp;
                const progress = timestamp - startAnimTime;

                ctx.clearRect(0, 0, overlay.width, overlay.height);

                let pt = null;
                for (let i = 0; i < replayData.length; i++) {
                    if (replayData[i].t > progress) {
                        pt = replayData[i > 0 ? i - 1 : 0];
                        break;
                    }
                }
                if (!pt && progress >= totalDuration && replayData.length > 0) pt = replayData[replayData.length - 1];

                // Green Circle (Final Replay: ReplayX, ReplayY) - Restored Visibility
                if (pt && pt.y !== null && pt.y !== undefined) {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, pt.r, 0, 2 * Math.PI);

                    if (pt.type === 'Fixation') {
                        ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
                        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
                        ctx.lineWidth = 2;
                    } else {
                        ctx.fillStyle = 'rgba(0, 200, 0, 0.3)';
                        ctx.strokeStyle = 'rgba(0, 200, 0, 0.4)';
                        ctx.lineWidth = 1;
                    }
                    ctx.fill();
                    ctx.stroke();
                }

                if (progress < totalDuration + 1000) {
                    requestAnimationFrame(animate);
                } else {
                    setTimeout(() => {
                        if (document.body.contains(overlay)) document.body.removeChild(overlay);

                        // Export CSV after Replay (User Request)
                        if (window.gazeDataManager && !Game.hasExported) {
                            console.log("[Replay] Finished. Exporting CSV once.");
                            window.gazeDataManager.exportCSV(tStart, tEnd);
                            Game.hasExported = true;
                        }

                        this.showVillainQuiz();
                    }, 500);
                }
            };
            requestAnimationFrame(animate);

        } catch (err) {
            console.error("[Replay] Fatal Error:", err);
            // Emergency fallback to ensure flow continues
            this.showVillainQuiz();
        }
    },

    getVisualLines(container) {
        if (!container) return [];
        const range = document.createRange();
        range.selectNodeContents(container);
        const rects = range.getClientRects();
        const lines = [];
        let currentLineY = -1;
        let currentLineRects = [];

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            // Group rects on the same visual line (allow 5px variance)
            if (Math.abs(r.top - currentLineY) > 5) {
                if (currentLineRects.length > 0) {
                    lines.push({
                        top: currentLineRects[0].top,
                        bottom: currentLineRects[0].bottom,
                        left: Math.min(...currentLineRects.map(rx => rx.left)),
                        right: Math.max(...currentLineRects.map(rx => rx.right))
                    });
                }
                currentLineRects = [r];
                currentLineY = r.top;
            } else {
                currentLineRects.push(r);
            }
        }
        if (currentLineRects.length > 0) {
            lines.push({
                top: currentLineRects[0].top,
                bottom: currentLineRects[0].bottom,
                left: Math.min(...currentLineRects.map(rx => rx.left)),
                right: Math.max(...currentLineRects.map(rx => rx.right))
            });
        }
        return lines;
    },

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

Game.toggleGazeDisplay = function () {
    this.gazeDisplayOn = !this.gazeDisplayOn;
    const btn = document.getElementById("btn-toggle-gaze");

    if (window.setGazeDotState) {
        window.setGazeDotState(this.gazeDisplayOn);
    }

    if (btn) {
        if (this.gazeDisplayOn) {
            btn.innerHTML = "👁️ Gaze Point: <span style='color:#0f0'>ON</span>";
            btn.style.backgroundColor = "#555";
            btn.style.border = "1px solid #0f0";
        } else {
            btn.innerHTML = "👁️ Gaze Point: OFF";
            btn.style.backgroundColor = "#444";
            btn.style.border = "1px solid #555";
        }
    }
};

// Override startReadingSession
Game.startReadingSession = function () {
    console.log("Starting Typewriter Logic...");

    // --- NEW: Force Gaze Dot OFF by Default ---
    // User Requirement: "시선포인트 토글버튼이 디폴트가 아예 안 보이는 것이어야 한다... 사용자 데이터를 확실하게 모아야 한다."
    if (window.setGazeDotState) window.setGazeDotState(false);
    this.gazeDisplayOn = false;
    const btn = document.getElementById("btn-toggle-gaze");
    if (btn) {
        btn.innerHTML = "👁️ Gaze Point: OFF";
        btn.style.backgroundColor = "#444";
        btn.style.border = "1px solid #555";
    }
    // ------------------------------------------

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


