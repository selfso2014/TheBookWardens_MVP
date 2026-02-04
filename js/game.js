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

        // 3. Auto-start / Skip Logic
        const params = new URLSearchParams(window.location.search);

        // NEW: Check for 'skip_intro=1' (Coming back from In-App Browser Redirect)
        // If present, we skip the splash screen entirely and go to Home.
        if (params.get("skip_intro") === "1" && !this.isInAppBrowser()) {
            console.log("Skipping Intro (Returned from redirect)");
            // Manually switch active screen from Splash (default) to Home
            // But first, ensure DOM is ready or just force switch
            document.addEventListener("DOMContentLoaded", () => {
                this.switchScreen("screen-home");
            });
            // Also execute immediately in case DOM is already ready
            this.switchScreen("screen-home");
        } else {
            // Normal Load: Splash is active by default in HTML. Do nothing.
        }

        // Legacy 'skip=1' logic - keeping for backward compatibility if needed, 
        // but the new flow prefers 'skip_intro'.
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
            // Add 'skip_intro=1' to signal that we should skip the splash on re-entry
            // Use 'skip_intro' instead of just 'skip' to differentiate intent if needed
            if (newUrl.indexOf("?") === -1) newUrl += "?skip_intro=1";
            else if (newUrl.indexOf("skip_intro=1") === -1) newUrl += "&skip_intro=1";

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

        // Find the button element that was clicked
        // We need to re-select because we passed an index, or we could pass event/element
        // Assuming the order matches:
        const optionsDiv = document.getElementById("vocab-options");
        const btns = optionsDiv ? optionsDiv.querySelectorAll(".option-btn") : [];
        const selectedBtn = btns[optionIndex];

        // Prevent multi-click during animation
        if (selectedBtn && selectedBtn.disabled) return;

        const isCorrect = (optionIndex === currentData.answer);

        if (isCorrect) {
            // --- JUICY SUCCESS ---
            if (selectedBtn) {
                selectedBtn.classList.add("correct");
                this.spawnFloatingText(selectedBtn, "+10 Gems!", "correct");
                this.spawnParticles(selectedBtn, 15); // Confetti
            }

            // Audio cue here (optional)

            this.state.gems += 10;
            this.updateUI();

            // Wait for animation
            await new Promise(r => setTimeout(r, 1200));

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
            // --- JUICY FAIL ---
            if (selectedBtn) {
                selectedBtn.classList.add("wrong");
                selectedBtn.disabled = true; // Disable this specific wrong option
                this.spawnFloatingText(selectedBtn, "The Rift resists...", "error");
            }
            // Audio cue here (optional)
        }
    },

    // FX Helpers
    spawnFloatingText(targetEl, text, type) {
        const rect = targetEl.getBoundingClientRect();
        const floatEl = document.createElement("div");
        floatEl.className = `feedback-text ${type}`;
        floatEl.innerText = text;
        floatEl.style.left = (rect.left + rect.width / 2) + "px";
        floatEl.style.top = (rect.top) + "px"; // Start slightly above
        document.body.appendChild(floatEl);

        // Cleanup
        setTimeout(() => floatEl.remove(), 1000);
    },

    spawnParticles(targetEl, count) {
        const rect = targetEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        for (let i = 0; i < count; i++) {
            const p = document.createElement("div");
            p.className = "particle";

            // Random scatter
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 60 + 20; // 20px to 80px out
            const tx = Math.cos(angle) * dist + "px";
            const ty = Math.sin(angle) * dist + "px";

            p.style.setProperty("--tx", tx);
            p.style.setProperty("--ty", ty);
            p.style.left = centerX + "px";
            p.style.top = centerY + "px";
            p.style.backgroundColor = `hsl(${Math.random() * 50 + 40}, 100%, 50%)`; // Gold/Yellow range

            document.body.appendChild(p);
            setTimeout(() => p.remove(), 800);
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
        // User Request: Make gaze dot transparent (invisible) but keep tracking active
        if (typeof window.setGazeDotState === "function") {
            window.setGazeDotState(false);
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

            // Check if there are more paragraphs
            if (this.typewriter.currentParaIndex < this.typewriter.paragraphs.length - 1) {
                // Next Paragraph
                this.typewriter.currentParaIndex++;
                console.log(`[Game] Advancing to Paragraph ${this.typewriter.currentParaIndex + 1}...`);

                // Hide Villain Modal / Screen (Assuming we are on screen-boss)
                // Switch back to reading screen
                this.switchScreen("screen-read");

                // Trigger next paragraph after a short delay for screen transition
                setTimeout(() => {
                    this.typewriter.playNextParagraph();
                }, 500);

            } else {
                // All Paragraphs Done -> FINAL BOSS / WIN
                console.log("[Game] All paragraphs completed. Victory!");
                this.switchScreen("screen-win");
            }

        } else {
            alert("The Shadow deflects your attack! Try reading carefully.");
        }
    },

    // --- 4. Splash Screen Logic ---
    dismissSplash() {
        console.log("Splash Displayed. User interaction detected.");

        // 1. Check In-App Browser IMMEDIATELY upon touch
        if (this.isInAppBrowser()) {
            // If In-App, redirect to System Browser (Chrome) immediately.
            // This will reload the page in Chrome with ?skip_intro=1
            this.openSystemBrowser();
            return;
        }

        // 2. If Normal Browser, Transition to Lobby
        // Audio interaction could go here

        // Transition to Lobby
        const splash = document.getElementById("screen-splash");
        if (splash) {
            splash.style.opacity = "0";
            setTimeout(() => {
                this.switchScreen("screen-home");
                // Reset opacity for potential reuse or simply hide
                splash.style.display = "none";
            }, 500); // Match CSS transition if any, or just fast
        } else {
            this.switchScreen("screen-home");
        }
    }
};

