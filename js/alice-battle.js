
/* alice-battle.js - Refactored to Closure Scope (Global-like) */

// --- MODULE SCOPE VARIABLES (Friend's Code Style) ---
let canvas, ctx, width, height;
let lightnings = [];
let flashOpacity = 0;
let shakeTime = 0;
let gameState = 'playing';
let animFrameId = null;

let villainHP = 100;
let wardenHP = 100;

const cardValues = { ink: 190, rune: 30, gem: 50 };
const decreaseAmount = { ink: 10, rune: 5, gem: 8 };
const vCardValues = { queen: 100, king: 60, joker: 40 };
const vDecreaseAmount = { queen: 20, king: 12, joker: 8 };

const aliceStory = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'";

// UI Cache
let ui = {
    gameUi: null, villainHp: null, wardenHp: null, log: null,
    finalScreen: null, storyDisplay: null, resultHeader: null, restartBtn: null
};

// --- LIGHTNING CLASS (Accesses module variables directly) ---
class Lightning {
    constructor(startX, startY, targetX, targetY, isBranch = false, depth = 0, color = '#00ffff') {
        this.segments = [];
        this.startX = startX;
        this.startY = startY;
        this.targetX = targetX;
        this.targetY = targetY;
        this.opacity = 1.0;
        this.depth = depth;
        this.color = color;

        const originalBaseWidth = isBranch ? (3 - depth) : (color === '#ff0055' ? 10 : 8);
        this.baseWidth = originalBaseWidth * 0.6;
        this.generateSegments();
    }

    generateSegments() {
        let curX = this.startX;
        let curY = this.startY;
        const dx = this.targetX - this.startX;
        const dy = this.targetY - this.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const segmentCount = Math.max(6, Math.floor(distance / 25));

        for (let i = 0; i <= segmentCount; i++) {
            const progress = i / segmentCount;
            let nextX = this.startX + dx * progress + (Math.random() - 0.5) * (distance * 0.15);
            let nextY = this.startY + dy * progress + (Math.random() - 0.5) * 30;
            if (i === segmentCount) { nextX = this.targetX; nextY = this.targetY; }
            this.segments.push({ x: curX, y: curY, nextX, nextY });

            if (this.depth < 2 && Math.random() > 0.85 && i > 0 && i < segmentCount) {
                // DIRECT ACCESS TO LIGHTNINGS ARRAY (No 'this' confusion)
                lightnings.push(new Lightning(nextX, nextY, nextX + (Math.random() - 0.5) * 300, nextY + (Math.random() - 0.5) * 300, true, this.depth + 1, this.color));
            }
            curX = nextX; curY = nextY;
        }
    }

    draw() {
        if (!ctx) return;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over'; // Safe mode
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = this.opacity; // Full brightness
        ctx.lineWidth = this.baseWidth * 4;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        this.renderPath();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = this.opacity;
        ctx.lineWidth = this.baseWidth * 0.6;
        this.renderPath();
        ctx.restore();
        this.opacity -= 0.08;
    }

    renderPath() {
        if (!ctx) return;
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.segments.forEach(s => { ctx.moveTo(s.x, s.y); ctx.lineTo(s.nextX, s.nextY); });
        ctx.stroke();
    }
}

// --- CORE FUNCTIONS (Global-like) ---

