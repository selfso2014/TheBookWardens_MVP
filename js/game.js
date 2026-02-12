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
    // --- Rift Intro Sequence (Cinematic 20s) ---
    async startRiftIntro() {
        console.log("Starting Rift Intro Sequence...");

        // Helper for delays
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Initial Delay for SDK Loading Message (2.0s)
        // Initial Delay for SDK Loading Message (2.0s) - REMOVED per user request
        // await wait(2000);

        this.switchScreen("screen-rift-intro");

        const introScreen = document.getElementById("screen-rift-intro");
        const villainContainer = document.getElementById("rift-villain-container");
        const textContainer = document.getElementById("rift-text-container");
        const meteorLayer = document.getElementById("meteor-layer");
        // const riftText = document.getElementById("rift-intro-text"); // Removed for Image Only

        // Reset State
        introScreen.className = "screen active scene-peace"; // Start with Peace
        textContainer.className = ""; // Reset basic
        villainContainer.className = "";
        meteorLayer.innerHTML = "";

        // Restore original text
        /* Removed Text Logic */

        // --- SCENE 1: PEACE (0s - 2.2s) ---
        // Text fades in smoothly
        await wait(200);
        textContainer.style.opacity = 1;
        textContainer.style.transform = "translateY(0)";

        this.showStoryText("Every story holds a world within.");
        await wait(2000); // 1.5s reading time + 0.5s fade

        // --- SCENE 2: WARNING (2.2s - 4.2s) ---
        introScreen.classList.remove("scene-peace");
        introScreen.classList.add("scene-warning");

        this.showStoryText("But chaos seeks to consume it.");
        // Villain fades in
        villainContainer.style.opacity = 0.6;
        await wait(2000); // 1.5s reading time + 0.5s fade

        // --- SCENE 3: INVASION (4.2s - 5.7s) ---
        introScreen.classList.remove("scene-warning");
        introScreen.classList.add("scene-invasion");

        this.showStoryText("The Rift opens!", "villain");
        villainContainer.style.opacity = 1;

        // Start light meteors
        const lightMeteorLoop = setInterval(() => {
            if (Math.random() > 0.7) this.spawnMeteor(meteorLayer);
        }, 300);

        await wait(1500); // 1.0s reading time (Short sentence)
        clearInterval(lightMeteorLoop);

        // --- SCENE 4: DESTRUCTION (5.7s - 9.5s) ---
        introScreen.classList.remove("scene-invasion");
        introScreen.classList.add("scene-destruction");

        // CRITICAL MESSAGE - Extended Duration
        this.showStoryText("The words are fading...<br>WARDEN, RESTORE THE STORY!");
        textContainer.classList.add("rift-damaged");

        // Heavy meteors
        const heavyMeteorLoop = setInterval(() => {
            this.spawnMeteor(meteorLayer);
            this.spawnMeteor(meteorLayer); // Double spawn
        }, 100);

        await wait(3000); // 2.5s reading time (Essential message)

        // Corrupt text
        /* Removed Text Logic */

        await wait(800); // Short post-damage lingering
        clearInterval(heavyMeteorLoop);

        // --- SCENE 5: TRANSITION ---
        this.showStoryText("Initializing Word Forge...");
        await wait(1000);

        console.log("Rift Intro Done. Moving to Word Forge.");

        // Show deferred connected message if already ready
        if (this.state.sdkLoading && this.state.sdkLoading.isReady) {
            this.showToast("Magic Eye Connected!");
        }

        this.state.vocabIndex = 0;
        this.loadVocab(0);
        this.switchScreen("screen-word");
    },

    showStoryText(message, type = "overlay") {
        if (type === "villain") {
            const bubble = document.getElementById("rift-villain-speech");
            if (!bubble) return;
            bubble.innerText = message;
            bubble.classList.add("show");
            setTimeout(() => bubble.classList.remove("show"), 3000);
        } else {
            const overlay = document.getElementById("rift-story-overlay");
            if (!overlay) return;
            overlay.innerHTML = message; // Allow HTML for <br>
            overlay.classList.add("show");
            setTimeout(() => overlay.classList.remove("show"), 3500);
        }
    },




    spawnMeteor(layer) {
        if (!layer) return;
        const m = document.createElement("div");
        m.className = "meteor";

        // Spawn Area: Top-Left to Top-Center for Diagonal Fall (Top-Left -> Bottom-Right)
        // X: -20% to 80% (Left side mostly)
        // Y: 0px to 400px (Start lower to hit text directly)
        const startX = (Math.random() * window.innerWidth * 1.0) - (window.innerWidth * 0.2);
        const startY = Math.random() * 400;

        m.style.left = startX + "px";
        m.style.top = startY + "px";

        // Random size: 200px - 500px
        const size = 200 + Math.random() * 300;
        m.style.width = size + "px";

        // Random speed: 0.8s - 1.5s
        const speed = 0.8 + Math.random() * 0.7;
        m.style.animationDuration = speed + "s";

        // Random delay to make it feel natural
        m.style.animationDelay = (Math.random() * 0.2) + "s";

        layer.appendChild(m);

        // Cleanup based on max duration
        setTimeout(() => m.remove(), 2000);
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
        // [COORDINATION] Link Gaze Data Manager
        if (window.gazeDataManager) {
            this.gazeManager = window.gazeDataManager;
            console.log("[Game] Linked to window.gazeDataManager");
        } else {
            console.warn("[Game] window.gazeDataManager not found during init. Will retry in start().");
        }

        // [NEW] Hook for App.js to update Game Loading UI
        window.updateLoadingProgress = (pct, msg) => {
            if (this.updateSDKProgress) this.updateSDKProgress(pct, msg);
        };

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
                // Loader Animation


                // Start Rift Intro Scene immediately (Delay handled inside)
                this.startRiftIntro();

                this.trackingInitPromise = (async () => {
                    try {
                        // 1. Start Message (REMOVED per user request to avoid popup/layout shift)
                        // this.updateSDKProgress(10, "Summoning Magic Eye...");
                        if (typeof window.startEyeTracking === "function") {
                            // Hook into window.onSDKProgress if available (we will add this to app.js later)
                            // For now, manual updates

                            const ok = await window.startEyeTracking();

                            if (!ok) {
                                throw new Error("Permission denied or initialization failed.");
                            }

                            this.updateSDKProgress(100, "Connected!");
                            // this.showToast("Magic Eye Connected!"); // Shortened message - DEFERRED
                            return true;
                        } else {
                            console.warn("window.startEyeTracking not found.");
                            this.updateSDKProgress(0, "Magic Error :(");
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
        // Initialize WPM Previews
        this.initWPMPreviews();
    },

    // [New] Animation Logic: Mimics Game's TextRendererV2 (Word-Based + Fade + Chunk Pause)
    initWPMPreviews() {
        const boxes = document.querySelectorAll('.wpm-anim-box');
        if (boxes.length === 0) return;

        // Reduced to 3 lines for compact view
        const sentences = [
            "The sun was warm in the sky.",
            "A small boy walked to the park.",
            "He saw a dog on the grass."
        ];

        // Loop text for continuous preview
        const fullText = sentences.join(" ");

        boxes.forEach(box => {
            const wpm = parseInt(box.getAttribute('data-wpm'), 10) || 100;
            // Clear previous
            if (box._previewCleanup) box._previewCleanup();

            // Run the simulation
            this.runWPMPreview(box, wpm, fullText);
        });
    },

    // Reusable WPM Simulation Engine
    runWPMPreview(container, wpm, text) {
        container.innerHTML = "";
        container.style.position = "relative";
        container.style.whiteSpace = "normal"; // Allow word wrap
        container.style.overflow = "hidden";
        container.style.display = "block";
        container.style.height = "auto";
        container.style.minHeight = "1.8em"; // Compact height
        container.style.fontSize = "0.85rem"; // Smaller font for speed feel
        container.style.lineHeight = "1.4"; // Space saver
        container.style.color = "#aaa"; // Dimmer text

        // Split into words
        const words = text.split(" ");
        let wordSpans = [];

        // Pre-create generic spans (Word-Based)
        words.forEach(w => {
            const span = document.createElement("span");
            span.textContent = w;
            span.style.opacity = "0";
            span.style.marginRight = "0.3em";
            span.style.display = "inline-block";
            // Game-like Fade In + Slide Up
            span.style.transition = "opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
            span.style.transform = "translateY(10px)";
            span.style.color = "#eee"; // Highlighted text color
            container.appendChild(span);
            wordSpans.push(span);
        });

        // Loop State
        let currentIndex = 0;
        let isRunning = true;
        let timer = null;
        let chunkCount = 0;

        // --- SPECIFICATION ---
        // Word Interval: Fixed 150ms (Matches Game)
        const WORD_INTERVAL = 150;

        // Target Chunk Size (Variable by WPM)
        let targetChunkSize = 4; // Default (200 WPM)
        if (wpm <= 100) targetChunkSize = 3; // Short (2-3)
        if (wpm >= 300) targetChunkSize = 6; // Long (5-6)

        // Pause Calibration (Calculated to approximate WPM)
        // Formula: Pause = (ChunkSize * 60000 / WPM) - (ChunkSize * 150)
        // We use a simplified multiplier based on the spec analysis.
        let pauseMultiplier = 1.0;
        if (wpm <= 100) pauseMultiplier = 1.4; // Need longer pause
        if (wpm === 200) pauseMultiplier = 1.5; // Correction
        if (wpm >= 300) pauseMultiplier = 1.0; // Close enough

        // Base Calculation from Game Logic
        const baseDelay = Math.floor(10000 / wpm);
        // Apply calibration
        const calibratedPause = Math.max(200, (baseDelay * 8) * pauseMultiplier);

        const tick = () => {
            if (!isRunning) return;

            // Check Reset
            if (currentIndex >= wordSpans.length) {
                setTimeout(() => {
                    wordSpans.forEach(s => {
                        s.style.opacity = "0";
                        s.style.transform = "translateY(10px)";
                    });
                    currentIndex = 0;
                    chunkCount = 0;
                    tick();
                }, 2000);
                return;
            }

            const span = wordSpans[currentIndex];
            const wordText = words[currentIndex];

            // Reveal Word
            span.style.opacity = "1";
            span.style.transform = "translateY(0)";

            currentIndex++;
            chunkCount++;

            // Fade Out Scheduling (Tail Effect)
            setTimeout(() => {
                if (isRunning && span) {
                    span.style.opacity = "0.3";
                }
            }, 2000);

            // Determine Next Delay
            let nextDelay = WORD_INTERVAL;

            // Check Chunk/Pause Condition
            const isEnd = wordText.includes('.') || wordText.includes('?') || wordText.includes('!');
            const isComma = wordText.includes(',');

            // Logic: Pause if Punctuation OR Chunk Size Reached
            if (isEnd || isComma || chunkCount >= targetChunkSize) {
                nextDelay = calibratedPause;

                // Reset chunk count. 
                // For 100 WPM, maybe randomize 2 or 3? Let's stick to 3 for consistency.
                chunkCount = 0;
            }

            timer = setTimeout(tick, nextDelay);
        };

        // Start
        tick();

        // Cleanup
        container._previewCleanup = () => {
            isRunning = false;
            if (timer) clearTimeout(timer);
            container.innerHTML = "";
        };
    },

    // --- NEW: SDK Loading Feedback ---
    updateSDKProgress(progress, status) {
        // Init state if missing
        if (!this.state.sdkLoading) this.state.sdkLoading = { progress: 0, status: 'Idle', isReady: false };

        this.state.sdkLoading.progress = progress;
        this.state.sdkLoading.status = status;
        this.state.sdkLoading.isReady = (progress >= 100);

        // Update Modal if visible
        const modal = document.getElementById("sdk-loading-modal");
        if (modal && modal.style.display === "flex") {
            const bar = modal.querySelector(".sdk-progress-bar");
            const txt = modal.querySelector(".sdk-status-text");
            if (bar) bar.style.width = `${progress}%`;
            if (txt) txt.textContent = `${status} (${progress}%)`;

            // Auto-close if ready
            if (this.state.sdkLoading.isReady) {
                setTimeout(() => {
                    modal.style.display = "none";
                    // If we were waiting, retry the pending action (WPM selection)
                    if (this.pendingWPMAction) {
                        this.pendingWPMAction();
                        this.pendingWPMAction = null;
                    }
                }, 500);
            }
        }
        // ELSE: Show non-intrusive Toast feedback
        else {
            // Do NOT show "Connected" toast automatically to avoid overlap with Intro
            if (progress < 100) {
                this.showToast(`${status} (${progress}%)`, 2000);
            }
        }
    },

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
            sentence: '"The <b>luminous</b> mushroom lit up the dark cave."',
            options: [
                "A. Very heavy and dark",
                "B. Full of light / Shining",
                "C. Related to the moon"
            ],
            answer: 1,
            image: "./rune_luminous.png"
        },
        {
            word: "Peculiar",
            sentence: '"Alice felt a very <b>peculiar</b> change in her size."',
            options: [
                "A. Strange or odd",
                "B. Common and boring",
                "C. Sudden and fast"
            ],
            answer: 0,
            image: "./rune_peculiar.png"
        },
        {
            word: "Vanish",
            sentence: '"The cat began to <b>vanish</b> slowly, starting with its tail."',
            options: [
                "A. To appear suddenly",
                "B. To disappear completely",
                "C. To become brighter"
            ],
            answer: 1,
            image: "./rune_vanish.png"
        }
    ],

    loadVocab(index) {
        if (index >= this.vocabList.length) return;
        const data = this.vocabList[index];

        // Update Title and Sentence
        const titleEl = document.getElementById("vocab-word");
        if (titleEl) titleEl.textContent = data.word;

        // Update Image
        const imgPlaceholder = document.querySelector(".word-image-placeholder");
        if (imgPlaceholder) {
            imgPlaceholder.innerHTML = ""; // Clear text
            if (data.image) {
                const img = document.createElement("img");
                img.src = data.image;
                img.alt = data.word;
                img.style.maxWidth = "100%";
                img.style.maxHeight = "100%";
                img.style.objectFit = "contain";
                img.style.filter = "drop-shadow(0 0 10px rgba(255, 215, 0, 0.5))";
                img.onerror = () => {
                    img.style.display = "none";
                    let icon = "📜";
                    // Fallback Icons based on word context
                    if (data.word === "Luminous") icon = "✨";
                    if (data.word === "Peculiar") icon = "🎩";
                    if (data.word === "Vanish") icon = "💨";

                    imgPlaceholder.style.display = "flex";
                    imgPlaceholder.style.justifyContent = "center";
                    imgPlaceholder.style.alignItems = "center";
                    imgPlaceholder.innerHTML = `<div style="font-size: 80px; text-shadow: 0 0 20px rgba(255,215,0,0.5); animation: float 3s infinite ease-in-out;">${icon}</div>`;
                };
                imgPlaceholder.appendChild(img);
            } else {
                imgPlaceholder.textContent = "[Magic Image Placeholder]";
            }
        }

        // Find the sentence paragraph - assuming it's the <p> after title
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
                btn.onclick = (e) => Game.checkVocab(idx, e); // Pass event for coordinates
                optionsDiv.appendChild(btn);
            });
        }
    },

    async checkVocab(optionIndex, event) {
        // Prevent re-entry if already processing (simple lock)
        if (this.isProcessingVocab) return;
        this.isProcessingVocab = true;

        const currentIndex = this.state.vocabIndex || 0;
        const currentData = this.vocabList[currentIndex];
        // Use 'answer' property as per data structure
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
                this.spawnFloatingText(selectedBtn, "+10 Runes!", "bonus");

                // Trigger Rune Particle Animation
                const rect = selectedBtn.getBoundingClientRect();
                const startX = event ? event.clientX : (rect.left + rect.width / 2);
                const startY = event ? event.clientY : (rect.top + rect.height / 2);
                this.spawnRuneParticles(startX, startY);
            }

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
            this.addRunes(-5); // -5 Rune (Penalty Reduced)
            if (selectedBtn) {
                selectedBtn.classList.add("wrong");
                this.spawnFloatingText(selectedBtn, "-5 Rune", "error");
            }

            // Allow Retry? Or Move On?
            // "맞든 틀리든 1회로 끝나야 한다" -> Move on anyway?
            // Usually games let you retry or just mark wrong and move on.
            // Let's implement: Re-enable others so they can find the right one (Learning), 
            // BUT penalty applied. 
            // If strictly "1 attempt", we should move on.
            // User requirement ambiguity: "1회로 끝나야 한다" -> likely implies "processing done in one go".
            // Let's keep retry logic for now as it's better for learning.
            btns.forEach((btn, idx) => {
                if (idx !== optionIndex) btn.disabled = false;
            });

            this.isProcessingVocab = false; // Release lock
        }
    },

    // --- NEW: Rune Particle Animation (Curve to HUD) ---
    spawnRuneParticles(startX, startY) {
        const targetEl = document.getElementById("rune-count"); // HUD Rune Icon
        if (!targetEl) return;

        const targetRect = targetEl.getBoundingClientRect();
        // Target center coordinates
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        const particleCount = 12; // Increased from 6
        const colors = ["#ffd700", "#ffae00", "#ffffff", "#e0ffff"]; // Gold, Orange, White, Cyan Tint

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement("div");
            p.className = "rune-particle";

            // Random size for variety
            const size = 5 + Math.random() * 8;
            p.style.width = size + "px";
            p.style.height = size + "px";
            p.style.borderRadius = "50%";
            p.style.position = "fixed";
            p.style.zIndex = "10000";

            // Initial Position (Fixed to start point)
            p.style.left = startX + "px";
            p.style.top = startY + "px";

            const color = colors[Math.floor(Math.random() * colors.length)];
            p.style.backgroundColor = color;
            p.style.boxShadow = "0 0 10px " + color;

            // Bezier Control Point (Random curve direction)
            // Midpoint between start and target
            const midX = (startX + targetX) / 2;
            const midY = (startY + targetY) / 2;
            // Offset for curve
            const curveStrength = 150 + Math.random() * 200; // Strong curve
            const curveAngle = Math.random() * Math.PI * 2;
            const cpX = midX + Math.cos(curveAngle) * curveStrength;
            const cpY = midY + Math.sin(curveAngle) * curveStrength;

            // Generate Keyframes for Bezier Curve
            const keyframes = [];
            const steps = 30; // Smoothness
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                // Quadratic Bezier Formula: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                const xx = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * targetX;
                const yy = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * targetY;

                // Scale & Opacity Logic for Impact
                let scale = 1;
                let opacity = 1;

                // 1. Burst Start (t: 0 -> 0.2)
                if (t < 0.2) {
                    scale = 0.5 + (t * 5); // 0.5 -> 1.5 (Pop out)
                }
                // 2. Flight (t: 0.2 -> 0.8)
                else if (t < 0.8) {
                    scale = 1.5 - ((t - 0.2) * 0.5); // 1.5 -> 1.2 (Slight shrink)
                }
                // 3. Arrival Impact (t: 0.8 -> 1.0)
                else {
                    // Do NOT fade out. Accelerate into target.
                    scale = 1.2 - ((t - 0.8) * 4); // 1.2 -> 0.4 (Collapse into icon)
                    opacity = 1; // Keep fully visible until impact
                }

                // Append to keyframes
                keyframes.push({
                    left: `${xx}px`,
                    top: `${yy}px`,
                    transform: `scale(${scale})`,
                    opacity: opacity,
                    offset: t
                });
            }

            document.body.appendChild(p);

            // Animation: Bezier Curve
            const duration = 1200 + Math.random() * 600;

            const anim = p.animate(keyframes, {
                duration: duration,
                easing: "linear", // Keyframes handle easing via spacing if needed, but linear t allows consistent curve
                fill: "forwards"
            });

            anim.onfinish = () => {
                p.remove();
                // Pump Effect on Target (Trigger on first few for impact)
                if (i === 0) {
                    // Add Score HERE (On Arrival)
                    this.addRunes(10);
                    targetEl.style.transition = "transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
                    targetEl.style.transform = "scale(1.8)";
                    targetEl.style.filter = "brightness(2.5) drop-shadow(0 0 20px gold)";

                    // Reset quickly
                    setTimeout(() => {
                        targetEl.style.transform = "scale(1)";
                        targetEl.style.filter = "brightness(1)";
                    }, 200);
                }
            };
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

    // --- [NEW] Flying Resource Effect (Passage 123 Style) ---
    spawnFlyingResource(startX, startY, amount, type = 'gem') {
        const targetId = type === 'ink' ? 'ink-count' : 'gem-count';
        const targetEl = document.getElementById(targetId);
        if (!targetEl) return;

        const targetRect = (targetEl.parentElement || targetEl).getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        // CP Control Point (Arc Upwards)
        const cpX = startX + (Math.random() * 100 - 50);
        const cpY = Math.min(startY, targetY) - 150;

        // Create Element
        const p = document.createElement('div');
        p.className = 'flying-resource';
        p.innerText = `+${amount}`;
        p.style.position = 'fixed';
        p.style.left = startX + 'px';
        p.style.top = startY + 'px';
        p.style.color = type === 'ink' ? '#00ffff' : '#ffd700'; // Cyan or Gold
        p.style.fontWeight = 'bold';
        p.style.fontSize = '24px';
        p.style.pointerEvents = 'none';
        p.style.zIndex = '1000001';
        p.style.transform = 'translate(-50%, -50%) scale(1)';
        p.style.textShadow = `0 0 10px ${p.style.color}`;
        p.style.transition = 'opacity 0.2s';

        document.body.appendChild(p);

        // Animation Loop (Quadratic Bezier)
        let startTime = null;
        const duration = 1000;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = (timestamp - startTime) / duration;

            if (progress >= 1) {
                if (p.parentNode) p.remove();

                // Add Score & Pulse HUD
                if (type === 'gem') this.addGems(amount);
                else if (type === 'ink') this.addInk(amount);

                // Pulse UI
                const hudIcon = targetEl.parentElement || targetEl;
                hudIcon.style.transition = "transform 0.1s";
                hudIcon.style.transform = "scale(1.5)";
                hudIcon.style.filter = "brightness(2)";
                setTimeout(() => {
                    hudIcon.style.transform = "scale(1)";
                    hudIcon.style.filter = "brightness(1)";
                }, 200);
                return;
            }

            // Ease-In-Out
            const t = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const invT = 1 - t;

            // Bezier
            const currentX = (invT * invT * startX) + (2 * invT * t * cpX) + (t * t * targetX);
            const currentY = (invT * invT * startY) + (2 * invT * t * cpY) + (t * t * targetY);

            p.style.left = currentX + 'px';
            p.style.top = currentY + 'px';
            p.style.transform = `translate(-50%, -50%) scale(${1 + Math.sin(progress * Math.PI) * 0.5})`;

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    },

    // --- 1.2 WPM Selection ---
    selectWPM(wpm, btnElement) {
        // UI Reset
        const buttons = document.querySelectorAll('.wpm-btn');
        buttons.forEach(btn => {
            btn.classList.remove('selected');
            btn.style.borderColor = btn.style.borderColor.replace('1)', '0.3)');
            btn.style.boxShadow = 'none';
            btn.style.transform = 'scale(1)';
        });

        // UI Select
        if (btnElement) {
            btnElement.classList.add('selected');
            btnElement.style.borderColor = btnElement.style.borderColor.replace('0.3', '1');
            btnElement.style.boxShadow = `0 0 20px ${window.getComputedStyle(btnElement).color}`;
            btnElement.style.transform = 'scale(1.05)';
        }

        this.wpm = wpm;

        // --- CORE LOGIC: Sync with WPM Preview ---
        // 1. Target Chunk Size
        let targetChunkSize = 4;
        if (wpm <= 100) targetChunkSize = 3;
        if (wpm >= 300) targetChunkSize = 6;
        Game.targetChunkSize = targetChunkSize;

        // 2. Calibrated Pause Time
        let pauseMultiplier = 1.0;
        if (wpm <= 100) pauseMultiplier = 1.4;
        if (wpm === 200) pauseMultiplier = 1.5;
        if (wpm >= 300) pauseMultiplier = 1.0;

        const baseDelay = Math.floor(10000 / wpm);
        const calibratedPause = Math.max(200, (baseDelay * 8) * pauseMultiplier);

        this.targetSpeed = baseDelay;
        this.targetChunkDelay = calibratedPause;

        console.log(`[Game] WPM Selected: ${wpm}`);
        console.log(`[Game Logic] Target Chunk Size: ${targetChunkSize}, Pause: ${Math.round(calibratedPause)}ms`);

        // Wait a bit then proceed
        setTimeout(async () => {
            // Check SDK Status (Optional guard)
            if (this.state.sdkLoading && !this.state.sdkLoading.isReady) {
                console.log("SDK not ready, showing modal...");
                const modal = document.getElementById("sdk-loading-modal");
                if (modal) modal.style.display = "flex";
                // Retry logic could go here but let's assume it catches up or user waits
                // Ideally we pause here. For now let's proceed to calibration screen which usually handles it.
            }

            // Ensure Tracking Init
            if (this.trackingInitPromise) {
                const ok = await this.trackingInitPromise;
            }

            this.switchScreen("screen-calibration");
            setTimeout(() => {
                if (typeof window.startCalibrationRoutine === "function") {
                    window.startCalibrationRoutine();
                } else {
                    this.switchScreen("screen-read");
                }
            }, 500);

        }, 500);
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

        // [FIX] Clean up Reading Screen Artifacts
        // 1. Hide Pang Markers (Clear Layer)
        const pangLayer = document.getElementById("pang-marker-layer");
        if (pangLayer) pangLayer.innerHTML = "";

        // 2. Hide Reading Content (Prevent Flash/Ghosting on next load)
        // By clearing this now, we ensure the next paragraph starts fresh without old text visible.
        const bookContent = document.getElementById("book-content");
        if (bookContent) bookContent.innerHTML = "";

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
    },

    // --- NEW: Enriched Game Flow (Debug / Implementation) ---
    debugFinalVillain() {
        console.log("Debug: Starting Final Villain Sequence");
        if (this.typewriter && typeof this.typewriter.triggerFinalBossBattle === "function") {
            this.typewriter.triggerFinalBossBattle();
        } else {
            console.error("Game.typewriter.triggerFinalBossBattle is missing!");
            this.switchScreen("screen-final-boss"); // Fallback
        }
    },

    goToNewScore() {
        this.switchScreen("screen-new-score");

        // Animated Count Up for Stats
        // 1. WPM
        let wpmVal = Math.round(this.state.wpmDisplay || 180);
        if (wpmVal < 50) wpmVal = 150 + Math.floor(Math.random() * 100); // Fallback for debug
        this.animateValue("report-wpm", 0, wpmVal, 1500);

        // 2. Accuracy (Mock based on missing lines?)
        const accVal = 88 + Math.floor(Math.random() * 11); // 88-99%
        this.animateValue("report-acc", 0, accVal, 1500, "%");
    },

    goToNewSignup() {
        this.switchScreen("screen-new-signup");
    },

    goToNewShare() {
        // Simulate Signup submission if coming from Signup screen
        const emailInput = document.querySelector("#screen-new-signup input[type='email']");
        if (emailInput && emailInput.value) {
            console.log("Signup Email:", emailInput.value);
            // Optionally show toast
        }
        this.switchScreen("screen-new-share");
    },

    // Utilities
    animateValue(id, start, end, duration, suffix = "") {
        const obj = document.getElementById(id);
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Ease-out effect
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            obj.innerHTML = Math.floor(easeProgress * (end - start) + start) + suffix;
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
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
        // [SAFETY FIX] Reset Scroll Position to (0,0) BEFORE rendering new content.
        // This prevents lingering scroll from previous paragraphs from affecting lockLayout coordinates.
        window.scrollTo(0, 0);
        const screenRead = document.getElementById('screen-read');
        if (screenRead) screenRead.scrollTop = 0;

        // [CRITICAL FIX] Reset Pang Event Logic / First Content Time for new paragraph
        console.log(`[Typewriter] Pre-Check: Resetting Triggers for Para ${this.currentParaIndex}...`);

        const gdm = window.gazeDataManager;
        if (gdm) {
            // Function Call (Preferred)
            if (typeof gdm.resetTriggers === 'function') {
                gdm.resetTriggers();
            } else {
                // FALLBACK: Manual Reset (If function missing in cached JS)
                console.warn("[Typewriter] resetTriggers function missing! Performing Manual Reset.");
                gdm.maxLineIndexReached = -1;
                gdm.firstContentTime = null;
                gdm.lastTriggerTime = 0;
                gdm.pendingReturnSweep = null;
                if (gdm.pangLog) gdm.pangLog = [];
            }
            console.log("[Typewriter] Triggers Reset Check Complete.");
        }

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

            // [CRITICAL FIX] Re-enable Tracking!
            // Tracking is disabled in 'confrontVillain' (Mid-Boss).
            // We must re-enable it here for the next paragraph.
            Game.state.isTracking = true;
            console.log("[Typewriter] Tracking Re-enabled for new paragraph.");

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
            // Logic: P1 -> Replay -> Mid -> P2 -> Replay -> Mid -> ...
            setTimeout(async () => {
                // Play Gaze Replay before Villain appears
                await this.triggerGazeReplay();
                this.triggerMidBossBattle();
            }, 1000); // 1s initial delay
        }
    },

    // --- NEW: Gaze Replay ---
    triggerGazeReplay() {
        return new Promise((resolve) => {
            console.log("[triggerGazeReplay] Preparing Gaze Replay...");

            // Check dependencies
            if (!window.gazeDataManager || !this.startTime) {
                console.warn("No GazeDataManager or StartTime found. Skipping Replay.");
                resolve();
                return;
            }

            const gdm = window.gazeDataManager;
            // [FIX] Convert Absolute Time to Relative Time (GazeDataManager stores relative 't')
            if (!gdm.firstTimestamp) {
                console.warn("[Replay] GazeDataManager has no firstTimestamp. Skipping.");
                resolve();
                return;
            }

            const relativeStartTime = this.startTime - gdm.firstTimestamp;
            const relativeEndTime = Date.now() - gdm.firstTimestamp;

            console.log(`[Replay] Filtering Data: Range [${relativeStartTime.toFixed(0)} ~ ${relativeEndTime.toFixed(0)}] ms`);

            const rawData = gdm.data;
            const sessionData = rawData.filter(d => d.t >= relativeStartTime && d.t <= relativeEndTime);

            if (sessionData.length === 0) {
                console.warn(`[Replay] No gaze data found in range. Total Data: ${rawData.length}, Range: ${relativeStartTime.toFixed(0)}-${relativeEndTime.toFixed(0)}`);
                resolve();
                return;
            }

            console.log(`[Replay] Found ${sessionData.length} points.`);

            // Hide Cursor during replay for cleaner view
            if (this.renderer && this.renderer.cursor) this.renderer.cursor.style.opacity = "0";

            if (this.renderer && typeof this.renderer.playGazeReplay === 'function') {
                this.renderer.playGazeReplay(sessionData, () => {
                    console.log("[triggerGazeReplay] Replay Done.");
                    // Restore cursor opacity just in case (though screen switch follows)
                    if (this.renderer.cursor) this.renderer.cursor.style.opacity = "1";
                    resolve();
                });
            } else {
                console.warn("Renderer does not support playGazeReplay.");
                resolve();
            }
        });
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

        // 1. Hit Test (Visual Feedback Only)
        // Used only to highlight words, NOT to change the Line Index context.
        const hit = this.renderer.hitTest(x, y);

        // 2. Define Content Context (Ground Truth)
        // [CORRECTED PRINCIPLE] Line Index counts up automatically as text appears.
        // It is INDEPENDENT of gaze.
        const contentLineIndex = (typeof this.renderer.currentVisibleLineIndex === 'number')
            ? this.renderer.currentVisibleLineIndex
            : 0;

        let contentTargetY = null;

        // Find the Y coordinate of the *Current Text Line* (Context)
        if (this.renderer.lines && this.renderer.lines[contentLineIndex]) {
            contentTargetY = this.renderer.lines[contentLineIndex].visualY;
        }

        // 3. Return Sweep Logic is handled entirely by GazeDataManager's internal processGaze loop.
        // We only provide the context.

        // 4. Sync Context to Data Manager
        if (window.gazeDataManager) {
            const ctx = {
                lineIndex: contentLineIndex, // Strictly Typewriter-driven
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
            // logic moved to flying resource callback
            // Game.addGems(10); 

            // Trigger Visuals
            const btn = document.querySelectorAll("#boss-options button")[optionIndex];
            if (btn && typeof Game.spawnFlyingResource === 'function') {
                const rect = btn.getBoundingClientRect();
                Game.spawnFlyingResource(rect.left + rect.width / 2, rect.top + rect.height / 2, 10, 'gem');
            } else {
                Game.addGems(10); // Fallback
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
            // alert("ARCH-VILLAIN DEFEATED! The Rift is sealed forever."); // Removed per request
            Game.addGems(30); // +30 Gem (Final Boss)

            // Animation
            const villainImg = document.querySelector("#screen-final-boss .villain-img");
            if (villainImg) {
                villainImg.classList.add("villain-defeated");
            }
            if (typeof Game.spawnFloatingText === "function") {
                Game.spawnFloatingText(document.querySelector("#screen-final-boss h3"), "RIFT SEALED!", "bonus");
            }

            // Delay and Switch to New Sequence (Final Villain Screen -> Score -> etc)
            setTimeout(() => {
                Game.goToNewScore();
            }, 2500);

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