// --- Typewriter Mode Logic (Refactored for TextRenderer) ---
Game.typewriter = {
    renderer: null,

    // Data (Content)
    paragraphs: [
        "Alice was beginning to / get very tired / of sitting by her sister / on the bank, / and of having nothing to do: / once or twice / she had peeped into the book / her sister was reading, / but it had no pictures / or conversations / in it, / “and what is the use of a book,” / thought Alice / “without pictures / or conversations?\"",
        "So she was considering / in her own mind / (as well as she could, / for the hot day made her feel / very sleepy and stupid), / whether the pleasure / of making a daisy-chain / would be worth the trouble / of getting up and picking the daisies, / when suddenly / a White Rabbit with pink eyes / ran close by her.",
        "There was nothing so VERY remarkable in that; / nor did Alice think it so VERY much out of the way / to hear the Rabbit say to itself, / “Oh dear! Oh dear! I shall be late!” / (when she thought it over afterwards, / it occurred to her that she ought to have wondered at this, / but at the time it all seemed quite natural); / but when the Rabbit actually TOOK A WATCH / OUT OF ITS WAISTCOAT-POCKET, / and looked at it, / and then hurried on, / Alice started to her feet."
    ],
    quizzes: [
        { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
        { q: "What animal ran by Alice?", o: ["A Black Cat", "A White Rabbit", "A Brown Dog"], a: 1 },
        { q: "What did the Rabbit take out of its pocket?", o: ["A Watch", "A Carrot", "A Map"], a: 0 }
    ],

    // State
    currentParaIndex: 0,
    chunkIndex: 0,
    isPaused: false,
    timer: null,

    // Stats
    startTime: null,
    wordCount: 0,

    // Reading Tracking (Line-based)
    lineStats: new Map(), // lineIndex -> Set(wordIndices hit)

    init() {
        // Init renderer if not already
        if (!this.renderer) {
            // Ensure container exists
            const container = document.getElementById("book-content");
            if (container) {
                // Apply layout styles JS-side just in case CSS missed something
                container.style.position = "relative";
                container.style.overflow = "hidden"; // Enforce no-scroll

                this.renderer = new TextRenderer("book-content", {
                    fontSize: window.innerWidth <= 768 ? "1.2rem" : "1.5rem",
                    lineHeight: "2.8",
                    wordSpacing: "0.4em",
                    padding: "20px"
                });
            } else {
                console.error("TextRenderer Container Not Found");
            }
        }
    },

    start() {
        console.log("[Typewriter] Starting Engine V2 (TextRenderer)...");
        this.init();

        if (!this.renderer) return;

        this.currentParaIndex = 0;
        this.isPaused = false;
        this.lineStats.clear();

        Game.state.ink = 0;
        Game.updateUI();

        // Ensure first paragraph plays
        this.playNextParagraph();

        // WPM Monitor
        if (this.wpmMonitor) clearInterval(this.wpmMonitor);
        this.wpmMonitor = setInterval(() => this.updateWPM(), 1000);
    },

    playNextParagraph() {
        if (this.currentParaIndex >= this.paragraphs.length) {
            this.startBossBattle();
            return;
        }

        const text = this.paragraphs[this.currentParaIndex];
        console.log(`[Typewriter] Playing Para ${this.currentParaIndex}`);

        // 1. Prepare Content
        this.renderer.prepare(text);
        this.chunkIndex = 0;
        this.lineStats.clear(); // Reset reading stats for new page

        // 2. Lock Layout (Next Frame to allow DOM render)
        requestAnimationFrame(() => {
            this.renderer.lockLayout();
            const debugEl = document.getElementById('line-detect-result');
            if (debugEl) debugEl.textContent = `Lines Cached: ${this.renderer.lines.length}`;

            // 3. Start Reading Flow
            this.startTime = Date.now();
            this.tick();
        });
    },

    tick() {
        if (this.isPaused) return;

        // Reveal next chunk
        if (this.chunkIndex < this.renderer.chunks.length) {
            this.renderer.revealChunk(this.chunkIndex);
            this.chunkIndex++;

            // Calculate Delay
            const delay = Game.targetChunkDelay || 800;
            this.timer = setTimeout(() => this.tick(), delay);
        } else {
            console.log("Paragraph Fully Revealed.");
        }
    },

    // --- Core Interaction: Gaze Input ---
    updateGazeStats(x, y) {
        if (!this.renderer || !this.renderer.isLayoutLocked) return;

        // 1. Hit Test against Fixed Layout
        const hit = this.renderer.hitTest(x, y);

        if (hit) {
            if (hit.type === 'word') {
                const word = hit.word;
                const line = hit.line;

                // Highlight Effect
                if (word.element && !word.element.classList.contains("read")) {
                    word.element.classList.add("read");
                    // Direct style/class manipulation
                    word.element.style.color = "#fff";
                    word.element.style.textShadow = "0 0 8px var(--primary-accent)";
                }

                // Track Line Progress
                this.trackLineProgress(line, word.index);
            }
        }
    },

    trackLineProgress(line, wordIndex) {
        // Use the line's startIndex as a unique ID
        const lineId = line.startIndex;

        if (!this.lineStats.has(lineId)) {
            this.lineStats.set(lineId, new Set());
        }

        const hitWords = this.lineStats.get(lineId);
        hitWords.add(wordIndex);

        // Check Coverage
        const totalWordsInLine = line.wordIndices.length;
        const hitCount = hitWords.size;
        const ratio = hitCount / totalWordsInLine;

        // Threshold: 60% of words in line read
        if (ratio > 0.6 && !line.completed) {
            line.completed = true; // Flag in renderer's line object (runtime only)
            this.spawnInkReward(line);
        }
    },

    spawnInkReward(line) {
        // Spawn Ink Drop at end of line
        const r = line.rect; // Viewport coordinates

        const ink = document.createElement("div");
        ink.textContent = "💧";
        ink.className = "ink-drop";
        ink.style.position = "absolute"; // or fixed if using viewport coords directly

        // Use FIXED for Viewport Coords to be safe against any scrolling
        ink.style.position = "fixed";
        ink.style.left = (r.right + 10) + "px";
        ink.style.top = (r.centerY - 10) + "px"; // Centered vertically
        ink.style.zIndex = "2000";
        ink.style.fontSize = "1.5rem";
        ink.style.animation = "popIn 0.5s ease-out";

        document.body.appendChild(ink);

        // Update Game State
        if (Game.state) {
            Game.state.ink = (Game.state.ink || 0) + 1;
            Game.updateUI();
        }
    },

    updateWPM() {
        // Simple WPM estimation
        if (!this.startTime) return;
        const elapsedMin = (Date.now() - this.startTime) / 60000;
        if (elapsedMin <= 0) return;
        const wpm = Math.round((this.chunkIndex * 3) / elapsedMin);
        const disp = document.getElementById("wpm-display");
        if (disp) disp.textContent = `${wpm} WPM`;
    },

    startBossBattle() {
        console.log("Entering Boss Battle!");
        Game.confrontVillain();
    },

    // Stub
    checkGazeDistance(x, y) {
        this.updateGazeStats(x, y);
    }
};

window.Game = Game;
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});