function resize() {
    if (!canvas) return;
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

function updateCardDisplay() {
    for (const key in cardValues) {
        const valEl = document.getElementById(`val-${key}`);
        const cardEl = document.getElementById(`card-${key}`);
        if (valEl) valEl.innerText = Math.max(0, cardValues[key]);
        if (cardEl) cardEl.classList.toggle('disabled', cardValues[key] <= 0);
    }
    for (const key in vCardValues) {
        const valEl = document.getElementById(`v-val-${key}`);
        const cardEl = document.getElementById(`v-card-${key}`);
        if (valEl) valEl.innerText = Math.max(0, vCardValues[key]);
        if (cardEl) cardEl.classList.toggle('disabled', vCardValues[key] <= 0);
    }
}

function dealDamage(target, amount) {
    if (gameState !== 'playing') return;
    if (target === 'villain') {
        villainHP = Math.max(0, villainHP - amount);
        if (ui.villainHp) ui.villainHp.style.width = villainHP + '%';
        if (villainHP <= 0) endGame('victory');
    } else {
        wardenHP = Math.max(0, wardenHP - amount);
        if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';
        if (wardenHP <= 0) endGame('defeat');
    }
}

function endGame(result) {
    gameState = result;
    if (ui.gameUi) ui.gameUi.style.opacity = '0';

    setTimeout(() => {
        if (ui.finalScreen) ui.finalScreen.classList.add('active');

        if (result === 'victory') {
            // [NEW] Push Battle Results to Score Manager (Source of Truth: HUD DOM)
            if (window.Game && window.Game.scoreManager) {
                const inkVal = parseInt(document.getElementById('val-ink').innerText) || 0;
                const runeVal = parseInt(document.getElementById('val-rune').innerText) || 0;
                const gemVal = parseInt(document.getElementById('val-gem').innerText) || 0;

                console.log(`[AliceBattle] Victory! Saving resources from HUD: Ink=${inkVal}, Rune=${runeVal}, Gem=${gemVal}`);

                window.Game.scoreManager.ink = inkVal;
                window.Game.scoreManager.runes = runeVal;
                window.Game.scoreManager.gems = gemVal;
            }

            if (ui.resultHeader) {
                ui.resultHeader.innerText = "VICTORY";
                ui.resultHeader.style.color = "#4da6ff";
            }
            if (ui.storyDisplay) ui.storyDisplay.innerHTML = `<div class="story-clean">${aliceStory}</div>`;

            // [NEW] Configure Button for Next Step
            if (ui.restartBtn) {
                ui.restartBtn.innerText = "VIEW REPORT";
                ui.restartBtn.style.background = "#ffd700";
                ui.restartBtn.style.color = "#000";
                ui.restartBtn.onclick = () => {
                    if (window.Game) window.Game.goToNewScore();
                };
            }

        } else {
            // DEFEAT
            if (ui.resultHeader) {
                ui.resultHeader.innerText = "DEFEAT";
                ui.resultHeader.style.color = "#ff4d4d";
            }
            if (ui.storyDisplay) ui.storyDisplay.innerHTML = `<div class="story-corrupted">${corruptText(aliceStory)}</div>`;
            createRifts();

            // Config Button for Retry
            if (ui.restartBtn) {
                ui.restartBtn.innerText = "TRY AGAIN";
                ui.restartBtn.style.background = "#ff4d4d";
                ui.restartBtn.style.color = "#fff";
                ui.restartBtn.onclick = () => {
                    AliceBattle.init(); // Restart Battle
                };
            }
        }
    }, 1000);
}

function createRifts() {
    if (!ui.finalScreen) return;
    for (let i = 0; i < 35; i++) {
        const rift = document.createElement('div');
        rift.className = 'alice-rift';
        const isVertical = Math.random() > 0.5;
        rift.style.width = isVertical ? '2px' : (Math.random() * 400 + 100) + 'px';
        rift.style.height = isVertical ? (Math.random() * 400 + 100) + 'px' : '2px';
        rift.style.left = Math.random() * 100 + 'vw';
        rift.style.top = Math.random() * 100 + 'vh';
        rift.style.transform = `rotate(${Math.random() * 360}deg)`;
        ui.finalScreen.appendChild(rift);
    }
}

function corruptText(text) {
    const chars = "☠️☣️#!@$%^&*()_+-=[]{}|;':,./<>?0123456789";
    return text.split('').map(c => (c === ' ' || Math.random() < 0.6) ? c : chars[Math.floor(Math.random() * chars.length)]).join('');
}

function animateLoop() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    if (flashOpacity > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
        ctx.fillRect(0, 0, width, height);
        flashOpacity -= 0.05;
    }
    if (shakeTime > 0) {
        ctx.translate((Math.random() - 0.5) * shakeTime, (Math.random() - 0.5) * shakeTime);
        shakeTime--;
    }
    for (let i = lightnings.length - 1; i >= 0; i--) {
        lightnings[i].draw();
        if (lightnings[i].opacity <= 0) lightnings.splice(i, 1);
    }
    ctx.restore();
    animFrameId = requestAnimationFrame(animateLoop);
}

