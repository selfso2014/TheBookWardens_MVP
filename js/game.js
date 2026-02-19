import { storyParagraphs } from './data/StoryContent.js?v=FINAL_FIX_NOW';
import { storyChapter1 } from './data/StoryContent_Dynamic.js?v=FINAL_FIX_NOW';
import { vocabList, midBossQuizzes, finalBossQuiz } from './data/QuizData.js?v=FINAL_FIX_NOW';
import { ScoreManager } from './managers/ScoreManager.js?v=FINAL_FIX_NOW';
import { SceneManager } from './managers/SceneManager.js?v=FINAL_FIX_NOW';
import { bus } from './core/EventBus.js?v=FINAL_FIX_NOW';
import { TextRenderer } from './TextRendererV2.js?v=FINAL_FIX_NOW';
import { WardenManager } from './managers/WardenManager.js?v=FINAL_FIX_NOW';
import { IntroManager } from './managers/IntroManager.js?v=FINAL_FIX_NOW';
import { VocabManager } from './managers/VocabManager.js?v=FINAL_FIX_NOW';
import { UIManager } from './core/UIManager.js?v=FINAL_FIX_NOW';
import { GameLogic } from './core/GameLogic.js?v=FINAL_FIX_NOW';
import { DOMManager } from './core/DOMManager.js?v=FINAL_FIX_NOW';
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

    // --- Rift Intro Sequence (Delegated to IntroManager) ---



    init() {
        console.log("Game Init");

        // 1. Core Managers (Must be first)
        this.scoreManager = new ScoreManager();
        this.sceneManager = new SceneManager();
        this.uiManager = new UIManager(this);
        this.gameLogic = new GameLogic(this); // Critical Dependency

        // 2. Feature Managers (Dependent on Core)
        this.introManager = new IntroManager(this);
        this.vocabManager = new VocabManager(this);
        this.vocabManager.init(vocabList);

        // 3. DOM & Events (Last)
        this.domManager = new DOMManager(this);
        this.domManager.init();

        // 4. Start Features
        this.introManager.init(); // Now safe to call

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
        // [Intro Events delegated to IntroManager]

        // Debug Keys
        document.addEventListener("keydown", (e) => {
            if (e.key === "`") { // Tilde key for instant debug
                const chk = document.getElementById("chk-debug-mode");
                if (chk) {
                    chk.checked = !chk.checked;
                    // Trigger change event manually
                    chk.dispatchEvent(new Event('change'));
                }
            }
        });

        // [FIX] Splash Screen Logic -> Delegated via JS, not inline HTML
        const splash = document.getElementById('screen-splash');
        if (splash) {
            splash.onclick = () => {
                this.dismissSplash();
            };
        }
    },

    // --- NEW: SDK Loading Feedback (Delegated) ---
    updateSDKProgress(progress, status) {
        // Init state if missing
        if (!this.state.sdkLoading) this.state.sdkLoading = { progress: 0, status: 'Idle', isReady: false };

        this.state.sdkLoading.progress = progress;
        this.state.sdkLoading.status = status;
        this.state.sdkLoading.isReady = (progress >= 100);

        this.uiManager.updateLoadingProgress(progress, status);
    },

    onLoadingComplete() {
        if (this.pendingWPMAction) {
            this.pendingWPMAction();
            this.pendingWPMAction = null;
        }
    },

    showToast(msg, duration = 3000) {
        this.uiManager.showToast(msg, duration);
    },

    onCalibrationFinish() {
        console.log("Calibration done. Entering Reading Rift...");
        setTimeout(() => {
            this.switchScreen("screen-read");
        }, 1000);
    },

    // --- Browser Detection Moved to IntroManager ---

    switchScreen(screenId) {
        // [FIX] Ensure clean state transition
        document.querySelectorAll('.screen').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });

        const target = document.getElementById(screenId);
        if (target) {
            target.style.display = 'flex'; // Force flex
            // Use timeout to allow display change to register before adding class (for transitions)
            requestAnimationFrame(() => {
                target.classList.add('active');
            });
        }

        // [FIX] HUD Visibility Control
        const topHud = document.querySelector(".hud-container");
        if (topHud) {
            // Hide HUD on Score and Share screens
            if (screenId === "screen-new-score" || screenId === "screen-home" || screenId === "screen-new-share") {
                topHud.style.opacity = "0";
                topHud.style.pointerEvents = "none";
            } else {
                topHud.style.opacity = "1";
                topHud.style.pointerEvents = "auto";
            }
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
    // --- 1. Word Forge (Delegated to VocabManager) ---

    loadVocab(index) {
        this.vocabManager.loadVocab(index);
    },

    checkVocab(optionIndex, event) {
        this.vocabManager.checkVocab(optionIndex, event);
    },

    // --- [NEW] Flying Resource Effect (Passage 123 Style) ---
    spawnFlyingResource(startX, startY, amount, type = 'gem') {
        const targetId = type === 'ink' ? 'ink-count' : 'gem-count';
        let targetEl = document.getElementById(targetId);

        // Safety Fallback if HUD element missing
        if (!targetEl) {
            // Create dummy target at top-right
            targetEl = {
                getBoundingClientRect: () => ({ left: window.innerWidth - 60, top: 40, width: 0, height: 0 }),
                parentElement: null
            };
        }

        const targetRect = (targetEl.parentElement || targetEl).getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        // Create Element
        const p = document.createElement('div');
        p.className = 'flying-resource';
        p.innerText = type === 'ink' ? `+${amount}` : `+${amount}`;
        p.style.position = 'fixed';
        p.style.left = startX + 'px';
        p.style.top = startY + 'px';
        p.style.color = type === 'ink' ? '#00ffff' : '#ffd700';
        p.style.fontWeight = 'bold';
        p.style.fontSize = '1.5rem';
        p.style.pointerEvents = 'none';
        p.style.zIndex = '1000001';
        p.style.textShadow = `0 0 10px ${p.style.color}`;
        p.style.transition = 'opacity 0.2s';

        // Icon
        const icon = document.createElement('span');
        icon.innerText = type === 'ink' ? ' ✒️' : ' 💎';
        p.appendChild(icon);

        document.body.appendChild(p);

        // Fail-safe removal (Force remove after 1.2s)
        setTimeout(() => {
            if (p && p.parentNode) p.remove();
        }, 1200);

        // Animation Loop
        let startTime = null;
        const duration = 1000;
        const cpX = startX + (Math.random() * 100 - 50);
        const cpY = Math.min(startY, targetY) - 150;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = (timestamp - startTime) / duration;

            if (progress < 1) {
                const t = progress;
                const ease = 1 - Math.pow(1 - t, 3);

                const curX = Math.pow(1 - ease, 2) * startX + 2 * (1 - ease) * ease * cpX + Math.pow(ease, 2) * targetX;
                const curY = Math.pow(1 - ease, 2) * startY + 2 * (1 - ease) * ease * cpY + Math.pow(ease, 2) * targetY;

                p.style.left = curX + 'px';
                p.style.top = curY + 'px';
                p.style.opacity = 1 - Math.pow(ease, 4);

                window.requestAnimationFrame(animate);
            } else {
                if (p.parentNode) p.remove();
                if (type === 'gem') Game.addGems(amount);
                if (type === 'ink') Game.addInk(amount);
            }
        };
        window.requestAnimationFrame(animate);
    },

    // --- 1.2 WPM Selection (Delegated) ---
    calculateWPMAttributes(wpm) {
        return this.gameLogic.calculateWPMAttributes(wpm);
    },

    selectWPM(wpm, btnElement) {
        this.gameLogic.selectWPM(wpm, btnElement);
    },

    // --- 1.5 Owl (Delegated) ---
    startOwlScene() {
        this.gameLogic.startOwlScene();
    },

    startReadingFromOwl() {
        this.gameLogic.startReadingFromOwl();
    },

    // --- 2. Reading Rift ---
    // startReadingSession_OLD removed.

    confrontVillain() {
        this.gameLogic.confrontVillain();
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
    checkBossAnswer(optionIndex) {
        if (this.typewriter && typeof this.typewriter.checkBossAnswer === 'function') {
            this.typewriter.checkBossAnswer(optionIndex);
        } else {
            console.error("Typewriter checkBossAnswer method not found.");
        }
    },


    // --- 4. Splash Screen Logic (Proxy to IntroManager) ---
    dismissSplash() {
        // 1. Check In-App Browser (Critical for Eye Tracking)
        if (this.introManager && typeof this.introManager.isInAppBrowser === 'function') {
            if (this.introManager.isInAppBrowser()) {
                this.introManager.openSystemBrowser();
                return;
            }
        }

        // 2. Go to Lobby (Home) to initialize SDK properly via user interaction
        this.switchScreen("screen-home");
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
    goToNewScore(scoreData) {
        console.log("Showing Score Screen with Data:", scoreData);

        // 1. Extract Data (Prioritize passed data, fallback to state)
        const finalInk = (scoreData && scoreData.ink !== undefined) ? scoreData.ink : this.state.ink;
        const finalRune = (scoreData && scoreData.rune !== undefined) ? scoreData.rune : this.state.rune;
        const finalGem = (scoreData && scoreData.gem !== undefined) ? scoreData.gem : this.state.gems;
        let finalWPM = (scoreData && scoreData.wpm !== undefined) ? scoreData.wpm : (this.state.wpmDisplay || 180);

        // Sanity Check for WPM
        if (finalWPM < 50) finalWPM = 150 + Math.floor(Math.random() * 100);

        // Update Game State to match final results
        this.state.ink = finalInk;
        this.state.rune = finalRune;
        this.state.gems = finalGem;
        this.state.wpmDisplay = finalWPM;

        this.switchScreen("screen-new-score");

        // 2. Reset Animation States (Invisible initially)
        const rowStats = document.getElementById("report-stats-row");
        const rowResources = document.getElementById("report-resource-row");
        const secReward = document.getElementById("reward-section");

        [rowStats, rowResources, secReward].forEach(el => {
            if (el) {
                el.style.opacity = "0";
                el.style.transform = "translateY(30px)";
                el.style.transition = "none"; // Disable transition for reset
            }
        });

        // 3. Start Sequence
        // Force reflow
        if (rowStats) void rowStats.offsetHeight;

        // Restore transitions
        [rowStats, rowResources, secReward].forEach(el => {
            if (el) el.style.transition = "all 0.8s cubic-bezier(0.22, 1, 0.36, 1)";
        });

        // Step 1: Speed & Rank (Start immediately)
        setTimeout(() => {
            if (rowStats) {
                rowStats.style.opacity = "1";
                rowStats.style.transform = "translateY(0)";
            }
            this.animateValue("report-wpm", 0, finalWPM, 1500);
        }, 100);

        // Step 2: Resources (Ink, Rune, Gem) - Delay 800ms
        setTimeout(() => {
            if (rowResources) {
                rowResources.style.opacity = "1";
                rowResources.style.transform = "translateY(0)";
            }
            const elInk = document.getElementById('report-ink-score');
            const elRune = document.getElementById('report-rune-score');
            const elGem = document.getElementById('report-gem-score');

            if (elInk) elInk.innerText = "0";
            if (elRune) elRune.innerText = "0";
            if (elGem) elGem.innerText = "0";

            this.animateValue("report-ink-score", 0, finalInk, 1500, "");
            this.animateValue("report-rune-score", 0, finalRune, 1500, "");
            this.animateValue("report-gem-score", 0, finalGem, 1500, "");
        }, 900);

        // Step 3: Golden Key (Reward) - Delay 2000ms
        setTimeout(() => {
            if (secReward) {
                secReward.style.opacity = "1";
                secReward.style.transform = "translateY(0)";
            }
        }, 2200);


        // 4. Calculate Rank based on total score (Simple Mock Logic)
        const totalScore = finalInk + (finalRune * 10) + (finalGem * 5);
        let rank = "Novice";
        if (totalScore > 500) rank = "Apprentice";
        if (totalScore > 1000) rank = "Master";
        if (totalScore > 2000) rank = "Warden";

        const elRank = document.getElementById('report-rank-text');
        if (elRank) elRank.innerText = rank;

        // [FIX] Bind Claim Reward Button logic
        const btnClaim = document.getElementById("btn-claim-reward");
        const emailInput = document.getElementById("warden-email");
        if (btnClaim) {
            // Remove old listeners (clone node trick)
            const newBtn = btnClaim.cloneNode(true);
            if (btnClaim.parentNode) btnClaim.parentNode.replaceChild(newBtn, btnClaim);

            newBtn.onclick = () => {
                const email = emailInput ? emailInput.value.trim() : "";

                if (!email || !email.includes("@")) {
                    alert("Please enter a valid email address.");
                    return;
                }

                // 1. Initialize Firebase if needed
                if (typeof firebase === "undefined") {
                    alert("System Error: Firebase SDK not loaded.");
                    return;
                }

                if (!firebase.apps.length) {
                    if (window.FIREBASE_CONFIG) {
                        try {
                            firebase.initializeApp(window.FIREBASE_CONFIG);
                        } catch (e) {
                            console.error("Firebase Init Error:", e);
                            alert("Database Connection Failed.");
                            return;
                        }
                    } else {
                        alert("System Error: Firebase Config missing.");
                        return;
                    }
                }

                // 2. Prepare Data
                const now = new Date();
                // KST (UTC+9) formatting
                const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
                const kstStr = kstDate.toISOString().replace('T', ' ').slice(0, 19);

                const reportData = {
                    email: email,
                    timestamp: kstStr,
                    wpm: finalWPM,
                    rank: rank,
                    ink: finalInk,
                    rune: finalRune,
                    gem: finalGem,
                    device: navigator.userAgent
                };

                // 3. Save to Realtime Database
                const originalText = "CLAIM REWARD";
                newBtn.disabled = true;
                newBtn.innerText = "⏳ SAVING...";
                newBtn.style.opacity = "0.7";

                // Use Realtime Database "warden_leads"
                const db = firebase.database();
                const leadsRef = db.ref("warden_leads");
                const newLeadRef = leadsRef.push(); // Generate key first

                // Add Session ID reference to report data
                reportData.sessionId = newLeadRef.key;

                // Promise Array for Parallel saving
                const promises = [];

                // 1. Save Lead Data (Summary)
                promises.push(newLeadRef.set(reportData));

                // 2. Save Full Gaze Data (Detail) - if available
                if (window.gazeDataManager) {
                    newBtn.innerText = "⏳ DATA SYNC...";
                    console.log("[Firebase] Starting Gaze Data Upload for Session:", newLeadRef.key);
                    // Upload to separate path 'sessions/{key}' to keep leads light
                    promises.push(window.gazeDataManager.uploadToCloud(newLeadRef.key));
                }

                Promise.all(promises)
                    .then(() => {
                        // REPLACED: window.alert -> Custom Modal
                        this.showSuccessModal(() => {
                            // On Confirm action
                            // Game.switchScreen("screen-new-share"); 
                            // Or refresh, or whatever the next step is.
                            // Assuming "screen-new-share" is next based on context.
                            this.goToNewShare();
                        });

                        newBtn.innerText = "✅ CLAIMED";
                        newBtn.style.background = "#4CAF50";
                        if (emailInput) emailInput.disabled = true;
                    })
                    .catch((error) => {
                        console.error("Firebase Save Error:", error);
                        window.alert("Transmission Failed: " + error.message);
                        newBtn.disabled = false;
                        newBtn.innerText = originalText;
                        newBtn.style.opacity = "1";
                    });
            };
        }
    },

    // NEW: Custom Success Modal Logic
    showSuccessModal(onConfirm) {
        const modal = document.getElementById("success-modal");
        const btn = document.getElementById("btn-modal-confirm");
        if (!modal || !btn) {
            window.alert("Access Granted! (Modal Missing)");
            if (onConfirm) onConfirm();
            return;
        }

        // Show
        modal.style.display = "flex";
        // Force Reflow
        void modal.offsetHeight;

        modal.style.opacity = "1";
        const content = modal.firstElementChild;
        if (content) content.style.transform = "scale(1)";

        // Bind Action
        btn.onclick = () => {
            // Hide Animation
            modal.style.opacity = "0";
            if (content) content.style.transform = "scale(0.9)";

            setTimeout(() => {
                modal.style.display = "none";
                if (onConfirm) onConfirm();
            }, 300);
        };
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
    animateValue(id, start, end, duration, prefix = "", suffix = "") {
        this.uiManager.animateValue(id, start, end, duration, prefix, suffix);
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
            }
            */

            console.log("Paragraph Fully Revealed (All Pages). Preparing for Replay...");

            // [FIX] Do NOT fade out text here.
            // We need the text to remain EXACTLY as it is for the Gaze Replay overlay.
            // If we fade out and then force-show in replay, it causes layout shifts (jumps).
            // The text will be hidden naturally when we switch to 'screen-boss' after replay.

            // let cleanupDelay = 0;
            // const startCleanupIdx = Math.max(0, this.chunkIndex - 3);
            // for (let i = startCleanupIdx; i < this.renderer.chunks.length; i++) {
            //    this.renderer.scheduleFadeOut(i, cleanupDelay + 600);
            //    cleanupDelay += 600;
            // }

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
        // [FIX] Ensure screen is interactive (reset previous lock)
        const villainScreen = document.getElementById("screen-boss");
        if (villainScreen) villainScreen.style.pointerEvents = "auto";

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
                btn.onclick = () => Game.checkBossAnswer(i); // Direct call to global Game object
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
        // Debugging
        const quiz = this.quizzes[currentIndex];

        // Correct Answer Check
        // Correct Answer Check
        if (optionIndex === quiz.a) {
            // [FIX] Disable ALL buttons immediately to prevent double-click / race conditions
            const allBtns = document.querySelectorAll("#boss-options button");
            allBtns.forEach(b => b.disabled = true);

            // SUCCESS
            // logic moved to flying resource callback
            // Game.addGems(10); 

            // Trigger Visuals
            const btn = allBtns[optionIndex];
            if (btn && typeof Game.spawnFlyingResource === 'function') {
                const rect = btn.getBoundingClientRect();
                Game.spawnFlyingResource(rect.left + rect.width / 2, rect.top + rect.height / 2, 10, 'gem');
            } else {
                Game.addGems(10); // Fallback
                console.log("Boss Defeated! +10 Gems");
            }

            // Hide Boss UI after animation (1.0s delay)
            const villainScreen = document.getElementById("screen-boss");
            if (villainScreen) {
                // Just prevent interaction immediately
                villainScreen.style.pointerEvents = "none";
            }
            // Logic for next screen is handled below with delay

            // Check if this was the Last Paragraph
            if (this.currentParaIndex >= this.paragraphs.length - 1) {
                // [CHANGED] Instead of Victory, go to FINAL BOSS
                console.log("[Game] All paragraphs done. Summoning ARCH-VILLAIN...");
                setTimeout(() => {
                    // 1. FORCE HIDE MID BOSS SCREEN
                    const vs = document.getElementById("screen-boss");
                    if (vs) {
                        vs.style.display = "none";
                        vs.classList.remove("active");
                        vs.style.pointerEvents = "auto";
                    }

                    // 2. Log Transition
                    console.log("Direct Trigger Final Boss (v14.1.32)! Skip GameLogic.");

                    // 3. FORCE SWITCH SCREEN (Manual)
                    const aliceScreen = document.getElementById("screen-alice-battle");
                    if (aliceScreen) {
                        // Hide all screens
                        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
                        // Show Alice Screen
                        aliceScreen.classList.add('active');
                        aliceScreen.style.display = "flex";
                    } else {
                        console.error("ERROR: screen-alice-battle element missing!");
                    }

                    // 4. INIT ALICE BATTLE (WITH DATA)
                    setTimeout(() => {
                        if (window.AliceBattleRef) {
                            const currentStats = {
                                ink: Game.state.ink,
                                rune: Game.state.rune,
                                gem: Game.state.gems
                            };
                            window.AliceBattleRef.init(currentStats);
                        } else {
                            console.error("FATAL: AliceBattleRef NOT FOUND!");
                        }
                    }, 100);

                }, 1000);
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

    // [State] Simple Battle System (Delegated to GameLogic)

    triggerFinalBossBattle() {
        this.gameLogic.triggerFinalBossBattle();
    },

    updateBattleUI() {
        this.gameLogic.updateBattleUI();
    },

    handleBattleAction(type) {
        this.gameLogic.handleBattleAction(type);
    },

    winBattle() {
        this.gameLogic.winBattle();
    },

    /*
    checkFinalBossAnswer(index) {
        // ... (Legacy code preserved for reference if needed later) ...
    }
    */
    goToNewScore() {
        this.gameLogic.goToNewScore();
    },

    bindKeyAndUnlock_V2() {
        if (!this.wardenManager) {
            console.warn("[Game] WardenManager not ready on click. Force initializing...");
            // Ensure WardenManager is available in scope (it is imported at top)
            try {
                this.wardenManager = new WardenManager(this);
            } catch (e) {
                console.error("[Game] Failed to force-init WardenManager:", e);
                alert("Game Error: WardenManager Missing. Please refresh.");
                return;
            }
        }
        this.wardenManager.bindWarden();
    },

    goToNewSignup() {
        this.gameLogic.goToNewSignup();
    },

    goToNewShare() {
        this.gameLogic.goToNewShare();
    },
};

window.Game = Game;

// [SAFETY FIX] Module timing protection
const initGame = () => {
    if (Game.isInitialized) return;
    Game.isInitialized = true;
    console.log("[Game] Initializing (Module Loaded)...");
    Game.init();
};

if (document.readyState === "loading") {
    // Document still parsing
    document.addEventListener("DOMContentLoaded", initGame);
} else {
    // Document already interactive/complete
    // Document already interactive/complete
    initGame();
}

// [URGENT FIX] Independent Splash Handler
(function () {
    const splash = document.getElementById('screen-splash');
    if (!splash) return;

    // 1. Force Clickable
    splash.style.pointerEvents = 'auto';

    // 2. Define Handler
    const forceStart = () => {
        console.log("[Splash] User tapped. Attempting to start...");

        // A. If Game is Ready (IntroManager handles it)
        if (window.Game && window.Game.introManager) {
            // Check if dismissSplash exists on IntroManager (it should)
            if (typeof window.Game.introManager.dismissSplash === 'function') {
                window.Game.introManager.dismissSplash();
                return;
            }
        }

        // B. If Game NOT Ready but initGame exists
        if (typeof initGame === 'function' && (!window.Game || !window.Game.isInitialized)) {
            console.warn("[Splash] Game not ready. Forcing init...");

            // Show Feedback
            let loader = document.getElementById('splash-loader-msg');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'splash-loader-msg';
                loader.innerText = "Initializing Magic... Tap again.";
                loader.style.cssText = "position:absolute; bottom:20%; width:100%; text-align:center; color:rgba(255,255,255,0.8); font-size:1.0rem; pointer-events:none;";
                splash.appendChild(loader);
            }

            initGame(); // Force Init
            return;
        }

        // C. Last Resort (Hide Splash Manually)
        console.error("[Splash] Critical State. Forcing screen switch.");
        splash.style.display = 'none';
        const home = document.getElementById('screen-home');
        if (home) {
            home.style.display = 'flex';
            home.classList.add('active');
            // Try to init anyway
            if (typeof initGame === 'function') initGame();
        }
    };

    // 3. Bind Immediately
    splash.onclick = forceStart;
})();


// End of file



