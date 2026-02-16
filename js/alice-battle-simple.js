// alice-battle-simple.js (No Modules, Pure Global Script)

(function () {
    console.log("Loading AliceBattle Simple Script (Text Conquest Mode)...");

    // Private Variables
    let canvas, ctx, width, height;
    let lightnings = [];
    let flashOpacity = 0;
    let shakeTime = 0;
    let gameState = 'playing';
    let animFrameId = null;

    let totalChars = 0;
    let grayChars = 0; // Villain HP is based on this
    let wardenHP = 100;

    const cardValues = { ink: 190, rune: 30, gem: 50 };
    const decreaseAmount = { ink: 10, rune: 5, gem: 8 };

    // Villain Attack Settings
    const villainCooldownBase = 2000; // ms
    let lastVillainAttackTime = 0;

    const aliceStory = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'";

    // UI Cache
    let ui = {
        gameUi: null, villainHp: null, wardenHp: null, log: null,
        finalScreen: null, storyDisplay: null, resultHeader: null, restartBtn: null,
        textField: null
    };

    // Lightning Class (Visuals)
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

            // Make it Thinner!
            const originalBaseWidth = isBranch ? (1.5 - depth * 0.5) : (color === '#ff0055' ? 4 : 3);
            this.baseWidth = Math.max(0.5, originalBaseWidth * 0.5); // Much thinner
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
                    lightnings.push(new Lightning(nextX, nextY, nextX + (Math.random() - 0.5) * 300, nextY + (Math.random() - 0.5) * 300, true, this.depth + 1, this.color));
                }
                curX = nextX; curY = nextY;
            }
        }

        draw() {
            if (!ctx) return;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = this.color;
            ctx.globalAlpha = this.opacity;
            ctx.lineWidth = this.baseWidth * 2;
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
            this.renderPath();
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = this.opacity;
            ctx.lineWidth = this.baseWidth * 0.8;
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

    // Functions
    function resize() {
        if (!canvas) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function initTextBattlefield() {
        if (!ui.textField) return;
        ui.textField.innerHTML = '';
        totalChars = 0;
        grayChars = 0;

        const words = aliceStory.split(' ');
        words.forEach((word, wordIdx) => {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'b-word';
            wordSpan.dataset.wordIndex = wordIdx;
            wordSpan.style.display = 'inline-block';
            wordSpan.style.marginRight = '5px';
            wordSpan.style.whiteSpace = 'nowrap';

            for (let i = 0; i < word.length; i++) {
                const charSpan = document.createElement('span');
                charSpan.className = 'b-char gray'; // Init as Gray
                charSpan.innerText = word[i];
                charSpan.id = `char-${wordIdx}-${i}`; // Unique ID for targeting
                charSpan.style.transition = 'color 0.5s, text-shadow 0.3s';
                charSpan.style.color = '#666'; // Visual Gray
                charSpan.dataset.state = 'gray'; // Logical State

                wordSpan.appendChild(charSpan);
                totalChars++;
                grayChars++;
            }
            ui.textField.appendChild(wordSpan);
        });

        updateVillainHP();
    }

    function updateVillainHP() {
        const hpPercent = (grayChars / totalChars) * 100;
        if (ui.villainHp) ui.villainHp.style.width = hpPercent + '%';
        if (grayChars <= 0) endGame('victory');
    }

    function updateCardDisplay() {
        for (const key in cardValues) {
            const valEl = document.getElementById(`val-${key}`);
            const cardEl = document.getElementById(`card-${key}`);
            if (valEl) valEl.innerText = Math.max(0, cardValues[key]);
            if (cardEl) cardEl.classList.toggle('disabled', cardValues[key] <= 0);
        }
    }

    function changeCharState(charEl, newState) {
        if (!charEl || charEl.dataset.state === newState) return false;

        charEl.dataset.state = newState;
        if (newState === 'white') {
            charEl.classList.remove('gray');
            charEl.classList.add('white');
            charEl.style.color = '#fff';
            charEl.style.textShadow = '0 0 10px #fff, 0 0 20px cyan';
            grayChars--;
            setTimeout(() => { charEl.style.textShadow = 'none'; }, 500);
        } else {
            charEl.classList.remove('white');
            charEl.classList.add('gray');
            charEl.style.color = '#666';
            charEl.style.textShadow = '0 0 10px #f00';
            grayChars++;
            setTimeout(() => { charEl.style.textShadow = 'none'; }, 500);
        }
        return true;
    }

    function getTargetCharsForWarden(type) {
        // Collect all GRAY chars
        const allGray = Array.from(document.querySelectorAll('.b-char[data-state="gray"]'));
        if (allGray.length === 0) return [];

        let targets = [];

        if (type === 'ink') {
            // Random 10 chars
            for (let i = 0; i < 10 && allGray.length > 0; i++) {
                const idx = Math.floor(Math.random() * allGray.length);
                targets.push(allGray[idx]);
                allGray.splice(idx, 1);
            }
        } else if (type === 'rune') {
            // Random 3 words
            const words = Array.from(document.querySelectorAll('.b-word')).filter(w => w.querySelector('.b-char[data-state="gray"]'));
            for (let i = 0; i < 3 && words.length > 0; i++) {
                const idx = Math.floor(Math.random() * words.length);
                const chars = Array.from(words[idx].querySelectorAll('.b-char[data-state="gray"]'));
                targets = targets.concat(chars);
                words.splice(idx, 1);
            }
        } else if (type === 'gem') {
            // 3 Consecutive words (Phrase)
            const words = Array.from(document.querySelectorAll('.b-word'));
            // Find a start index that has gray chars
            let startIdx = -1;
            const candidateIndices = words.map((w, i) => w.querySelector('.b-char[data-state="gray"]') ? i : -1).filter(i => i !== -1);

            if (candidateIndices.length > 0) {
                startIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
                for (let i = 0; i < 3; i++) {
                    if (startIdx + i < words.length) {
                        const chars = Array.from(words[startIdx + i].querySelectorAll('.b-char[data-state="gray"]'));
                        targets = targets.concat(chars);
                    }
                }
            }
        }

        return targets;
    }

    function getTargetCharsForVillain(type) {
        // Collect all WHITE chars
        const allWhite = Array.from(document.querySelectorAll('.b-char[data-state="white"]'));
        if (allWhite.length === 0) return []; // Nothing to corrupt

        let targets = [];

        if (type === 'queen') { // Center: Random 3 words
            const words = Array.from(document.querySelectorAll('.b-word')).filter(w => w.querySelector('.b-char[data-state="white"]'));
            for (let i = 0; i < 3 && words.length > 0; i++) {
                const idx = Math.floor(Math.random() * words.length);
                const chars = Array.from(words[idx].querySelectorAll('.b-char[data-state="white"]'));
                targets = targets.concat(chars);
                words.splice(idx, 1);
            }
        } else if (type === 'king') { // Right: 3 Consecutive words
            const words = Array.from(document.querySelectorAll('.b-word'));
            let startIdx = -1;
            // Find start index capable of sequence
            const candidateIndices = words.map((w, i) => w.querySelector('.b-char[data-state="white"]') ? i : -1).filter(i => i !== -1);

            if (candidateIndices.length > 0) {
                startIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
                for (let i = 0; i < 3; i++) {
                    if (startIdx + i < words.length) {
                        const chars = Array.from(words[startIdx + i].querySelectorAll('.b-char[data-state="white"]'));
                        targets = targets.concat(chars);
                    }
                }
            }

        } else { // Joker/Left: Random 10 chars
            for (let i = 0; i < 10 && allWhite.length > 0; i++) {
                const idx = Math.floor(Math.random() * allWhite.length);
                targets.push(allWhite[idx]);
                allWhite.splice(idx, 1);
            }
        }

        return targets;
    }

    function endGame(result) {
        gameState = result;
        if (ui.gameUi) ui.gameUi.style.opacity = '0';
        setTimeout(() => {
            if (ui.finalScreen) {
                ui.finalScreen.style.display = 'flex'; // Ensure flex
                setTimeout(() => ui.finalScreen.style.opacity = '1', 10); // Fade in
            }
            if (result === 'victory') {
                if (ui.resultHeader) { ui.resultHeader.innerText = "VICTORY"; ui.resultHeader.style.color = "#4da6ff"; }
                if (ui.storyDisplay) ui.storyDisplay.innerHTML = `<div class="story-clean" style="color:#fff;">${aliceStory}</div>`;
                createFireworks();
            } else {
                if (ui.resultHeader) { ui.resultHeader.innerText = "DEFEAT"; ui.resultHeader.style.color = "#ff4d4d"; }
                if (ui.storyDisplay) ui.storyDisplay.innerHTML = `<div class="story-corrupted" style="color:#888;">${corruptText(aliceStory)}</div>`;
                createRifts();
            }
        }, 1000);
    }

    function createFireworks() {
        // Simple visual effect
        if (!ui.finalScreen) return;
        for (let i = 0; i < 20; i++) {
            const fw = document.createElement('div');
            fw.style.position = 'absolute';
            fw.style.left = Math.random() * 100 + '%';
            fw.style.top = Math.random() * 100 + '%';
            fw.style.width = '10px'; fw.style.height = '10px';
            fw.style.borderRadius = '50%';
            fw.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 50%)`;
            fw.style.boxShadow = `0 0 20px 5px currentColor`;
            fw.style.animation = `popOut 1s ease-out forwards`;
            ui.finalScreen.appendChild(fw);
        }
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
            rift.style.background = '#f00';
            rift.style.position = 'absolute';
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
        ctx.globalCompositeOperation = 'source-over';

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
            const l = lightnings[i];

            ctx.beginPath();
            ctx.strokeStyle = l.color;
            ctx.lineWidth = 3;
            ctx.globalAlpha = l.opacity;
            l.segments.forEach((s, idx) => {
                if (idx === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.nextX, s.nextY);
            });
            ctx.stroke();

            l.opacity -= 0.05;
            if (l.opacity <= 0) lightnings.splice(i, 1);
        }
        ctx.restore();

        // Villain AI Check
        if (gameState === 'playing' && Date.now() - lastVillainAttackTime > villainCooldownBase) {
            // 20% chance to attack every cooldown tick
            if (Math.random() < 0.2) {
                window.AliceBattleRef.triggerVillainAttack();
                lastVillainAttackTime = Date.now();
            }
        }

        animFrameId = requestAnimationFrame(animateLoop);
    }

    // Expose Global Object
    window.AliceBattleRef = {
        init: function () {
            try {
                console.log("AliceBattleRef.init() called.");
                const container = document.getElementById('screen-alice-battle');
                if (container) {
                    container.style.display = 'flex';
                    container.classList.add('active');
                }

                canvas = document.getElementById('alice-canvas');
                if (!canvas) { console.error("Canvas missing"); return; }

                // FORCE ESSENTIAL STYLES
                canvas.style.display = 'block';
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.width = '100vw'; // Explicit Width
                canvas.style.height = '100vh'; // Explicit Height
                canvas.style.zIndex = '100'; // Highest priority
                canvas.style.pointerEvents = 'none'; // Pass clicks

                ctx = canvas.getContext('2d');

                ui.gameUi = document.getElementById('alice-game-ui');
                ui.villainHp = document.getElementById('villain-hp');
                ui.wardenHp = document.getElementById('warden-hp');
                ui.log = document.getElementById('al-log');
                ui.finalScreen = document.getElementById('alice-final-screen');
                ui.storyDisplay = document.getElementById('story-display');
                ui.resultHeader = document.getElementById('result-header');
                ui.textField = document.getElementById('alice-text'); // Middle text area

                window.addEventListener('resize', resize);
                resize();

                // Reset
                wardenHP = 100; gameState = 'playing'; lightnings = [];
                lastVillainAttackTime = Date.now();

                if (ui.wardenHp) ui.wardenHp.style.width = '100%';
                if (ui.gameUi) ui.gameUi.style.opacity = '1';
                if (ui.finalScreen) {
                    ui.finalScreen.style.display = 'none';
                    ui.finalScreen.style.opacity = '0';
                }
                if (ui.log) ui.log.innerText = "Use your cards to purify the text!";

                cardValues.ink = 190; cardValues.rune = 30; cardValues.gem = 50;

                // Initialize Text Battlefield
                initTextBattlefield();
                updateCardDisplay();

                if (animFrameId) cancelAnimationFrame(animFrameId);
                animateLoop();
            } catch (e) { console.error(e); }
        },

        triggerAttack: function (type) {
            if (gameState !== 'playing' || cardValues[type] <= 0) return;

            const sourceEl = document.getElementById('card-' + type);
            if (!sourceEl) return;

            // 1. Identify Targets
            const targetChars = getTargetCharsForWarden(type);

            if (targetChars.length === 0) {
                ui.log.innerText = "No darkness to purify nearby!";
                // Small feedback anyway
                sourceEl.style.transform = "scale(0.95)";
                setTimeout(() => sourceEl.style.transform = "scale(1)", 100);
                return;
            }

            // 2. Consume Resource
            cardValues[type] = Math.max(0, cardValues[type] - decreaseAmount[type]);
            updateCardDisplay();

            // 3. Visual Feedback
            let color = '#00ffff';
            if (type === 'ink') { color = '#b300ff'; ui.log.innerText = `Ink Splash! Purified ${targetChars.length} letters.`; }
            if (type === 'rune') { color = '#00f2ff'; ui.log.innerText = `Rune Cast! Purified words.`; }
            if (type === 'gem') { color = '#ffffff'; ui.log.innerText = `Gemlight! Restored context.`; }

            sourceEl.style.boxShadow = `0 0 20px 5px ${color}`;
            sourceEl.style.borderColor = color;
            setTimeout(() => {
                sourceEl.style.boxShadow = 'none';
                sourceEl.style.borderColor = '#555';
            }, 300);

            // 4. Launch Lightnings
            const sBox = sourceEl.getBoundingClientRect();
            const startX = sBox.left + sBox.width / 2;
            const startY = sBox.top;

            targetChars.forEach((charEl, idx) => {
                setTimeout(() => {
                    const tBox = charEl.getBoundingClientRect();
                    // Add some randomness to target center
                    const targetX = tBox.left + tBox.width / 2;
                    const targetY = tBox.top + tBox.height / 2;

                    lightnings.push(new Lightning(startX, startY, targetX, targetY, false, 0, color));

                    // 5. Apply Effect after delay (impact)
                    setTimeout(() => {
                        changeCharState(charEl, 'white');
                        updateVillainHP();
                    }, 150); // Flight time

                }, idx * 30); // Staggered launch (Papapak!)
            });

            // Villain Re-Action
            lastVillainAttackTime = Date.now(); // Reset villain timer
        },

        triggerVillainAttack: function () {
            if (gameState !== 'playing') return;

            // Decide Attack Type
            const rand = Math.random();
            let type = 'joker'; let cardId = 'v-card-joker'; let damage = 5; let color = '#ff00aa';
            if (rand > 0.6) { type = 'king'; cardId = 'v-card-king'; damage = 10; color = '#ff0055'; }
            if (rand > 0.9) { type = 'queen'; cardId = 'v-card-queen'; damage = 20; color = '#ff0000'; }

            const sourceEl = document.getElementById(cardId) || document.getElementById('villain-visual-container');
            const targetChars = getTargetCharsForVillain(type);

            // Visual Tell
            if (document.getElementById(cardId)) {
                const cEl = document.getElementById(cardId);
                cEl.style.boxShadow = `0 0 20px 10px ${color}`;
                setTimeout(() => cEl.style.boxShadow = 'none', 500);
            }

            ui.log.innerText = `Red Queen uses ${type.toUpperCase()}!`;

            const sBox = sourceEl.getBoundingClientRect();
            const startX = sBox.left + sBox.width / 2;
            const startY = sBox.bottom - 50;

            // If no letters to corrupt, attack warden directly
            if (targetChars.length === 0) {
                const wEl = document.getElementById('warden-hp');
                const wBox = wEl.getBoundingClientRect();
                lightnings.push(new Lightning(startX, startY, wBox.left + wBox.width / 2, wBox.top, false, 0, color));
                setTimeout(() => {
                    wardenHP = Math.max(0, wardenHP - damage);
                    if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';
                    flashOpacity = 0.3; shakeTime = 10;
                    if (wardenHP <= 0) endGame('defeat');
                }, 200);
                return;
            }

            // Corrupt Text
            targetChars.forEach((charEl, idx) => {
                setTimeout(() => {
                    const tBox = charEl.getBoundingClientRect();
                    const targetX = tBox.left + tBox.width / 2;
                    const targetY = tBox.top + tBox.height / 2;

                    lightnings.push(new Lightning(startX, startY, targetX, targetY, false, 0, color));

                    setTimeout(() => {
                        changeCharState(charEl, 'gray');
                        updateVillainHP();

                        // Collateral Damage to Warden
                        wardenHP = Math.max(0, wardenHP - 1);
                        if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';
                        if (wardenHP <= 0) endGame('defeat');

                    }, 150);

                }, idx * 30);
            });
        }
    };

    // Alias
    window.AliceBattle = window.AliceBattleRef;

    // AUTO-LINKER
    const linkInterval = setInterval(() => {
        if (window.Game && window.AliceBattleRef) {
            if (window.Game.AliceBattle !== window.AliceBattleRef) {
                window.Game.AliceBattle = window.AliceBattleRef;
            }
        }
        const debugBtn = document.getElementById('btn-debug-alice');
        if (debugBtn && !debugBtn.onclick) {
            debugBtn.onclick = function () { window.AliceBattleRef.init(); };
        }
    }, 1000);

})();
