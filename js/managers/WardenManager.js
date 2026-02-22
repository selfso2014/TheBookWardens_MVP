export class WardenManager {
    constructor(gameRef) {
        this.game = gameRef;
        this.email = localStorage.getItem('warden_email') || null;
        this.bindWarden = this.bindWarden.bind(this);
    }

    // --- Core Function: Soul Bind (Email Capture) ---
    bindWarden() {
        console.log("[WardenManager] Soul Binding Initiated...");

        const emailInput = document.getElementById('warden-email');
        let email = emailInput ? emailInput.value : '';

        // Bypass Validation for MVP (or implement regex if needed)
        if (!email) {
            console.warn("[WardenManager] No email provided. Using anonymous placeholder.");
            email = "anonymous_warden@test.com";
        }

        this.email = email;
        localStorage.setItem('warden_email', email);
        localStorage.setItem('chapter_1_unlocked', 'true');

        // Visual Feedback
        this._triggerButtonEffect();

        // Store Data (Async)
        this._saveToFirebase();

        // Transition Logic
        this._transitionToShareScreen();
    }

    _triggerButtonEffect() {
        const btn = document.querySelector('#bind-form button');
        if (btn) {
            btn.innerText = "✨ SOUL BOUND ✨";
            btn.style.background = "#fff";
            btn.style.color = "#000"; // Contrast for white background
            btn.disabled = true;
        }
    }

    _transitionToShareScreen() {
        setTimeout(() => {
            console.log("[WardenManager] Transitioning to Share Screen...");

            // [FIX #12] Use Game.switchScreen() instead of direct DOM manipulation.
            // Direct DOM manipulation bypasses clearAllResources() + lifecycle hooks.
            if (window.Game && typeof window.Game.switchScreen === 'function') {
                window.Game.switchScreen('screen-new-share');
            } else {
                // Fallback: direct DOM (only if Game not ready)
                const shareScreen = document.getElementById('screen-new-share');
                if (shareScreen) {
                    shareScreen.style.display = 'flex';
                    shareScreen.classList.add('active');
                    shareScreen.style.zIndex = "100000";
                    shareScreen.style.pointerEvents = "auto";
                    const oldScreen = document.getElementById('screen-new-score');
                    if (oldScreen) oldScreen.style.display = 'none';
                } else {
                    // [FIX #12] alert() 제거 → console.error만
                    console.error("[WardenManager] Share Screen Not Found!");
                }
            }
        }, 500);
    }

    async _saveToFirebase() {
        try {
            if (window.firebase && window.FIREBASE_CONFIG && !firebase.apps.length) {
                firebase.initializeApp(window.FIREBASE_CONFIG);
            }

            const score = (this.game && this.game.scoreManager) ? this.game.scoreManager : {};

            // Construct Data Payload
            const wardenData = {
                email: this.email,
                wpm: score.wpm || 0,
                ink: score.ink || 0,
                runes: score.runes || 0,
                gems: score.gems || 0,
                chapter: 'The Rabbit Hole',
                timestamp: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
                device: navigator.userAgent
            };

            if (window.firebase && firebase.firestore) {
                await firebase.firestore().collection("wardens").add(wardenData);
                console.log("[WardenManager] Data saved to Firebase.");
            } else {
                console.warn("[WardenManager] Firebase SDK not ready. Data stored locally only.");
            }
        } catch (e) {
            console.error("[WardenManager] Firebase Save Error:", e);
        }
    }
}
window.WardenManager = WardenManager;