// --- EXPORTED OBJECT (Bridge) ---
export const AliceBattle = {
    init() {
        try {
            console.log("Initializing Alice Battle (Closure Mode)...");
            const container = document.getElementById('screen-alice-battle');
            if (container) {
                container.style.display = 'flex';
                container.classList.add('active');
            }

            canvas = document.getElementById('alice-canvas');
            if (!canvas) { console.error("Canvas missing"); return; }

            ctx = canvas.getContext('2d');

            // UI References
            ui.gameUi = document.getElementById('alice-game-ui');
            ui.villainHp = document.getElementById('villain-hp');
            ui.wardenHp = document.getElementById('warden-hp');
            ui.log = document.getElementById('al-log');
            ui.finalScreen = document.getElementById('alice-final-screen');
            ui.storyDisplay = document.getElementById('story-display');
            ui.resultHeader = document.getElementById('result-header');
            ui.restartBtn = document.getElementById('alice-restart-btn');

            window.addEventListener('resize', resize);
            resize();

            // Reset Game
            // Reset Game
            villainHP = 100;
            wardenHP = 100;
            gameState = 'playing';
            lightnings = [];

            if (ui.villainHp) ui.villainHp.style.width = '100%';
            if (ui.wardenHp) ui.wardenHp.style.width = '100%';
            if (ui.gameUi) ui.gameUi.style.opacity = '1';
            if (ui.finalScreen) ui.finalScreen.classList.remove('active');
            if (ui.log) ui.log.innerText = "Battle started...";

            // [NEW] Load Resources from ScoreManager (Real Player Stats)
            if (window.Game && window.Game.scoreManager) {
                const sm = window.Game.scoreManager;
                console.log("[AliceBattle] Loading resources from ScoreManager:", sm);

                // If scoreManager has values, use them. Otherwise default.
                cardValues.ink = (sm.ink > 0) ? sm.ink : 190;
                cardValues.rune = (sm.runes > 0) ? sm.runes : 30;
                cardValues.gem = (sm.gems > 0) ? sm.gems : 50;
            } else {
                // Default Fallback
                cardValues.ink = 190; cardValues.rune = 30; cardValues.gem = 50;
            }

            vCardValues.queen = 100; vCardValues.king = 60; vCardValues.joker = 40;
            updateCardDisplay();

            if (animFrameId) cancelAnimationFrame(animFrameId);
            animateLoop();

        } catch (e) {
            console.error("Init Error:", e);
        }
    },

    triggerAttack(type) {
        if (gameState !== 'playing' || cardValues[type] <= 0) return;

        const wAvatar = document.getElementById('warden-avatar');
        const vAvatar = document.getElementById('villain-avatar');
        if (!wAvatar || !vAvatar) return;

        let wBox = wAvatar.getBoundingClientRect();
        let vBox = vAvatar.getBoundingClientRect();

        // Fallback
        if (wBox.width === 0) wBox = { left: window.innerWidth * 0.2, top: window.innerHeight * 0.6, width: 100, height: 100, bottom: window.innerHeight * 0.6 + 100 };
        if (vBox.width === 0) vBox = { left: window.innerWidth * 0.8, top: window.innerHeight * 0.2, width: 100, height: 100, bottom: window.innerHeight * 0.2 + 100 };

        let color = '#00ffff', damage = 10, count = 1;

        if (type === 'ink') { color = '#b300ff'; count = 1; damage = 25; ui.log.innerText = "Ink Splash Attack!"; }
        if (type === 'rune') { color = '#00f2ff'; count = 2; damage = 15; ui.log.innerText = "Rune Cast!"; }
        if (type === 'gem') { color = '#ffffff'; count = 3; damage = 20; ui.log.innerText = "Gemlight Burst!"; }

        cardValues[type] = Math.max(0, cardValues[type] - decreaseAmount[type]);
        updateCardDisplay();

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                if (gameState !== 'playing' || villainHP <= 0) return;
                // PUSH TO CLOSURE VARIABLE
                lightnings.push(new Lightning(wBox.left + wBox.width / 2, wBox.top, vBox.left + vBox.width / 2, vBox.bottom, false, 0, color));
                flashOpacity = 0.2;
                shakeTime = 8;
                dealDamage('villain', damage / count);
            }, i * 140);
        }

        setTimeout(() => {
            if (gameState === 'playing' && villainHP > 0) this.villainCounter();
        }, 900);
    },

    villainCounter() {
        if (gameState !== 'playing') return;
        const wAvatar = document.getElementById('warden-avatar');
        const vAvatar = document.getElementById('villain-avatar');
        if (!wAvatar || !vAvatar) return;

        const wBox = wAvatar.getBoundingClientRect();
        const vBox = vAvatar.getBoundingClientRect();

        const availableCards = Object.keys(vCardValues).filter(key => vCardValues[key] > 0);

        if (availableCards.length === 0) {
            ui.log.innerText = "Red Queen is fading...";
            lightnings.push(new Lightning(vBox.left + vBox.width / 2, vBox.bottom, wBox.left + wBox.width / 2, wBox.top, false, 0, '#664444'));
            dealDamage('warden', 3);
            return;
        }

        const chosenKey = availableCards[Math.floor(Math.random() * availableCards.length)];
        let damage = 10;
        if (chosenKey === 'queen') damage = 20;

        vCardValues[chosenKey] = Math.max(0, vCardValues[chosenKey] - vDecreaseAmount[chosenKey]);
        updateCardDisplay();

        setTimeout(() => {
            lightnings.push(new Lightning(vBox.left + vBox.width / 2, vBox.bottom, wBox.left + wBox.width / 2, wBox.top, false, 0, '#ff0044'));
            flashOpacity = 0.25; shakeTime = 12; dealDamage('warden', damage);
        }, 50);
    },

    resetGame() {
        // Redundant but keeping interface
        villainHP = 100;
        wardenHP = 100;
        gameState = 'playing';
        lightnings = [];
        updateCardDisplay();
        if (ui.gameUi) ui.gameUi.style.opacity = '1';
        if (ui.finalScreen) ui.finalScreen.classList.remove('active');
    }
};
