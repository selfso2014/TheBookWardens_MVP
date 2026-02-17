export class GameLogic {
    constructor(game) {
        this.game = game;

        // Alice Battle State
        this.aliceBattleState = {
            playerHp: 100,
            villainHp: 100,
            isPlayerTurn: true
        };
    }

    // --- WPM Selection & Calculation ---
    calculateWPMAttributes(wpm) {
        // A. Constraints
        let chunkSize = 4;
        if (wpm <= 100) chunkSize = 3;
        if (wpm >= 300) chunkSize = 6;

        // B. Target Times (ms)
        const msPerMinute = 60000;
        const targetChunkTotalTime = (msPerMinute / wpm) * chunkSize; // For ONE chunk

        // C. System Consants
        const SYSTEM_BUFFER = 250;

        // D. Snappy Interval Strategy
        let interval = 50;

        // E. Calculate Delay
        let delay = targetChunkTotalTime - (interval * chunkSize) - SYSTEM_BUFFER;

        // F. Adaptive Logic
        if (delay < 150) {
            delay = 150;
            const availableRenderTime = targetChunkTotalTime - SYSTEM_BUFFER - 150;
            interval = Math.floor(availableRenderTime / chunkSize);
            if (interval < 20) interval = 20;
        }

        return { chunkSize, interval, delay: Math.floor(delay) };
    }

    selectWPM(wpm, btnElement) {
        // UI Visual Update
        const buttons = document.querySelectorAll('.wpm-btn');
        buttons.forEach(btn => {
            btn.classList.remove('selected');
            btn.style.borderColor = btn.style.borderColor.replace('1)', '0.3)');
            btn.style.boxShadow = 'none';
            btn.style.transform = 'scale(1)';
        });

        if (btnElement) {
            btnElement.classList.add('selected');
            btnElement.style.borderColor = btnElement.style.borderColor.replace('0.3', '1');
            btnElement.style.boxShadow = `0 0 20px ${window.getComputedStyle(btnElement).color}`;
            btnElement.style.transform = 'scale(1.05)';
        }

        // State Update
        this.game.wpm = wpm;

        // DSC Support (Re-layout if active)
        if (this.game.typewriter && this.game.typewriter.renderer && this.game.state.isTracking) {
            // Logic to re-prepare can go here if needed
        }

        // Calc Params
        this.game.wpmParams = this.calculateWPMAttributes(wpm);
        this.game.targetChunkSize = this.game.wpmParams.chunkSize;

        console.log(`[GameLogic] WPM Selected: ${wpm}. Params: Interval=${this.game.wpmParams.interval}ms, Delay=${this.game.wpmParams.delay}ms`);

        // Flow Transition
        setTimeout(async () => {
            // Check SDK Status
            if (this.game.state.sdkLoading && !this.game.state.sdkLoading.isReady) {
                console.log("SDK not ready, showing modal...");
                const modal = document.getElementById("sdk-loading-modal");
                if (modal) modal.style.display = "flex";
                this.game.pendingWPMAction = () => this.selectWPM(wpm, btnElement); // Retry closure
                return;
            }

            // Tracking Init Check
            if (this.game.trackingInitPromise) {
                const timeout = new Promise(r => setTimeout(() => r(false), 3000));
                await Promise.race([this.game.trackingInitPromise, timeout]);
            }

            this.game.switchScreen("screen-calibration");
            setTimeout(() => {
                const calStarted = typeof window.startCalibrationRoutine === "function" ? window.startCalibrationRoutine() : false;
                if (!calStarted) {
                    console.warn("Calibration start failed, skipping to reading.");
                    this.game.switchScreen("screen-read");
                }
            }, 500);

        }, 500);
    }

    // --- Owl Logic ---
    startOwlScene() {
        this.game.state.isTracking = true;
        this.game.state.isOwlTracker = true;
        this.game.switchScreen("screen-owl");
        if (typeof window.setGazeDotState === "function") window.setGazeDotState(false);
    }

    startReadingFromOwl() {
        this.game.state.isOwlTracker = false;
        this.game.switchScreen("screen-read");
        if (this.game.typewriter && typeof this.game.typewriter.start === 'function') {
            this.game.typewriter.start();
        }
    }

    // --- Battle Logic (Mid Boss) ---
    confrontVillain() {
        if (this.game.typewriter) this.game.typewriter.isPaused = true;
        this.game.state.isTracking = false;

        // Clean up reading artifacts
        const pangLayer = document.getElementById("pang-marker-layer");
        if (pangLayer) pangLayer.innerHTML = "";
        const bookContent = document.getElementById("book-content");
        if (bookContent) bookContent.innerHTML = "";

        this.game.switchScreen("screen-boss");
    }

    // --- Alice Battle Logic (Final Boss) ---
    triggerFinalBossBattle() {
        console.log("[GameLogic] Triggering Alice Battle...");

        // 1. Blockers
        ['output', 'preview', 'calibration-overlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.pointerEvents = 'none'; el.style.zIndex = '0'; }
        });
        const hud = document.getElementById('hud-top');
        if (hud) hud.style.display = 'none';

        // 2. Switch Screen
        // We use game.switchScreen but need specific setup for Alice
        this.game.switchScreen("screen-alice-battle");

        const screen = document.getElementById("screen-alice-battle");
        if (screen) {
            screen.classList.add('alice-battle-mode');

            // 3. Delayed Init
            setTimeout(() => {
                if (window.AliceBattleRef) {
                    console.log("[GameLogic] Initializing AliceBattleRef...");
                    if (window.Game) window.Game.AliceBattle = window.AliceBattleRef;

                    window.AliceBattleRef.init();

                    // Pointer Events Fix
                    setTimeout(() => {
                        const canvas = document.getElementById('alice-canvas');
                        if (canvas) canvas.style.pointerEvents = 'none';

                        const cards = screen.querySelectorAll('.warden .card');
                        cards.forEach(c => { c.style.cursor = 'pointer'; c.style.pointerEvents = 'auto'; });

                        const uiContainer = document.getElementById('alice-game-ui');
                        if (uiContainer) {
                            uiContainer.style.pointerEvents = 'none';
                            uiContainer.querySelectorAll('.entity-area').forEach(a => a.style.pointerEvents = 'auto');
                        }
                    }, 50);
                } else {
                    console.warn("[GameLogic] AliceBattleRef not found. Using simple fallback?");
                    // Keep fallback logic if requested, or assume module exists for Phase 1 cleanup
                }
            }, 100);
        } else {
            console.error("Screen screen-alice-battle not found");
        }
    }

    // --- Simple Battle Fallback (Legacy/Simple Mode) ---
    // Kept if AliceBattleRef fails or for specific interactions
    updateBattleUI() {
        const pBar = document.querySelector("#screen-final-boss .warden .hp"); // Note: ID might be different
        const vBar = document.querySelector("#screen-final-boss .villain .hp"); // This seems to target 'Simple Battle' DOM?
        if (pBar) pBar.style.width = `${this.aliceBattleState.playerHp}%`;
        if (vBar) vBar.style.width = `${this.aliceBattleState.villainHp}%`;
    }

    handleBattleAction(type) {
        if (!this.aliceBattleState.isPlayerTurn) return;

        console.log(`[GameLogic] Player used ${type}`);
        this.aliceBattleState.isPlayerTurn = false;

        // Logic...
        let dmg = 20;
        if (type === 'ink') dmg = 15; if (type === 'rune') dmg = 25; if (type === 'gem') dmg = 35;

        this.aliceBattleState.villainHp = Math.max(0, this.aliceBattleState.villainHp - dmg);
        this.updateBattleUI();

        if (this.aliceBattleState.villainHp <= 0) {
            setTimeout(() => this.winBattle(), 500);
            return;
        }

        // Villain Turn
        setTimeout(() => {
            this.aliceBattleState.playerHp = Math.max(0, this.aliceBattleState.playerHp - 10);
            this.updateBattleUI();
            this.aliceBattleState.isPlayerTurn = true;
        }, 800);
    }

    winBattle() {
        console.log("VICTORY");
        const bossScreen = document.getElementById("screen-final-boss");
        if (bossScreen) bossScreen.style.animation = "shake 0.5s ease-in-out";
        setTimeout(() => this.goToNewScore(), 1500);
    }

    goToNewScore() {
        this.game.switchScreen("screen-new-score");

        // Fix Layout & Interaction as per original code
        const screen = document.getElementById('screen-new-score');
        if (screen) {
            screen.scrollTop = 0;
            screen.style.zIndex = "100000";
            screen.style.pointerEvents = "auto";
            const input = document.getElementById('warden-email');
            if (input) input.style.pointerEvents = "auto";
        }

        // Data Logic
        const score = this.game.scoreManager || {};
        const wpm = score.wpm || 0;
        const ink = score.ink || 0; // Or fetch from DOM
        const rune = score.runes || 0;
        const gem = score.gems || 0;

        // Animations
        this.game.uiManager.animateValue("report-wpm", 0, wpm, 1500);
        // ... other animations (simplified for this file, can move full logic here)
        this.game.uiManager.animateValue("report-ink-count", 0, ink, 1000);
        this.game.uiManager.animateValue("report-rune-count", 0, rune, 1000, "", "", 200);
        this.game.uiManager.animateValue("report-gem-count", 0, gem, 1000, "", "", 400);

        // Rank Logic
        let rankText = 'Novice';
        let rankColor = '#aaa';
        if (wpm >= 250) { rankText = 'Master'; rankColor = 'gold'; }
        else if (wpm >= 150) { rankText = 'Apprentice'; rankColor = '#00ff00'; }

        const rankEl = document.getElementById('report-rank-text');
        if (rankEl) {
            rankEl.innerText = rankText;
            rankEl.style.color = rankColor;
        }
    }

    goToNewSignup() { this.game.switchScreen('screen-new-signup'); }
    goToNewShare() {
        const emailInput = document.querySelector("#screen-new-signup input[type='email']");
        if (emailInput && emailInput.value) console.log("Email:", emailInput.value);
        this.game.switchScreen('screen-new-share');
    }
}
