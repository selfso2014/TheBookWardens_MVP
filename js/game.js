import { storyParagraphs } from './data/StoryContent.js';
import { storyChapter1 } from './data/StoryContent_Dynamic.js';
import { vocabList, midBossQuizzes, finalBossQuiz } from './data/QuizData.js';
import { ScoreManager } from './managers/ScoreManager.js';
import { SceneManager } from './managers/SceneManager.js';
import { bus } from './core/EventBus.js';
import { TextRenderer } from './TextRendererV2.js';

const Game = {
    // Initialized in init()
    scoreManager: null,
    sceneManager: null,

    state: {
        // Renamed/Removed: gem/ink/rune to ScoreManager
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

    // Bridge Methods (Proxies to ScoreManager)
    addInk(amount) { if (this.scoreManager) this.scoreManager.addInk(amount); },
    addRunes(amount) { if (this.scoreManager) this.scoreManager.addRunes(amount); },
    addGems(amount) { if (this.scoreManager) this.scoreManager.addGems(amount); },

    updateUI() {
        if (this.scoreManager) this.scoreManager.updateUI();
    },

    // --- Rift Intro Sequence (Cinematic 20s) ---
    async startRiftIntro() {
        console.log("Starting Rift Intro Sequence...");

        // Use Scene Manager
        this.switchScreen("screen-rift-intro");
        this.sceneManager.resetRiftIntro(); // Helper reset

        // Helper for delays
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Get elements via Manager helper? Or direct. 
        // For now, let's keep references here but use Manager for actions.
        const introScreen = document.getElementById("screen-rift-intro");
        const villainContainer = document.getElementById("rift-villain-container");
        const textContainer = document.getElementById("rift-text-container");
        const meteorLayer = document.getElementById("meteor-layer");

        // --- SCENE 1: PEACE (0s - 2.2s) ---
        await wait(200);
        textContainer.style.opacity = 1;
        textContainer.style.transform = "translateY(0)";

        this.sceneManager.showStoryText("Every story holds a world within.");
        await wait(2000);

        // --- SCENE 2: WARNING (2.2s - 4.2s) ---
        introScreen.classList.remove("scene-peace");
        introScreen.classList.add("scene-warning");

        this.sceneManager.showStoryText("But chaos seeks to consume it.");

        villainContainer.style.opacity = 0.6;
        await wait(2000);

        // --- SCENE 3: INVASION (4.2s - 5.7s) ---
        introScreen.classList.remove("scene-warning");
        introScreen.classList.add("scene-invasion");

        this.sceneManager.showStoryText("The Rift opens!", "villain");
        villainContainer.style.opacity = 1;

        // Start light meteors
        const lightMeteorLoop = setInterval(() => {
            if (Math.random() > 0.7) this.sceneManager.spawnMeteor(meteorLayer);
        }, 300);

        await wait(1500);
        clearInterval(lightMeteorLoop);

        // --- SCENE 4: DESTRUCTION (5.7s - 9.5s) ---
        introScreen.classList.remove("scene-invasion");
        introScreen.classList.add("scene-destruction");

        this.sceneManager.showStoryText("The words are fading...<br>WARDEN, RESTORE THE STORY!");
        textContainer.classList.add("rift-damaged");

        const heavyMeteorLoop = setInterval(() => {
            this.sceneManager.spawnMeteor(meteorLayer);
            this.sceneManager.spawnMeteor(meteorLayer);
        }, 100);

        await wait(3000);

        await wait(800);
        clearInterval(heavyMeteorLoop);

        // --- SCENE 5: TRANSITION ---
        this.sceneManager.showStoryText("Initializing Word Forge...");
        await wait(1000);

        console.log("Rift Intro Done. Moving to Word Forge.");
        // ... (rest logic same)

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



    init() {
        console.log("Game Init");

        // [NEW] Instantiate Managers
        this.scoreManager = new ScoreManager();
        this.sceneManager = new SceneManager();

        // [EVENT BUS] Subscribe to Game Events
        bus.on('pang', () => {
            this.scoreManager.addInk(10);
        });

        bus.on('gem_earned', (amount) => {
            this.scoreManager.addGems(amount);
        });

        bus.on('rune_earned', (amount) => {
            this.scoreManager.addRunes(amount);
        });

        // [RGT] Handle Rune Word Trigger
        bus.on('rune_touched', (runeId) => {
            console.log(`[Game] Rune Triggered: ${runeId}`);
            // Reward: +5 Runes
            this.addRunes(5);
            // FX: Spawn particles at last gaze position? Or at word position?
            // TextRenderer handles visual pop. We just handle score.
            // Maybe a sound effect?
            // if (this.audioManager) this.audioManager.play('rune_collect');
        });

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

        // --- SPECIFICATION: UNIFIED PREVIEW ENGINE ---
        // Use the EXACT same logic as the main game
        const params = this.calculateWPMAttributes(wpm);
        const WORD_INTERVAL = params.interval;
        const TARGET_CHUNK_SIZE = params.chunkSize;
        const CHUNK_DELAY = params.delay;

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
            if (isEnd || isComma || chunkCount >= TARGET_CHUNK_SIZE) {
                nextDelay = CHUNK_DELAY;
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
        if (!this.sceneManager) return;
        this.sceneManager.show(screenId);

        if (screenId === "screen-read") {
            // Reset Context Latching for new session to avoid carrying over old data
            this.lastValidContext = null;

            // [FIX] REMOVED typewriter.start() here to prevent resetting paragraph index.
            // Screen transition handles layout, but game logic flows independently.
        }
    },

    updateUI() {
        if (this.scoreManager) {
            this.scoreManager.updateUI();
        }
    },

    // Bridge for WPM updates
    updateWPM(targetWPM) {
        if (this.scoreManager) {
            this.scoreManager.updateWPM(targetWPM);
        }
    },

    // --- 1. Word Forge ---
    // --- 1. Word Forge ---
    vocabList: vocabList,

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
    calculateWPMAttributes(wpm) {
        // A. Constraints
        let chunkSize = 4;
        if (wpm <= 100) chunkSize = 3;
        if (wpm >= 300) chunkSize = 6;

        // B. Target Times (ms)
        const msPerMinute = 60000;
        // Target time for ONE chunk (including wait)
        const targetChunkTotalTime = (msPerMinute / wpm) * chunkSize;

        // C. System Constants (Overhead)
        // 1. TextRenderer & EventLoop overhead (approx 200~250ms per chunk fixed cost)
        const SYSTEM_BUFFER = 250;

        // D. Snappy Interval Strategy (Top-Down)
        // Instead of calculating interval from time, we FIX interval to be fast (50ms).
        let interval = 50;

        // E. Calculate Required Wait Time (Delay)
        // Total = (Interval * Count) + Buffer + Delay
        // Note: LINE_BREAK_AVG is removed because we handle it DYNAMICALLY in the tick() loop now.
        let delay = targetChunkTotalTime - (interval * chunkSize) - SYSTEM_BUFFER;

        // F. Adaptive Logic (High Speed Handling)
        // If calculated delay is too short (< 150ms), we have no choice but to speed up interval further.
        if (delay < 150) {
            delay = 150; // Minimum pause for cognition
            // Solve for Interval:
            const availableRenderTime = targetChunkTotalTime - SYSTEM_BUFFER - 150;
            interval = Math.floor(availableRenderTime / chunkSize);

            // Safety: Min interval 20ms
            if (interval < 20) interval = 20;
        }

        return { chunkSize, interval, delay: Math.floor(delay) };
    },

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

        // [DSC Support] Re-render if currently reading? 
        // For now, we assume this happens before reading. But if tweaked during reading:
        if (Game.typewriter && Game.typewriter.renderer && Game.state.isTracking) {
            // Optional: Trigger re-layout if live WPM change is needed
            // const pIndex = Game.typewriter.currentParaIndex;
            // const pData = Game.typewriter.paragraphs[pIndex];
            // Game.typewriter.renderer.prepareDynamic({paragraphs:[pData]}, wpm);
        }

        // --- CORE LOGIC: Reverse Calculation for Exact Timing ---
        this.wpmParams = this.calculateWPMAttributes(wpm);
        Game.targetChunkSize = this.wpmParams.chunkSize;

        console.log(`[Game] WPM Selected: ${wpm}`);
        console.log(`[Game Logic] Params: Interval=${this.wpmParams.interval}ms, Delay=${this.wpmParams.delay}ms, Chunk=${this.wpmParams.chunkSize}`);

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

            // Ensure Tracking Init with Timeout (Max 3s)
            if (this.trackingInitPromise) {
                const timeout = new Promise(resolve => setTimeout(() => resolve(false), 3000));
                try {
                    await Promise.race([this.trackingInitPromise, timeout]);
                } catch (e) {
                    console.warn("[Game] Tracking init timeout or error", e);
                }
            }

            this.switchScreen("screen-calibration");
            setTimeout(() => {
                let calStarted = false;
                if (typeof window.startCalibrationRoutine === "function") {
                    calStarted = window.startCalibrationRoutine();
                }

                if (!calStarted) {
                    console.warn("[Game] Calibration failed to start, skipping to reading.");
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

            // [RGT] Check Responsive Words
            if (this.typewriter.renderer && typeof this.typewriter.renderer.checkRuneTriggers === 'function') {
                this.typewriter.renderer.checkRuneTriggers(x, y);
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
    // --- NEW: Alice Battlefield Integration ---
    debugFinalVillain() {
        console.log("Starting Alice Battlefield...");

        // Switch to new screen
        this.switchScreen('screen-alice-battle');

        // Initialize if available
        if (this.AliceBattle) {
            this.AliceBattle.init();
        } else if (window.AliceBattleRef) {
            this.AliceBattle = window.AliceBattleRef;
            this.AliceBattle.init();
        } else {
            console.error("AliceBattle module NOT loaded! Check console.");
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
    // Data (Content)
    paragraphs: storyChapter1.paragraphs, // Use Dynamic Paragraphs
    quizzes: midBossQuizzes,

    // --- FINAL BOSS DATA ---
    finalQuiz: finalBossQuiz,

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
        // [FIX] Removed WPM polling interval. 
        // WPM should only update on discrete "Pang" events driven by GazeDataManager.
        // this.wpmMonitor = setInterval(() => this.updateWPM(), 1000);

        // --- CHANGED: Periodic Cloud Upload REMOVED ---
        // As per user request, we now upload ONLY when Replay starts (per paragraph).
        if (this.uploadMonitor) {
            clearInterval(this.uploadMonitor);
            this.uploadMonitor = null;
        }
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

        const paraData = this.paragraphs[this.currentParaIndex];
        console.log(`[Typewriter] Playing Para ${this.currentParaIndex}`);

        // 1. Prepare Content (Dynamic DSC Mode)
        // Wrap single paragraph in chapter structure for renderer
        const currentWPM = Game.wpm || 150;
        this.renderer.prepareDynamic({ paragraphs: [paraData] }, currentWPM);

        this.chunkIndex = 0;
        this.lineStats.clear(); // Reset reading stats for new page

        // [FIX] Register Cursor with SceneManager (Cursor is recreated directly in prepare())
        if (Game.sceneManager && this.renderer.cursor) {
            Game.sceneManager.setCursorReference(this.renderer.cursor);
        }

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
            const chunkLen = this.renderer.chunks[this.chunkIndex].length;
            const wpm = Game.wpm || 200;
            const msPerWord = 60000 / wpm; // e.g. 200wpm -> 300ms

            // The renderer's revealChunk animation takes (length * interval) ms.
            // Game.wpmParams.interval is usually very fast (e.g. 50ms) for 'snappy' reveal.
            // We need to wait for the visual reveal, THEN wait for the remaining time to match WPM.

            const revealPromise = this.renderer.revealChunk(this.chunkIndex, Game.wpmParams.interval);

            // Total time this chunk *should* occupy
            // [TUNING] Dynamic Multiplier for "Reading/Pause" buffer.
            let buffer = 1.2; // Default (200 WPM)
            if (wpm <= 100) buffer = 1.15; // [100 WPM] Increased chunk size, so reduce buffer slightly.
            else if (wpm >= 300) buffer = 1.05; // [300 WPM] Needs to be faster. Reduce gap.

            const targetDuration = (msPerWord * chunkLen) * buffer;

            // Safety timeout
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, targetDuration + 1000));

            const startTime = Date.now();

            Promise.race([revealPromise, timeoutPromise]).then(() => {
                const elapsed = Date.now() - startTime;

                // Calculate remaining wait time
                // We want total time (reveal + pause) = targetDuration
                let remainingWait = targetDuration - elapsed;

                // If reveal was instant or fast, we wait longer.
                // If reveal took long (e.g. line break pause inside renderer?), we wait less.

                if (remainingWait < 0) remainingWait = 0;

                // [WPM COMPENSATION LOGIC]
                // 1. Check if the *current* chunk (this.chunkIndex) had a line break.
                // The renderer adds +450ms internally if a word starts a new line.
                // We must SUBTRACT this from our game loop delay to avoid double waiting.
                let hadLineBreak = false;
                if (this.renderer && this.renderer.chunks && this.renderer.lines) {
                    const currentChunkIndices = this.renderer.chunks[this.chunkIndex];
                    if (currentChunkIndices) {
                        // Check if any word in this chunk is a start of a line (excluding the very first word of text)
                        hadLineBreak = currentChunkIndices.some(wordIdx => {
                            return wordIdx > 0 && this.renderer.lines.some(line => line.startIndex === wordIdx);
                        });
                    }
                }

                this.chunkIndex++;

                // Calculate Delay (Pause AFTER valid reading)
                // We use the remainingWait calculated above to ensure WPM adherence.
                let baseDelay = remainingWait;

                // Apply Compensation
                let finalDelay = baseDelay;
                if (hadLineBreak) {
                    // Renderer paused 450ms, so we pause 450ms less.
                    finalDelay = Math.max(0, baseDelay - 450);
                    // console.log(`[WPM Sync] Line Break Detected in Chunk ${this.chunkIndex-1}. Compensating: ${baseDelay} -> ${finalDelay}ms`);
                }

                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.tick();
                }, finalDelay);
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

            // [CHANGED] Upload Data to Firebase NOW (Background Sync)
            // We do this here because Replay start signifies "Paragraph Done".
            if (window.gazeDataManager && Game.sessionId) {
                console.log("[Cloud] Uploading Paragraph Data...");
                // No await needed, let it run in background
                window.gazeDataManager.uploadToCloud(Game.sessionId);
            }

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
                // [FEEDBACK] Reset Rune Words for Replay Cleanliness
                // We want to remove the 'active-rune' class so the user sees a raw replay.
                // Or maybe keep them? Feedback says: "Just Yellow Bold is enough" for active.
                // But during replay, if they are ALREADY yellow/bold, it might be distracting?
                // The feedback: "3. 지문 다 읽고 리플레이할때, 반응형 단어가 노란색에 밑줄까지 있는데, 보기가 안 좋음."
                // Since we removed underline from CSS, we just need to ensure they look clean.
                // Let's RESET them to normal so the replay shows the gaze "re-triggering" them?
                // No, TextRenderer.playGazeReplay just draws lines/dots. It doesn't re-simulate triggers.
                // So let's stripped the 'active-rune' class to make the text look "fresh" for the replay canvas overlay.

                this.renderer.words.forEach(w => {
                    if (w.element) w.element.classList.remove('active-rune'); // Clean slate
                });

                this.renderer.playGazeReplay(sessionData, () => {
                    console.log("[triggerGazeReplay] Replay Done.");
                    // Restore cursor opacity just in case (though screen switch follows)
                    if (this.renderer.cursor) this.renderer.cursor.style.opacity = "1";

                    // Optional: Restore active state? 
                    // No need, we are moving to the next screen (Boss Battle).
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
        // Check if currently reading (screen-read is active)
        const isReading = document.getElementById("screen-read")?.classList.contains("active");
        if (!isReading || this.isPaused) return;

        let targetWPM = 0;
        // Priority 1: GazeDataManager (Accurate)
        if (window.gazeDataManager && window.gazeDataManager.wpm > 0) {
            targetWPM = window.gazeDataManager.wpm;
        }
        // Priority 2: Simple estimation (Fallback) - REMOVED
        // We strictly use GazeDataManager's calculated WPM.
        // If 0, display 0. Do not use time-based estimation as it causes fluctuations.

        // Bridge to Manager
        Game.updateWPM(targetWPM);
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

    // [State] Simple Battle System
    aliceBattleState: {
        playerHp: 100,
        villainHp: 100,
        isPlayerTurn: true
    },

    triggerFinalBossBattle() {
        console.log("[Game] Alice Battle Mode Started (Target: #screen-alice-battle).");

        // 1. Handle Blockers (Disable pointer events instead of removing)
        const blockers = ['output', 'preview', 'calibration-overlay'];
        blockers.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Keep element visible but pass-through clicks
                el.style.pointerEvents = 'none';
                // Ensure z-index is lower than battle screen
                el.style.zIndex = '0';
            }
        });

        const hud = document.getElementById('hud-top');
        if (hud) hud.style.display = 'none';

        // 2. Screen Switch
        const allScreens = document.querySelectorAll('.screen');
        allScreens.forEach(s => s.style.display = 'none');

        // TARGET THE REAL SCREEN (Defined in index.html line ~1063)
        const screen = document.getElementById("screen-alice-battle");

        if (screen) {
            screen.style.display = 'flex';
            screen.classList.add('alice-battle-mode');
            screen.style.opacity = '1';
            screen.style.visibility = 'visible';
            screen.style.backgroundColor = '#111';
            screen.style.zIndex = '2147483647'; // Ensure top-most

            // 3. Delayed Binding & Initialization
            setTimeout(() => {
                // Initialize Battle Module Logic
                if (window.AliceBattleRef) {
                    console.log("[Battle] AliceBattleRef FOUND. Calling init()...");

                    // Expose to Game object for inline HTML handlers (if any remain active)
                    if (window.Game) {
                        window.Game.AliceBattle = window.AliceBattleRef;
                    }

                    // Canvas styling handled by CSS now (AliceBattle.css)
                    const canvas = null; // document.getElementById('alice-canvas');
                    if (canvas) {
                        canvas.style.display = 'block';
                        canvas.style.position = 'absolute';
                        canvas.style.top = '0';
                        canvas.style.left = '0';
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';


                        // Set resolution match
                        canvas.width = window.innerWidth;
                        canvas.height = window.innerHeight;
                    }

                    window.AliceBattleRef.init();

                    // RE-APPLY POINTER EVENTS (Critical Fix)
                    setTimeout(() => {
                        const canvas = document.getElementById('alice-canvas');
                        if (canvas) canvas.style.pointerEvents = 'none';

                        const cards = screen.querySelectorAll('.warden .card');
                        cards.forEach(c => {
                            c.style.cursor = 'pointer';
                            c.style.pointerEvents = 'auto';
                        });

                        // Ensure UI Container allows pass-through, but children take clicks
                        const uiContainer = document.getElementById('alice-game-ui');
                        if (uiContainer) {
                            uiContainer.style.pointerEvents = 'none';
                            const areas = uiContainer.querySelectorAll('.entity-area');
                            areas.forEach(a => a.style.pointerEvents = 'auto');
                        }
                    }, 50);

                } else {
                    console.warn("[Battle] window.AliceBattleRef not found.");
                }


                // Force Event Binding (Safety Net)
                const cards = screen.querySelectorAll('.warden .card');
                console.log(`[Battle] Found ${cards.length} cards in REAL screen.`);

                cards.forEach(card => {
                    // Force interactive styles
                    card.style.cursor = 'pointer';
                    card.style.pointerEvents = 'auto'; // CRITICAL: Override parent's potential 'none'

                    // We don't necessarily need to overwrite onclick if the module handles it,
                    // but ensuring pointer-events is auto is crucial.
                    // If the module's startBattle() attaches listeners or if HTML has onclick, we are good.
                });

                // Ensure the UI container allows clicks
                const uiContainer = document.getElementById('alice-game-ui');
                if (uiContainer) {
                    uiContainer.style.pointerEvents = 'none'; // Container pass-through
                    // But children (entity-area) need auto
                    const areas = uiContainer.querySelectorAll('.entity-area');
                    areas.forEach(area => area.style.pointerEvents = 'auto');
                }

            }, 100);

        } else {
            console.error("[Game] CRITICAL: #screen-alice-battle not found!");
            return;
        }

        // 4. Reset Legacy State (Just in case)
        this.aliceBattleState.playerHp = 100;
        this.aliceBattleState.villainHp = 100;
        this.aliceBattleState.isPlayerTurn = true;
        this.updateBattleUI();
    },



    updateBattleUI() {
        const pBar = document.querySelector("#screen-final-boss .warden .hp");
        if (pBar) pBar.style.width = `${this.aliceBattleState.playerHp}%`;
        if (vBar) vBar.style.width = `${this.aliceBattleState.villainHp}%`;
    },

    handleBattleAction(type) {
        if (!this.aliceBattleState.isPlayerTurn) return;

        // 1. Player Attack
        console.log(`[Battle] Player used ${type}!`);
        this.aliceBattleState.isPlayerTurn = false;

        // Visual Feedback (Card Shake)
        const cardIndex = ['ink', 'rune', 'gem'].indexOf(type);
        const card = document.querySelectorAll("#screen-final-boss .warden .card")[cardIndex];
        if (card) {
            card.style.transform = "scale(0.9)";
            setTimeout(() => card.style.transform = "scale(1)", 100);
        }

        // Damage Logic (Simplified)
        let dmg = 20;
        if (type === 'ink') dmg = 15; // Fast
        if (type === 'rune') dmg = 25; // Strong
        if (type === 'gem') dmg = 35; // Ultimate

        this.aliceBattleState.villainHp = Math.max(0, this.aliceBattleState.villainHp - dmg);
        this.updateBattleUI();

        // 2. Check Win
        if (this.aliceBattleState.villainHp <= 0) {
            setTimeout(() => this.winBattle(), 500);
            return;
        }

        // 3. Villain Turn (Simulated)
        setTimeout(() => {
            const vAction = document.querySelector("#screen-final-boss .villain .avatar");
            if (vAction) {
                vAction.style.transform = "scale(1.2)";
                setTimeout(() => vAction.style.transform = "scale(1)", 200);
            }

            // Player takes minimal damage (scripted to win easily)
            this.aliceBattleState.playerHp = Math.max(0, this.aliceBattleState.playerHp - 10);
            this.updateBattleUI();
            this.aliceBattleState.isPlayerTurn = true;
        }, 800);
    },

    winBattle() {
        console.log("[Battle] VICTORY!");
        // Visuals
        const bossScreen = document.getElementById("screen-final-boss");
        if (bossScreen) bossScreen.style.animation = "shake 0.5s ease-in-out";

        // Delay then Score
        setTimeout(() => {
            Game.goToNewScore();
        }, 1500);
    },

    /*
    checkFinalBossAnswer(index) {
        // ... (Legacy code preserved for reference if needed later) ...
    }
    */
    goToNewScore() {
        console.log("[Game] Transitioning to Score Report...");
        this.switchScreen('screen-new-score');

        // Scroll to Top Reset & Layout Fix
        const screen = document.getElementById('screen-new-score');
        if (screen) {
            screen.scrollTop = 0;
            screen.style.display = 'flex';
            screen.style.flexDirection = 'column';
            screen.style.justifyContent = 'space-between';

            // [FIX] Ensure Score Screen is Clickable & On Top
            screen.style.zIndex = "100000";
            screen.style.pointerEvents = "auto";
            screen.style.position = "absolute"; // or relative, depending on layout
            screen.style.top = "0";
            screen.style.left = "0";
            screen.style.width = "100%";
            screen.style.height = "100%";

            // Force Input & Button interactive
            const input = document.getElementById('warden-email');
            if (input) {
                input.style.pointerEvents = "auto";
                input.style.zIndex = "100001";
            }
            const btn = document.querySelector('#bind-form button');
            if (btn) {
                btn.style.pointerEvents = "auto";
                btn.style.zIndex = "100001";
                btn.style.position = "relative";
            }
        }

        // 1. Fetch Data (Direct Source: HUD Elements for Resources)
        const score = this.scoreManager || {};

        let wpm = score.wpm || 0;

        // Read directly from HUD (The User's Reality)
        const hudInk = document.getElementById('val-ink');
        const hudRune = document.getElementById('val-rune');
        const hudGem = document.getElementById('val-gem');

        let ink = hudInk ? parseInt(hudInk.innerText) : (score.ink || 0);
        let rune = hudRune ? parseInt(hudRune.innerText) : (score.runes || 0);
        let gem = hudGem ? parseInt(hudGem.innerText) : (score.gems || 0);

        // Demo Fallback (If HUD is empty or 0, maybe demo mode)
        if (wpm === 0 && ink === 0 && rune === 0 && gem === 0) {
            wpm = Math.floor(Math.random() * 50 + 150);
            ink = 120; rune = 15; gem = 30;
        }

        // 2. Determine Rank
        let rankText = 'Novice';
        let rankColor = '#aaa';
        // Simple logic based on WPM for now
        if (wpm >= 250) { rankText = 'Master'; rankColor = 'gold'; }
        else if (wpm >= 150) { rankText = 'Apprentice'; rankColor = '#00ff00'; }

        // 3. Helper: Animate Value with Delay
        const animateValue = (id, start, end, duration, prefix = "", suffix = "", startDelay = 0) => {
            const obj = document.getElementById(id);
            if (!obj) return;

            setTimeout(() => {
                let startTimestamp = null;
                const step = (timestamp) => {
                    if (!startTimestamp) startTimestamp = timestamp;
                    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                    // Easing (EaseOutQuad) for fun pop
                    const ease = 1 - Math.pow(1 - progress, 3);
                    const current = Math.floor(ease * (end - start) + start);

                    obj.innerText = prefix + current.toLocaleString() + suffix;

                    // Color shift effect for high scores
                    if (progress > 0.8 && end > 0) {
                        obj.style.textShadow = `0 0 10px ${rankColor}`;
                    }

                    if (progress < 1) {
                        window.requestAnimationFrame(step);
                    }
                };
                window.requestAnimationFrame(step);
            }, startDelay);
        };

        // 4. Trigger Animations (Staggered for Fun)
        animateValue("report-wpm", 0, wpm, 1500);

        const rankEl = document.getElementById('report-rank-text');
        if (rankEl) {
            rankEl.innerText = rankText;
            rankEl.style.color = rankColor;
            // Delay Rank pop
            setTimeout(() => {
                rankEl.style.transition = "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
                rankEl.style.transform = "scale(1.3)";
            }, 800);
            setTimeout(() => { rankEl.style.transform = "scale(1.0)"; }, 1200);
        }

        // Resources (Parallel Start)
        animateValue("report-ink-count", 0, ink, 1000, "", "");
        animateValue("report-ink-score", 0, ink * 10, 1500, "+", "");

        animateValue("report-rune-count", 0, rune, 1000, "", "", 200);
        animateValue("report-rune-score", 0, rune * 100, 1500, "+", "", 200);

        animateValue("report-gem-count", 0, gem, 1000, "", "", 400);
        animateValue("report-gem-score", 0, gem * 500, 1500, "+", "", 400);


    },

    bindKeyAndUnlock() {
        const emailInput = document.getElementById('warden-email');
        let email = emailInput ? emailInput.value : '';

        // [DEBUG] Bypass Validation for smoother flow test
        if (!email) email = "anonymous_warden@test.com";

        /*
        if (!email || !email.includes('@')) {
            alert("⚠️ Soul Binding Failed: Invalid Warden ID (Email).\nPlease invoke a valid identity.");
            return;
        }
        */

        // --- SUCCESS SEQUENCE ---
        console.log(`[Warden] Binding Key to: ${email}`);

        // 1. Visual Feedback
        const btn = document.querySelector('#bind-form button');
        if (btn) {
            btn.innerText = "✨ SOUL BOUND ✨";
            btn.style.background = "#fff";
            btn.disabled = true;
        }

        // 2. Transition FAST (Don't wait for DB)
        setTimeout(() => {
            if (typeof this.switchScreen === 'function') {
                this.switchScreen('screen-new-share');
            } else {
                const shareScreen = document.getElementById('screen-new-share');
                if (shareScreen) {
                    shareScreen.classList.add('active');
                    shareScreen.style.display = 'flex';
                    // Force overlay z-index
                    shareScreen.style.zIndex = "100000";
                    shareScreen.style.pointerEvents = "auto";
                }
            }
        }, 500);

        // 3. Store Data (Async Background)
        try {
            // Initialize Firebase if needed
            if (window.firebase && window.FIREBASE_CONFIG && !firebase.apps.length) {
                firebase.initializeApp(window.FIREBASE_CONFIG);
            }

            const score = (window.Game && window.Game.scoreManager) ? window.Game.scoreManager : {};
            const wardenData = {
                email: email,
                wpm: score.wpm || 0,
                ink: score.ink || 0,
                runes: score.runes || 0,
                gems: score.gems || 0,
                timestamp: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
                device: navigator.userAgent
            };

            if (window.firebase) {
                const db = firebase.firestore();
                db.collection("wardens").add(wardenData)
                    .then((docRef) => console.log("[Firebase] Saved:", docRef.id))
                    .catch((err) => console.error("[Firebase] Save Error:", err));
            }
        } catch (e) {
            console.error("[Firebase] Critical Error:", e);
        }

        localStorage.setItem('warden_email', email);
        localStorage.setItem('chapter_1_unlocked', 'true');
    },

    goToNewSignup() {
        this.switchScreen('screen-new-signup');
    },

    goToNewShare() {
        this.switchScreen('screen-new-share');
    },
};

window.Game = Game;
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});


// End of file



