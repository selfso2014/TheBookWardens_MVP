/**
 * The Book Wardens: Game Logic (Algorithm V9.0 - Mean-Gaze Anchored Replay)
 */
const Game = {
    state: {
        gems: 0,
        runes: 0, // NEW: Runes Score
        ink: 0,   // NEW: Ink Score (Pang Event)
        wpmDisplay: 0, // NEW: Smoothed WPM for UI
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

    // --- NEW: Score Management Methods ---
    addInk(amount) {
        this.state.ink = Math.max(0, (this.state.ink || 0) + amount);
        this.updateUI();
    },

    // --- Rift Intro Sequence ---
    startRiftIntro() {
        console.log("Starting Rift Intro Sequence...");
        this.switchScreen("screen-rift-intro");

        const villainContainer = document.getElementById("rift-villain-container");
        const textContainer = document.getElementById("rift-text-container");
        const meteorLayer = document.getElementById("meteor-layer");
        const riftText = document.getElementById("rift-intro-text");

        // Reset State
        textContainer.classList.remove("rift-damaged");
        document.getElementById("screen-rift-intro").classList.remove("screen-shake");
        meteorLayer.innerHTML = "";

        // Restore original text in case of restart
        if (riftText) {
            riftText.innerText = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversation?'";
        }

        // 1. Villain Appears (CSS Animation handles hover)
        // 2. Wait 1s, then Meteors!
        setTimeout(() => {
            // Spawn Meteors loop
            for (let i = 0; i < 20; i++) {
                setTimeout(() => {
                    this.spawnMeteor(meteorLayer);
                }, i * 100); // 20 meteors over 2s
            }

            // Screen Shake starts a bit later
            setTimeout(() => {
                const screen = document.getElementById("screen-rift-intro");
                if (screen) screen.classList.add("screen-shake");
            }, 1000);

            // 3. Impact & Damage Text (at 2.5s)
            setTimeout(() => {
                textContainer.classList.add("rift-damaged");
                // Corrupt Text Content completely
                if (riftText) {
                    const originalText = riftText.innerText;
                    riftText.innerText = this.corruptText(originalText);
                }

                // Audio Cue: Glitch Sound (if available)
            }, 2500);

            // 4. Transition to Word Forge (at 5.0s)
            setTimeout(() => {
                console.log("Rift Intro Done. Moving to Word Forge.");
                this.state.vocabIndex = 0;
                this.loadVocab(0);
                this.switchScreen("screen-word");
            }, 5000); // 5s total duration

        }, 500); // Initial 0.5s wait
    },

    spawnMeteor(layer) {
        if (!layer) return;
        const m = document.createElement("div");
        m.className = "meteor";

        // Random start X (from right side mainly)
        // Let's spawn them from top-right corner area
        const startX = window.innerWidth * 0.5 + Math.random() * window.innerWidth * 0.5;
        const startY = -Math.random() * 200;

        m.style.left = startX + "px";
        m.style.top = startY + "px";

        // Random size/speed
        m.style.animationDuration = (0.5 + Math.random() * 0.5) + "s"; // 0.5~1.0s
        m.style.width = (100 + Math.random() * 200) + "px";

        layer.appendChild(m);

        // Cleanup
        setTimeout(() => m.remove(), 1000);
    },

    corruptText(text) {
        // Replace 50% of characters with glitch symbols
        const glyphs = "#@!$%&?*-_+|~^";
        return text.split('').map(char => {
            if (char === ' ') return ' '; // keep spaces mostly
            return Math.random() > 0.4 ? glyphs[Math.floor(Math.random() * glyphs.length)] : char;
        }).join('');
    },

    addRunes(amount) {
        this.state.runes = Math.max(0, (this.state.runes || 0) + amount);
        this.updateUI();
    },

    addGems(amount) {
        this.state.gems = Math.max(0, (this.state.gems || 0) + amount);
        this.updateUI();
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

        // 4. Session ID for Firebase
        this.sessionId = Math.random().toString(36).substring(2, 6).toUpperCase();
        console.log("Session ID:", this.sessionId);

        // Display Session ID permanently
        // Display Session ID permanently (REMOVED for Production)
        /*
        const sessionBadge = document.createElement("div");
        sessionBadge.innerText = `ID: ${this.sessionId}`;
        sessionBadge.style.cssText = "position:fixed; bottom:10px; left:10px; background:rgba(0,0,0,0.5); color:lime; padding:5px 10px; font-family:monospace; font-weight:bold; z-index:9999; border:1px solid lime; border-radius:4px; pointer-events:none;";
        document.body.appendChild(sessionBadge);
        */

        // DEBUG: Manual Export Button (Removed per user request)

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
                    // Start Rift Intro Scene
                    this.startRiftIntro();

                    // Old Direct Jump:
                    // this.state.vocabIndex = 0; // Reset
                    // this.loadVocab(0);         // Load first word
                    // this.switchScreen("screen-word");
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

        // [FIX] Ensure Cursor Visibility Logic
        if (this.typewriter && this.typewriter.renderer && this.typewriter.renderer.cursor) {
            if (screenId === "screen-read") {
                this.typewriter.renderer.cursor.style.display = "block"; // Show cursor
                this.typewriter.renderer.cursor.style.opacity = "1";
            } else {
                this.typewriter.renderer.cursor.style.display = "none"; // Hide completely
                this.typewriter.renderer.cursor.style.opacity = "0";
            }
        }

        if (screenId === "screen-read") {
            // Reset Context Latching for new session to avoid carrying over old data
            this.lastValidContext = null;

            // [FIX] REMOVED typewriter.start() here to prevent resetting paragraph index.
            // Screen transition handles layout, but game logic flows independently.
        }
    },

    updateUI() {
        // 1. Gem
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.state.gems || 0;

        // 2. Ink
        const inkEl = document.getElementById("ink-count");
        if (inkEl) inkEl.textContent = this.state.ink || 0;

        // 3. Rune
        const runeEl = document.getElementById("rune-count");
        if (runeEl) {
            runeEl.textContent = this.state.runes || 0;
        }

        // 4. WPM (Smoothed Low-Pass Filter)
        const wpmEl = document.getElementById("wpm-display");
        if (wpmEl) {
            // Get Target WPM from GazeDataManager (or fallback)
            let targetWPM = 0;
            if (window.gazeDataManager && window.gazeDataManager.wpm > 0) {
                targetWPM = window.gazeDataManager.wpm;
            } else if (this.typewriter && this.typewriter.startTime && this.typewriter.chunkIndex > 0) {
                // Simple Fallback calculation
                const elapsedMin = (Date.now() - this.typewriter.startTime) / 60000;
                if (elapsedMin > 0) targetWPM = (this.typewriter.chunkIndex * 3) / elapsedMin;
            }

            // Apply Low-Pass Filter (Simple Smoothing)
            // current = prev + alpha * (target - prev)
            // alpha = 0.05 (Very slow) to 0.2 (Fast). Let's use 0.1 for gentle smoothing.
            const alpha = 0.1;
            const currentWPM = this.state.wpmDisplay || 0;

            // If difference is huge (e.g. init), jump directly
            if (Math.abs(targetWPM - currentWPM) > 50 && currentWPM === 0) {
                this.state.wpmDisplay = targetWPM;
            } else {
                this.state.wpmDisplay = currentWPM + alpha * (targetWPM - currentWPM);
            }

            wpmEl.textContent = Math.round(this.state.wpmDisplay);
        }
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
        // Prevent re-entry if already processing (simple lock)
        if (this.isProcessingVocab) return;
        this.isProcessingVocab = true;

        const currentIndex = this.state.vocabIndex || 0;
        const currentData = this.vocabList[currentIndex];
        const isCorrect = (optionIndex === currentData.answer);

        // Find the button element that was clicked
        const optionsDiv = document.getElementById("vocab-options");
        const btns = optionsDiv ? optionsDiv.querySelectorAll(".option-btn") : [];
        const selectedBtn = btns[optionIndex];

        // Disable ALL buttons immediately to prevent multi-click
        btns.forEach(btn => btn.disabled = true);

        if (isCorrect) {
            // --- JUICY SUCCESS ---
            if (selectedBtn) {
                selectedBtn.classList.add("correct");
                // selectedBtn.style.backgroundColor = "#4caf50"; // Handled by CSS .correct usually
                this.spawnFloatingText(selectedBtn, "+10 Runes!", "bonus");
                this.spawnParticles(selectedBtn, 15); // Confetti
            }

            this.addRunes(10); // +10 Rune

            // Wait for animation
            await new Promise(r => setTimeout(r, 1200));

            // Progress
            this.state.vocabIndex++;
            this.isProcessingVocab = false; // Release lock

            if (this.state.vocabIndex < this.vocabList.length) {
                this.loadVocab(this.state.vocabIndex);
            } else {
                console.log("Word Forge Complete. Proceeding to WPM Selection...");
                this.switchScreen("screen-wpm");
            }
        } else {
            // --- JUICY FAIL ---
            this.addRunes(-10); // -10 Rune (Penalty)
            if (selectedBtn) {
                selectedBtn.classList.add("wrong");
                this.spawnFloatingText(selectedBtn, "-10 Rune", "error");
            }

            // Re-enable OTHER buttons so user can try again? 
            // OR strict mode: move to next word? 
            // Request says "1회로 끝나야 한다". Assuming "End trigger" or just "One attempt". 
            // "맞든 틀리든 1회로 끝나야 한다" implies we move on even if wrong.
            // But usually vocabs let you retry. 
            // Interpreting as: "Clicking triggers ONCE."
            // If user wants to "Retry", we should re-enable. 
            // BUT "맞든 틀리든 1회로 끝나야 한다" strongly suggests "One shot per question" or "Once clicked, no more clicks on THIS button".

            // Re-enabling others to allow retry for now, as game logic usually permits retry.
            // BUT to fix "infinite score change", we keep THIS button disabled.
            btns.forEach((btn, idx) => {
                if (idx !== optionIndex) btn.disabled = false;
            });

            this.isProcessingVocab = false; // Release lock
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
    selectWPM(wpm, btnElement) {
        console.log(`[Game] User selected WPM: ${wpm}`);

        // Visual Feedback: Active State
        // Remove .selected from all buttons first (if querySelector available)
        document.querySelectorAll(".wpm-btn").forEach(b => b.classList.remove("selected"));

        // Add to clicked button
        // Since we didn't pass btnElement in HTML onclick, we might need to find it or just trust the user click effect.
        // But better to add it. For now, let's assume we can't easily get the element without changing HTML.
        // If we change HTML, we need to change onclick="Game.selectWPM(200, this)".
        // Let's rely on event.target if possible, or just proceed with delay.

        // Wait for visual feedback (300ms)
        setTimeout(() => {
            // Formula: Delay (ms) = 10000 / WPM
            const delay = Math.floor(10000 / wpm);
            this.targetSpeed = delay;
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
        }, 300); // 300ms Visual Delay
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

        // [FIX] Explicitly START the game engine here mostly ONCE.
        if (this.typewriter && typeof this.typewriter.start === 'function') {
            this.typewriter.start();
        }
    },

    // --- 2. Reading Rift (Original Logic kept for reference, overlaid below) ---
    startReadingSession_OLD() {
        // ... existing logic ...
    },

    confrontVillain() {
        if (this.typewriter) this.typewriter.isPaused = true; // Stop typewriter logic
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
    // checkBoss(optionIndex) - DELETED (Deprecated feature: Direct call to Typewriter checkBossAnswer used instead)


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

    // --- FINAL BOSS DATA ---
    finalQuiz: {
        q: "Based on the text, what made the Rabbit's behavior truly remarkable to Alice?",
        o: [
            "It was wearing a waistcoat and had a watch.",
            "It was speaking in French.",
            "It was eating a jam tart while running."
        ],
        a: 0
    },

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
                container.style.overflow = "visible"; // Allow overflow for debugging visibility

                this.renderer = new TextRenderer("book-content", {
                    fontSize: window.innerWidth <= 768 ? "1.0rem" : "1.3rem",
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

        // --- NEW: Periodic Cloud Upload for Live Dashboard (Every 3s) ---
        if (this.uploadMonitor) clearInterval(this.uploadMonitor);
        this.uploadMonitor = setInterval(() => {
            if (window.gazeDataManager && Game.sessionId) {
                // Only upload if we have data
                if (window.gazeDataManager.data.length > 5) {
                    window.gazeDataManager.uploadToCloud(Game.sessionId);
                }
            }
        }, 3000);
    },

    playNextParagraph() {
        if (this.currentParaIndex >= this.paragraphs.length) {
            // All paragraphs done. Trigger FINAL BOSS.
            this.triggerFinalBossBattle();
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

            // Resume Game Loop safely after layout is ready
            this.isPaused = false;

            // 3. Start Reading Flow
            // UX IMPROVEMENT: Hide cursor initially. 
            // The screen 'fadeIn' animation shifts the text container. 
            // If we show the cursor immediately, it looks like it's floating/misaligned.
            if (this.renderer.cursor) this.renderer.cursor.style.opacity = "0";

            // Wait for measurement and pagination
            setTimeout(() => {
                if (this.renderer) {
                    // Start from Page 0
                    this.renderer.showPage(0).then(() => {
                        this.renderer.resetToStart(); // Aligns correctly
                        if (this.renderer.cursor) this.renderer.cursor.style.opacity = "1";
                        console.log("[Typewriter] Page 0 Ready.");

                        // Start Text after full delay
                        setTimeout(() => {
                            this.startTime = Date.now();
                            this.tick();
                        }, 1000); // Reduced from 3000 to 1000 for snappier page loads
                    });
                }
            }, 600);
        });
    },

    tick() {
        if (this.isPaused) return;

        // Prevent double-tick: clear previous if exists (though usually it fires once)
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // [SAFETY] If chunks are not ready (length 0), wait and retry.
        if (!this.renderer || !this.renderer.chunks || this.renderer.chunks.length === 0) {
            console.warn("[Typewriter] Chunks not ready. Retrying in 500ms...");
            this.timer = setTimeout(() => this.tick(), 500);
            return;
        }

        // Reveal next chunk
        if (this.chunkIndex < this.renderer.chunks.length) {

            // TEXT TRAIN EFFECT (Continuous Flow):
            // Instead of fading out an old chunk manually here, we SCHEDULE the death of the NEW chunk.
            // "I am born now, and I shall die in 4 seconds."
            // This ensures a smooth, independent pipeline regardless of whether the cursor pauses.
            this.renderer.scheduleFadeOut(this.chunkIndex, 3000); // 3 seconds lifetime

            // Wait for Animation to Finish (Promise-based) with Timeout Safety
            const revealPromise = this.renderer.revealChunk(this.chunkIndex);

            // Safety timeout: If animation gets stuck, proceed anyway after 2s
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));

            Promise.race([revealPromise, timeoutPromise]).then(() => {
                // Animation Done (or timed out). Now wait for the "Reading Pause" delay.
                this.chunkIndex++;

                // Calculate Delay (Pause AFTER valid reading)
                let delay = Game.targetChunkDelay || 1500;
                if (delay < 500) delay = 500; // Min pause

                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.tick();
                }, delay);
            });

        } else {
            console.log("Chunk Sequence Finished for current Page/Flow.");

            // Check if there are more pages in this paragraph!
            // [BUGFIX] If all chunks are shown, force finish regardless of 'pages'.
            // The renderer's page count might include trailing empty pages or logic issues.
            // Since chunkIndex >= chunks.length means *ALL* text is visible, we should proceed to end the paragraph.
            /*
            const renderer = this.renderer;
            if (renderer && renderer.currentPageIndex < renderer.pages.length - 1) {
                console.log("[Typewriter] Moving to Next Page...");

                // Fade out current page words? Or just switch?
                // Let's just switch cleanly.
                setTimeout(() => {
                    const nextPage = renderer.currentPageIndex + 1;
                    renderer.showPage(nextPage).then(() => {
                        // Reset chunk index to the first chunk of the new page?
                        // Actually, this.chunkIndex is global for the whole text. 
                        // It continues naturally. We just need to ensure the words are visible.
                        // Wait... The words ON the new page are currently opacity:0.
                        // tick() will reveal them.

                        renderer.resetToStart(); // Move cursor to top of new page
                        this.tick(); // Continue ticking
                    });
                }, 2000); // Wait 2s before flipping page
                return;
            }
            */

            console.log("Paragraph Fully Revealed (All Pages). Clearing tail...");

            // CLEANUP TAIL: Fade out any remaining visible chunks
            // We need to fade out from (chunkIndex - 3) up to (chunkIndex - 1)
            // But actually, since the loop stopped, we just need to clear everything remaining.
            // Let's sweep from max(0, this.chunkIndex - 3) to total chunks.

            let cleanupDelay = 0;
            const startCleanupIdx = Math.max(0, this.chunkIndex - 3);

            // Schedule cleanups for remaining tail
            for (let i = startCleanupIdx; i < this.renderer.chunks.length; i++) {
                this.renderer.scheduleFadeOut(i, cleanupDelay + 600);
                cleanupDelay += 600;
            }

            // AUTO-EXPORT TO FIREBASE
            // Triggered automatically when the paragraphs is fully displayed + 3s reading time.
            setTimeout(() => {
                console.log("[Auto-Upload] ------------------------------------------------");
                console.log("[Auto-Upload] Paragraph Complete. Uploading to Cloud.");
                console.log("[Auto-Upload] ------------------------------------------------");

                if (window.gazeDataManager && Game.sessionId) {
                    // Upload instead of download
                    window.gazeDataManager.uploadToCloud(Game.sessionId);
                }
            }, 3000);

            // [CHANGED] Always trigger Mid-Boss Battle after ANY paragraph (including the last one).
            // Logic: P1 -> Mid -> P2 -> Mid -> P3 -> Mid -> Final
            setTimeout(() => {
                this.triggerMidBossBattle();
            }, 1000); // 1s delay for dramatic effect
        }
    },

    // --- NEW: Mid-Boss Battle (After each paragraph) ---
    triggerMidBossBattle() {
        console.log(`[Typewriter] Triggering Villain for Para ${this.currentParaIndex}`);
        if (this.uploadMonitor) clearInterval(this.uploadMonitor);

        // Use the same screen as final boss, but load specific quiz
        this.loadBossQuiz(this.currentParaIndex);
        Game.confrontVillain();
    },

    loadBossQuiz(index) {
        if (!this.quizzes || !this.quizzes[index]) return;

        const quiz = this.quizzes[index];
        const questionEl = document.getElementById("boss-question");
        const optionsEl = document.getElementById("boss-options");

        if (questionEl) questionEl.textContent = `"${quiz.q}"`;
        if (optionsEl) {
            optionsEl.innerHTML = "";
            quiz.o.forEach((optText, i) => {
                const btn = document.createElement("button"); // FIXED: Re-added missing variable declaration
                btn.className = "quiz-btn";
                btn.textContent = optText;
                btn.onclick = () => this.checkBossAnswer(i); // Direct call to avoid Game.checkBoss issues
                optionsEl.appendChild(btn);
            });
        }
    },

    // --- Core Interaction: Gaze Input ---
    updateGazeStats(x, y) {
        if (!this.renderer || !this.renderer.isLayoutLocked) return;

        // 1. Hit Test against Fixed Layout
        const hit = this.renderer.hitTest(x, y);

        // 2. Define Content Context (Source of Truth)
        // User Definition: "Line Index is simply the line number that has appeared on screen."
        const contentLineIndex = this.renderer.currentVisibleLineIndex || 0;
        let contentTargetY = null;

        // Find the Y coordinate of the current content line
        if (this.renderer.lines && this.renderer.lines[contentLineIndex]) {
            contentTargetY = this.renderer.lines[contentLineIndex].visualY;
        }

        // 3. Return Sweep Logic is handled entirely by GazeDataManager's internal processGaze loop.
        // We only need to provide the context (current line index) so it can detect changes.

        // 4. Sync Context to Data Manager
        if (window.gazeDataManager) {
            const ctx = {
                lineIndex: contentLineIndex, // Essential for RS detection
                targetY: contentTargetY,
                paraIndex: this.currentParaIndex,
                wordIndex: null
            };
            window.gazeDataManager.setContext(ctx);
        }

        // 5. Visual Interactions (Hit Testing for Highlights Only)
        if (hit && hit.type === 'word') {
            const word = hit.word;
            // Only highlight if the word is actually revealed
            if (word.element && !word.element.classList.contains("read") && word.element.classList.contains("revealed")) {
                word.element.classList.add("read");
                word.element.style.color = "#fff";
                word.element.style.textShadow = "0 0 8px var(--primary-accent)";
            }
            if (hit.line) this.trackLineProgress(hit.line, word.index);
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

        // Report Coverage to Data Manager
        if (window.gazeDataManager) {
            window.gazeDataManager.setLineMetadata(line.index, {
                coverage: ratio * 100
            });
        }

        // Threshold: 60% of words in line read
        if (ratio > 0.6 && !line.completed) {
            line.completed = true; // Flag in renderer's line object (runtime only)
            // Deprecated: spawnInkReward(line); // Visual effect removed as per request
        }
    },

    // spawnInkReward(line) - DELETED (Deprecated feature)


    updateWPM() {
        const disp = document.getElementById("wpm-display");
        if (!disp) return;

        // Check if currently reading (screen-read is active)
        const isReading = document.getElementById("screen-read")?.classList.contains("active");
        if (!isReading || this.isPaused) return;

        // Priority 1: GazeDataManager (Accurate)
        if (window.gazeDataManager && window.gazeDataManager.wpm > 0) {
            disp.textContent = Math.round(window.gazeDataManager.wpm);
            return;
        }

        // Priority 2: Simple estimation (Fallback)
        if (this.startTime && this.chunkIndex > 0) {
            const elapsedMin = (Date.now() - this.startTime) / 60000;
            if (elapsedMin > 0) {
                const wpm = Math.round((this.chunkIndex * 3) / elapsedMin);
                disp.textContent = wpm; // Fix: Only number, no suffix
            }
        }
    },

    startBossBattle() {
        console.log("Entering Boss Battle!");
        if (this.uploadMonitor) clearInterval(this.uploadMonitor); // Stop auto-upload
        if (window.gazeDataManager && Game.sessionId) {
            window.gazeDataManager.uploadToCloud(Game.sessionId); // Final Upload
        }
        Game.confrontVillain();
    },

    // Stub
    checkGazeDistance(x, y) {
        this.updateGazeStats(x, y);
    },

    checkBossAnswer(optionIndex) {
        const currentIndex = this.currentParaIndex;
        const quiz = this.quizzes[currentIndex];

        // Correct Answer Check
        // Correct Answer Check
        if (optionIndex === quiz.a) {
            // SUCCESS
            // alert("Shadow Defeated! The Rift clears..."); // Deleted: Interrupts flow
            Game.addGems(10); // +10 Gem (Mid-Boss)

            const bossDialog = document.querySelector(".boss-dialogue"); // FIXED: Correct class name
            if (bossDialog && typeof Game.spawnFloatingText === 'function') {
                Game.spawnFloatingText(bossDialog, "+10 Gems! CLEAR!", "bonus"); // Feedback
            } else {
                console.log("Boss Defeated! +10 Gems");
            }

            // Hide Boss UI immediately (Force)
            const villainScreen = document.getElementById("villain-screen");
            if (villainScreen) {
                villainScreen.classList.remove("active");
                villainScreen.style.display = "none"; // Hard hide to prevent loop
                // Restore display property after transition so it can reappear later
                setTimeout(() => { villainScreen.style.display = ""; }, 2000);
            }

            // Check if this was the Last Paragraph
            if (this.currentParaIndex >= this.paragraphs.length - 1) {
                // [CHANGED] Instead of Victory, go to FINAL BOSS
                console.log("[Game] All paragraphs done. Summoning ARCH-VILLAIN...");
                setTimeout(() => {
                    this.triggerFinalBossBattle();
                }, 1500);
            } else {
                // GO TO NEXT PARAGRAPH
                // Force hide villain modal if exists
                const villainModal = document.getElementById("villain-modal");
                if (villainModal) villainModal.style.display = "none";

                this.currentParaIndex++;
                console.log(`[Game] Advancing to Stage ${this.currentParaIndex + 1}...`);

                // Reset State for Next Paragraph
                this.chunkIndex = 0;
                this.lineStats.clear();
                // Note: Do NOT resume 'isPaused' here. It will be resumed inside playNextParagraph() after content is ready.

                // Ensure clean transition with shorter delay (1.5s) per request
                setTimeout(() => {
                    Game.switchScreen("screen-read");
                    // Wait a bit for screen transition before starting text
                    setTimeout(() => {
                        this.chunkIndex = 0; // Double ensure reset
                        this.playNextParagraph();
                    }, 500);
                }, 1500); // Reduced from 3000 to 1500
            }
        } else {
            // FAILURE
            Game.addGems(-10); // -10 Gem (Penalty)
            Game.spawnFloatingText(document.querySelector(".boss-dialog-box"), "-10 Gems", "error");

            const btn = document.querySelectorAll("#boss-quiz-options button")[optionIndex];
            if (btn) {
                btn.style.background = "#c62828";
                btn.innerText += " (Wrong)";
                btn.disabled = true;
            }
        }
    },

    triggerFinalBossBattle() {
        Game.switchScreen("screen-final-boss");

        // Load Final Quiz
        const qData = this.finalQuiz;
        const qEl = document.getElementById("final-boss-question");
        const oEl = document.getElementById("final-boss-options");

        if (qEl) qEl.textContent = `"${qData.q}"`;
        if (oEl) {
            oEl.innerHTML = "";
            qData.o.forEach((optText, i) => {
                const btn = document.createElement("button");
                btn.className = "quiz-btn";
                // Make final boss buttons look harder/different
                btn.style.borderColor = "#ff4444";
                btn.textContent = optText;
                btn.onclick = () => this.checkFinalBossAnswer(i);
                oEl.appendChild(btn);
            });
        }
    },

    checkFinalBossAnswer(index) {
        if (index === this.finalQuiz.a) {
            // TRUE VICTORY
            alert("ARCH-VILLAIN DEFEATED! The Rift is sealed forever.");
            Game.addGems(30); // +30 Gem (Final Boss)

            Game.switchScreen("screen-win");
        } else {
            Game.addGems(-30); // -30 Gem (Penalty)
            const btn = document.querySelectorAll("#final-boss-options .quiz-btn")[index];
            if (btn) {
                btn.style.background = "#500";
                btn.innerText += " (The Villain laughs...)";
                btn.disabled = true;
            }
        }
    }
};

window.Game = Game;
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});


