export const AliceBattle = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    lightnings: [],
    flashOpacity: 0,
    shakeTime: 0,
    gameState: 'playing',
    villainHP: 100,
    wardenHP: 100,
    animFrameId: null,

    cardValues: { ink: 190, rune: 30, gem: 50 },
    decreaseAmount: { ink: 10, rune: 5, gem: 8 },
    vCardValues: { queen: 100, king: 60, joker: 40 },
    vDecreaseAmount: { queen: 20, king: 12, joker: 8 },

    aliceStory: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'",

    // DOM Elements
    ui: {
        gameUi: null,
        villainHp: null,
        wardenHp: null,
        log: null,
        finalScreen: null,
        storyDisplay: null,
        resultHeader: null,
        restartBtn: null
    },

    init() {
        alert("Debug: AliceBattle.init() STARTED!");
        try {
            console.log("Initializing Alice Battle...");
            const container = document.getElementById('screen-alice-battle');
            if (container) {
                container.style.display = 'flex';
                container.classList.add('active');
            } else {
                alert("CRITICAL: Container #screen-alice-battle NOT FOUND!");
            }

            this.canvas = document.getElementById('alice-canvas');
            if (!this.canvas) {
                alert("CRITICAL: Canvas #alice-canvas NOT FOUND!");
                return;
            }
            this.ctx = this.canvas.getContext('2d');

            this.ui.gameUi = document.getElementById('alice-game-ui');
            if (!this.ui.gameUi) alert("CRITICAL: #alice-game-ui NOT FOUND!");

            this.ui.villainHp = document.getElementById('villain-hp');
            this.ui.wardenHp = document.getElementById('warden-hp');
            this.ui.log = document.getElementById('al-log');
            this.ui.finalScreen = document.getElementById('alice-final-screen');
            this.ui.storyDisplay = document.getElementById('story-display');
            this.ui.resultHeader = document.getElementById('result-header');
            this.ui.restartBtn = document.getElementById('alice-restart-btn');

            this.resize();
            window.addEventListener('resize', () => this.resize());

            // Reset State
            alert("Debug: Resetting Game State...");
            this.resetGame();

            // Start Loop
            if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
            this.animate();
            alert("Debug: AliceBattle Init COMPLETE! Loop Started.");

        } catch (e) {
            alert("CRITICAL INIT ERROR: " + e.message);
            console.error(e);
        }
    },

    resize() {
        if (!this.canvas) return;
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;
    },

    resetGame() {
        this.villainHP = 100;
        this.wardenHP = 100;
        this.gameState = 'playing';

        this.cardValues = { ink: 190, rune: 30, gem: 50 };
        this.vCardValues = { queen: 100, king: 60, joker: 40 };

        if (this.ui.villainHp) this.ui.villainHp.style.width = '100%';
        if (this.ui.wardenHp) this.ui.wardenHp.style.width = '100%';
        if (this.ui.gameUi) this.ui.gameUi.style.opacity = '1';
        if (this.ui.finalScreen) this.ui.finalScreen.classList.remove('active');
        if (this.ui.log) this.ui.log.innerText = "Battle started...";

        document.querySelectorAll('.alice-rift').forEach(r => r.remove());
        this.updateCardDisplay();
    },

    updateCardDisplay() {
        for (const key in this.cardValues) {
            const valEl = document.getElementById(`val-${key}`);
            const cardEl = document.getElementById(`card-${key}`);
            if (valEl) valEl.innerText = Math.max(0, this.cardValues[key]);
            if (cardEl) {
                if (this.cardValues[key] <= 0) cardEl.classList.add('disabled');
                else cardEl.classList.remove('disabled');
            }
        }
        for (const key in this.vCardValues) {
            const valEl = document.getElementById(`v-val-${key}`);
            const cardEl = document.getElementById(`v-card-${key}`);
            if (valEl) valEl.innerText = Math.max(0, this.vCardValues[key]);
            if (cardEl) {
                if (this.vCardValues[key] <= 0) cardEl.classList.add('disabled');
                else cardEl.classList.remove('disabled');
            }
        }
    },

    triggerAttack(type) {
        if (this.gameState !== 'playing' || this.cardValues[type] <= 0) return;

        const wAvatar = document.getElementById('warden-avatar');
        const vAvatar = document.getElementById('villain-avatar');
        if (!wAvatar || !vAvatar) return;

        const wBox = wAvatar.getBoundingClientRect();
        const vBox = vAvatar.getBoundingClientRect();

        let color = '#00ffff', damage = 10, count = 1;

        if (type === 'ink') { color = '#b300ff'; count = 1; damage = 25; this.ui.log.innerText = "Ink Splash Attack!"; }
        if (type === 'rune') { color = '#00f2ff'; count = 2; damage = 15; this.ui.log.innerText = "Rune Cast!"; }
        if (type === 'gem') { color = '#ffffff'; count = 3; damage = 20; this.ui.log.innerText = "Gemlight Burst!"; }

        this.cardValues[type] = Math.max(0, this.cardValues[type] - this.decreaseAmount[type]);
        this.updateCardDisplay();

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                if (this.gameState !== 'playing') return;
                this.lightnings.push(new Lightning(wBox.left + wBox.width / 2, wBox.top, vBox.left + vBox.width / 2, vBox.bottom, false, 0, color));
                this.flashOpacity = 0.2;
                this.shakeTime = 8;
                this.dealDamage('villain', damage / count);
            }, i * 140);
        }

        setTimeout(() => {
            if (this.gameState === 'playing' && this.villainHP > 0) this.villainCounter();
        }, 900);
    },

    villainCounter() {
        if (this.gameState !== 'playing') return;
        const wAvatar = document.getElementById('warden-avatar');
        const vAvatar = document.getElementById('villain-avatar');
        if (!wAvatar || !vAvatar) return;

        const wBox = wAvatar.getBoundingClientRect();
        const vBox = vAvatar.getBoundingClientRect();

        const availableCards = Object.keys(this.vCardValues).filter(key => this.vCardValues[key] > 0);

        if (availableCards.length === 0) {
            this.ui.log.innerText = "Red Queen is fading...";
            this.lightnings.push(new Lightning(vBox.left + vBox.width / 2, vBox.bottom, wBox.left + wBox.width / 2, wBox.top, false, 0, '#664444'));
            this.dealDamage('warden', 3);
            return;
        }

        const chosenKey = availableCards[Math.floor(Math.random() * availableCards.length)];
        let damage = 10;
        if (chosenKey === 'queen') damage = 20;
        if (chosenKey === 'king') damage = 15;
        if (chosenKey === 'joker') damage = 10;

        this.vCardValues[chosenKey] = Math.max(0, this.vCardValues[chosenKey] - this.vDecreaseAmount[chosenKey]);
        this.updateCardDisplay();

        setTimeout(() => {
            this.lightnings.push(new Lightning(vBox.left + vBox.width / 2, vBox.bottom, wBox.left + wBox.width / 2, wBox.top, false, 0, '#ff0044'));
            this.flashOpacity = 0.25;
            this.shakeTime = 12;
            this.dealDamage('warden', damage);
        }, 50);
    },

    dealDamage(target, amount) {
        if (this.gameState !== 'playing') return;
        if (target === 'villain') {
            this.villainHP = Math.max(0, this.villainHP - amount);
            if (this.ui.villainHp) this.ui.villainHp.style.width = this.villainHP + '%';
            if (this.villainHP <= 0) this.endGame('victory');
        } else {
            this.wardenHP = Math.max(0, this.wardenHP - amount);
            if (this.ui.wardenHp) this.ui.wardenHp.style.width = this.wardenHP + '%';
            if (this.wardenHP <= 0) this.endGame('defeat');
        }
    },

    endGame(result) {
        this.gameState = result;
        if (this.ui.gameUi) this.ui.gameUi.style.opacity = '0';

        setTimeout(() => {
            if (this.ui.finalScreen) this.ui.finalScreen.classList.add('active');

            if (result === 'victory') {
                this.ui.resultHeader.innerText = "VICTORY";
                this.ui.resultHeader.style.color = "#4da6ff";
                this.ui.storyDisplay.innerHTML = `<div class="story-clean">${this.aliceStory}</div>`;
            } else {
                this.ui.resultHeader.innerText = "DEFEAT";
                this.ui.resultHeader.style.color = "#ff4d4d";
                this.ui.storyDisplay.innerHTML = `<div class="story-corrupted">${this.corruptText(this.aliceStory)}</div>`;
                this.createRifts();
            }
        }, 1000);
    },

    createRifts() {
        if (!this.ui.finalScreen) return;
        for (let i = 0; i < 35; i++) {
            const rift = document.createElement('div');
            rift.className = 'alice-rift';
            const isVertical = Math.random() > 0.5;
            rift.style.width = isVertical ? '2px' : (Math.random() * 400 + 100) + 'px';
            rift.style.height = isVertical ? (Math.random() * 400 + 100) + 'px' : '2px';
            rift.style.left = Math.random() * 100 + 'vw';
            rift.style.top = Math.random() * 100 + 'vh';
            rift.style.transform = `rotate(${Math.random() * 360}deg)`;
            this.ui.finalScreen.appendChild(rift);
        }
    },

    corruptText(text) {
        const chars = "☠️☣️#!@$%^&*()_+-=[]{}|;':,./<>?0123456789";
        return text.split('').map(c => (c === ' ' || Math.random() < 0.6) ? c : chars[Math.floor(Math.random() * chars.length)]).join('');
    },

    animate() {
        if (!this.ctx) return;
        // Clear canvas
        this.ctx.clearRect(0, 0, this.width, this.height);

        this.ctx.save();
        if (this.flashOpacity > 0) {
            this.ctx.fillStyle = `rgba(255, 255, 255, ${this.flashOpacity})`;
            this.ctx.fillRect(0, 0, this.width, this.height);
            this.flashOpacity -= 0.05;
        }
        if (this.shakeTime > 0) {
            this.ctx.translate((Math.random() - 0.5) * this.shakeTime, (Math.random() - 0.5) * this.shakeTime);
            this.shakeTime--;
        }
        for (let i = this.lightnings.length - 1; i >= 0; i--) {
            this.lightnings[i].draw(this.ctx);
            if (this.lightnings[i].opacity <= 0) this.lightnings.splice(i, 1);
        }
        this.ctx.restore();
        this.animFrameId = requestAnimationFrame(() => this.animate());
    }
};

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

        // Color override for villain (simple logic)
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
                // Add Branch -> access global AliceBattle instance? Or Pass array?
                // For simplicity, access AliceBattle.lightnings
                AliceBattle.lightnings.push(new Lightning(nextX, nextY, nextX + (Math.random() - 0.5) * 300, nextY + (Math.random() - 0.5) * 300, true, this.depth + 1, this.color));
            }
            curX = nextX; curY = nextY;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = this.opacity * 0.4;
        ctx.lineWidth = this.baseWidth * 4;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        this.renderPath(ctx);
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = this.opacity;
        ctx.lineWidth = this.baseWidth * 0.6;
        this.renderPath(ctx);
        ctx.restore();
        this.opacity -= 0.08;
    }

    renderPath(ctx) {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.segments.forEach(s => { ctx.moveTo(s.x, s.y); ctx.lineTo(s.nextX, s.nextY); });
        ctx.stroke();
    }
}
