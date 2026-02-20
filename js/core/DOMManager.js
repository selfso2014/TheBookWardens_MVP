export class DOMManager {
    constructor(game) {
        this.game = game;
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        console.log("[DOMManager] Initializing Global Event Bindings...");

        // 1. Splash Screen
        this.bind('screen-splash', 'click', () => {
            if (this.game.introManager) this.game.introManager.dismissSplash();
        });

        // 2. WPM Buttons (Data Attribute Based)
        const wpmBtns = document.querySelectorAll('.wpm-btn');
        wpmBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const wpm = parseInt(target.getAttribute('data-wpm'));
                if (wpm && !isNaN(wpm)) {
                    this.game.selectWPM(wpm, target);
                } else {
                    console.warn("[DOMManager] WPM button missing data-wpm", target);
                }
            });
        });

        // 3. Vocab Options (Word Forge)
        const vocabBtns = document.querySelectorAll('.option-btn');
        vocabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                if (!isNaN(index)) {
                    this.game.vocabManager.checkVocab(index, e);
                }
            });
        });

        // 4. Owl (Start Reading)
        this.bind('btn-owl-start', 'click', () => {
            this.game.startReadingFromOwl();
        });

        // 5. Confront Villain
        this.bind('btn-confront-villain', 'click', () => {
            this.game.confrontVillain();
        });

        // 6. Victory Screen Actions
        this.bind('btn-review', 'click', () => {
            if (this.game.typewriter) this.game.typewriter.showFullTextReview();
        });

        this.bind('btn-export', 'click', () => {
            if (window.gazeDataManager) window.gazeDataManager.exportCSV();
        });

        this.bind('btn-share-summary', 'click', () => {
            if (this.game.typewriter) this.game.typewriter.showSummaryShare();
        });

        // 7. Share Screen Actions
        this.bind('btn-share-final', 'click', () => {
            if (this.game.typewriter) this.game.typewriter.shareResult();
        });

        this.bind('btn-home', 'click', () => location.reload());

        // 8. Warden Claim (Reward)
        this.bind('btn-claim-reward', 'click', (e) => {
            // Check if WardenManager is instantiated in Game, else force init?
            // Game.bindKeyAndUnlock_V2 handles logic (lazy init).
            this.game.bindKeyAndUnlock_V2();
        });

        // 9. Signup / Share Flow
        this.bind('btn-signup-now', 'click', () => this.game.goToNewShare());
        this.bind('btn-signup-skip', 'click', () => this.game.goToNewShare());

        this.bind('btn-return-lobby', 'click', () => {
            const share = document.getElementById('screen-new-share');
            if (share) share.style.display = 'none';
            this.game.switchScreen('screen-home');
            location.reload();
        });

        // 10. Alice Battle Cards (Direct ID binding)
        ['ink', 'rune', 'gem'].forEach(type => {
            const id = `card-${type}`;
            this.bind(id, 'click', () => {
                if (window.AliceBattleRef && typeof window.AliceBattleRef.triggerAttack === 'function') {
                    window.AliceBattleRef.triggerAttack(type);
                } else {
                    // Fallback to simpler logic or direct game call
                    this.game.handleBattleAction(type);
                }
            });
        });

        // 11. Alice Battle Restart
        this.bind('alice-restart-btn', 'click', () => {
            if (window.AliceBattleRef) window.AliceBattleRef.init();
        });

        // 12. Dummy Click (If it exists)
        // this.bind('dummy-overlay', 'click', () => this.game.endFinalBossDummy()); 
        // Logic seems missing so ignoring.
    }

    bind(id, event, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, handler);
            // [FIX] Store reference so unbindAll() can remove it later
            if (!this._listeners) this._listeners = [];
            this._listeners.push({ el, event, handler });
        }
    }

    // [FIX] Remove all listeners registered via bind()
    // Call this if DOMManager needs to be torn down (e.g. after game-over and page reload)
    unbindAll() {
        if (!this._listeners) return;
        this._listeners.forEach(({ el, event, handler }) => {
            el.removeEventListener(event, handler);
        });
        this._listeners = [];
        console.log('[DOMManager] All event listeners unbound.');
    }
}
