
// alice-battle-conquest.js (New File to Bypass Cache)
// LOGIC REWORK: Text Conquest (Purify vs Corrupt)
// V3: Fixing Lightning Targeting & Colors

(function () {
    console.log("Loading AliceConquest Script (Text Conquest Mode)...");

    // Private Variables
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

    // Text Conquest Logic
    let textData = [];
    let wordsData = [];

    let recentlyCorrupted = [];
    let recentlyPurified = [];

    let ui = {
        gameUi: null, villainHp: null, wardenHp: null, log: null,
        finalScreen: null, storyDisplay: null, resultHeader: null, restartBtn: null,
        aliceTextContainer: null
    };

    class Lightning {
        constructor(startX, startY, targetX, targetY, color = '#00ffff') {
            this.segments = [];
            this.startX = startX;
            this.startY = startY;
            this.targetX = targetX;
            this.targetY = targetY;
            this.opacity = 1.0;
            this.color = color;
            this.baseWidth = 1.5;
            this.generateSegments();
        }

        generateSegments() {
            let curX = this.startX;
            let curY = this.startY;
            const dx = this.targetX - this.startX;
            const dy = this.targetY - this.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const segmentCount = Math.max(5, Math.floor(distance / 20));

            for (let i = 0; i <= segmentCount; i++) {
                const progress = i / segmentCount;
                let nextX = this.startX + dx * progress + (Math.random() - 0.5) * (distance * 0.1);
                let nextY = this.startY + dy * progress + (Math.random() - 0.5) * 20;
                if (i === segmentCount) { nextX = this.targetX; nextY = this.targetY; }
                this.segments.push({ x: curX, y: curY, nextX, nextY });
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
            ctx.shadowBlur = 8;
            ctx.shadowColor = this.color;
            this.renderPath();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = this.baseWidth;
            this.renderPath();
            ctx.restore();
            this.opacity -= 0.08;
        }

        renderPath() {
            ctx.beginPath();
            this.segments.forEach((s, idx) => {
                if (idx === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.nextX, s.nextY);
            });
            ctx.stroke();
        }
    }

    function getSafeTarget(element) {
        let x = 0, y = 0;
        if (element) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
            }
        }
        if (x === 0 && y === 0 || x < 0 || y < 0) {
            if (ui.aliceTextContainer) {
                const cRect = ui.aliceTextContainer.getBoundingClientRect();
                x = cRect.left + cRect.width / 2;
                y = cRect.top + cRect.height / 2;
            } else {
                x = window.innerWidth / 2;
                y = window.innerHeight / 2;
            }
        }
        return { x, y };
    }

    function initText() {
        if (!ui.aliceTextContainer) return;
        ui.aliceTextContainer.innerHTML = '';
        textData = [];
        wordsData = [];
        recentlyCorrupted = [];
        recentlyPurified = [];

        const words = aliceStory.split(' ');
        let charGlobalIndex = 0;

        words.forEach((word, wIdx) => {
            const wordSpan = document.createElement('span');
            wordSpan.style.whiteSpace = "nowrap";
            wordSpan.style.marginRight = "5px";
            wordSpan.className = "alice-word";

            let currentWordIndices = [];

            for (let i = 0; i < word.length; i++) {
                const char = word[i];
                const charSpan = document.createElement('span');
                charSpan.innerText = char;
                charSpan.id = `char-${charGlobalIndex}`;
                charSpan.style.transition = "color 0.5s";
                charSpan.style.color = "#555";
                charSpan.dataset.state = 'gray';

                wordSpan.appendChild(charSpan);

                textData.push({
                    index: charGlobalIndex,
                    char: char,
                    dom: charSpan,
                    wordIndex: wIdx,
                    state: 'gray'
                });
                currentWordIndices.push(charGlobalIndex);
                charGlobalIndex++;
            }

            ui.aliceTextContainer.appendChild(wordSpan);
            wordsData.push(currentWordIndices);
        });

        updateGameStatus();
        if (ui.log) ui.log.innerText = "";
    }

    function updateGameStatus() {
        const totalChars = textData.length;
        const whiteChars = textData.filter(d => d.state === 'white').length;

        const purity = (whiteChars / totalChars) * 100;
        villainHP = Math.max(0, 100 - purity);

        if (ui.villainHp) ui.villainHp.style.width = villainHP + '%';
        if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';

        if (villainHP <= 1) endGame('victory');
        if (wardenHP <= 0) endGame('defeat');
    }

    function changeTextState(indices, newState, color) {
        indices.forEach(idx => {
            if (textData[idx]) {
                textData[idx].state = newState;
                textData[idx].dom.style.color = newState === 'white' ? '#fff' : '#555';
                textData[idx].dom.style.textShadow = newState === 'white' ? `0 0 5px ${color}` : 'none';

                textData[idx].dom.animate([
                    { transform: 'scale(1.3)', color: color },
                    { transform: 'scale(1)' }
                ], { duration: 300 });
            }
        });
        updateGameStatus();
    }

    function pickRandom(arr, count) {
        let result = [];
        let temp = [...arr];
        for (let i = 0; i < count; i++) {
            if (temp.length === 0) break;
            const rnd = Math.floor(Math.random() * temp.length);
            result.push(temp[rnd]);
            temp.splice(rnd, 1);
        }
        return result;
    }

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

    function endGame(result) {
        gameState = result;
        if (ui.gameUi) ui.gameUi.style.opacity = '0';
        setTimeout(() => {
            if (ui.finalScreen) ui.finalScreen.classList.add('active');
            if (result === 'victory') {
                if (ui.resultHeader) { ui.resultHeader.innerText = "VICTORY"; ui.resultHeader.style.color = "#4da6ff"; }
                if (ui.storyDisplay) ui.storyDisplay.innerHTML = `<div class="story-clean" style="color:#fff; font-size:1.2rem;">${aliceStory}</div>`;
            } else {
                if (ui.resultHeader) { ui.resultHeader.innerText = "DEFEAT"; ui.resultHeader.style.color = "#ff4d4d"; }
            }
        }, 1000);
    }

    function animateLoop() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

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

    // --- MAIN EXPORT: AliceConquest ---
    window.AliceConquest = {
        init: function () {
            try {
                console.log("AliceConquest Init");
                const container = document.getElementById('screen-alice-battle');
                if (container) {
                    container.style.display = 'flex';
                    container.classList.add('active');
                }

                canvas = document.getElementById('alice-canvas');
                if (!canvas) return;
                canvas.style.display = 'block';
                canvas.style.width = '100vw';
                canvas.style.height = '100vh';
                canvas.style.zIndex = '100';
                canvas.style.pointerEvents = 'none';

                ctx = canvas.getContext('2d');
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;

                ui.gameUi = document.getElementById('alice-game-ui');
                ui.villainHp = document.getElementById('villain-hp');
                ui.wardenHp = document.getElementById('warden-hp');
                ui.log = document.getElementById('al-log');
                ui.finalScreen = document.getElementById('alice-final-screen');
                ui.storyDisplay = document.getElementById('story-display');
                ui.resultHeader = document.getElementById('result-header');
                ui.aliceTextContainer = document.getElementById('alice-text');

                window.addEventListener('resize', resize);

                villainHP = 100; wardenHP = 100; gameState = 'playing'; lightnings = [];

                cardValues.ink = 190; cardValues.rune = 30; cardValues.gem = 50;
                vCardValues.queen = 100; vCardValues.king = 60; vCardValues.joker = 40;
                updateCardDisplay();

                initText();

                if (animFrameId) cancelAnimationFrame(animFrameId);
                animateLoop();

            } catch (e) { console.error(e); }
        },

        triggerAttack: function (type) {
            if (gameState !== 'playing' || cardValues[type] <= 0) return;

            const sourceEl = document.getElementById('card-' + type);
            if (!sourceEl) return;
            const wBox = sourceEl.getBoundingClientRect();
            const startX = wBox.left + wBox.width / 2;
            const startY = wBox.top;

            const origShadow = sourceEl.style.boxShadow;
            sourceEl.style.boxShadow = `0 0 20px 10px ${type === 'ink' ? '#b300ff' : type === 'rune' ? '#00f2ff' : '#fff'}`;
            setTimeout(() => sourceEl.style.boxShadow = origShadow, 300);

            let targets = [];
            let color = '#fff';
            let message = "";

            if (type === 'ink') {
                const priorityIndices = recentlyCorrupted.filter(idx => textData[idx].state === 'gray');
                const otherGrayIndices = textData.filter(d => d.state === 'gray' && !recentlyCorrupted.includes(d.index)).map(d => d.index);

                const takenPriority = pickRandom(priorityIndices, 10);
                targets.push(...takenPriority);

                if (targets.length < 10) {
                    const needed = 10 - targets.length;
                    targets.push(...pickRandom(otherGrayIndices, needed));
                }
                color = '#fff';
                message = "Ink Splash!";
            }
            else if (type === 'rune') {
                const grayWords = wordsData.filter(w => w.some(idx => textData[idx].state === 'gray'));
                const selectedWords = pickRandom(grayWords, 3);
                selectedWords.forEach(w => targets.push(...w));
                color = '#00f2ff';
                message = "Rune Cast!";
            }
            else if (type === 'gem') {
                const grayWords = wordsData.filter(w => w.some(idx => textData[idx].state === 'gray'));
                if (grayWords.length > 0) {
                    const startWordIdx = textData[grayWords[Math.floor(Math.random() * grayWords.length)][0]].wordIndex;
                    for (let i = 0; i < 3; i++) {
                        if (startWordIdx + i < wordsData.length) {
                            targets.push(...wordsData[startWordIdx + i]);
                        }
                    }
                }
                color = '#ffcc00';
                message = "Gem Light!";
            }

            ui.log.innerText = message;

            if (targets.length > 0) {
                recentlyPurified = [...new Set([...recentlyPurified, ...targets])];
                if (recentlyPurified.length > 50) recentlyPurified = recentlyPurified.slice(-50);

                const distinctWordIndices = [...new Set(targets.map(idx => textData[idx].wordIndex))];
                distinctWordIndices.forEach((wIdx, i) => {
                    setTimeout(() => {
                        const wordIndices = wordsData[wIdx];
                        const midCharIdx = wordIndices[Math.floor(wordIndices.length / 2)];
                        const midCharEl = textData[midCharIdx].dom;
                        const targetPos = getSafeTarget(midCharEl);

                        lightnings.push(new Lightning(startX, startY, targetPos.x, targetPos.y, type === 'ink' ? '#b300ff' : type === 'rune' ? '#00f2ff' : '#fff'));
                        shakeTime = 3;
                    }, i * 30);
                });

                setTimeout(() => {
                    changeTextState(targets, 'white', color);
                }, 200 + distinctWordIndices.length * 30);
            }

            cardValues[type] = Math.max(0, cardValues[type] - decreaseAmount[type]);
            updateCardDisplay();

            setTimeout(() => { if (gameState === 'playing') this.villainCounter(); }, 1000 + Math.random() * 500);
        },

        villainCounter: function () {
            if (gameState !== 'playing') return;

            const availableCards = Object.keys(vCardValues).filter(key => vCardValues[key] > 0);
            if (availableCards.length === 0) return;

            const chosenKey = availableCards[Math.floor(Math.random() * availableCards.length)];
            const vSourceEl = document.getElementById(`v-card-${chosenKey}`);
            if (!vSourceEl) return;

            const vBox = vSourceEl.getBoundingClientRect();
            const startX = vBox.left + vBox.width / 2;
            const startY = vBox.bottom;

            vSourceEl.style.boxShadow = `0 0 20px 10px #ff0044`;
            vSourceEl.style.borderColor = "#ff0044";
            setTimeout(() => { vSourceEl.style.boxShadow = 'none'; vSourceEl.style.borderColor = '#ff4444'; }, 300);

            let targets = [];
            let message = "";
            let lightningColor = "#ff0044";

            if (chosenKey === 'queen') {
                const priorityIndices = recentlyPurified.filter(idx => textData[idx].state === 'white');
                const otherWhiteIndices = textData.filter(d => d.state === 'white' && !recentlyPurified.includes(d.index)).map(d => d.index);

                const takenPriority = pickRandom(priorityIndices, 10);
                targets.push(...takenPriority);
                if (targets.length < 10) {
                    const needed = 10 - targets.length;
                    targets.push(...pickRandom(otherWhiteIndices, needed));
                }
                message = "The Queen Corrupts!";
            }
            else if (chosenKey === 'king') {
                const whiteWords = wordsData.filter(w => w.some(idx => textData[idx].state === 'white'));
                const selectedWords = pickRandom(whiteWords, 3);
                selectedWords.forEach(w => targets.push(...w));
                message = "King's Decree!";
            }
            else {
                const whiteWords = wordsData.filter(w => w.some(idx => textData[idx].state === 'white'));
                if (whiteWords.length > 0) {
                    const startWordIdx = textData[whiteWords[Math.floor(Math.random() * whiteWords.length)][0]].wordIndex;
                    for (let i = 0; i < 3; i++) {
                        if (startWordIdx + i < wordsData.length) {
                            targets.push(...wordsData[startWordIdx + i]);
                        }
                    }
                }
                message = "Joker's Trick!";
            }

            ui.log.innerText = message;

            if (targets.length > 0) {
                recentlyCorrupted = [...new Set([...recentlyCorrupted, ...targets])];
                if (recentlyCorrupted.length > 50) recentlyCorrupted = recentlyCorrupted.slice(-50);

                const distinctWordIndices = [...new Set(targets.map(idx => textData[idx].wordIndex))];
                distinctWordIndices.forEach((wIdx, i) => {
                    setTimeout(() => {
                        const wordIndices = wordsData[wIdx];
                        const midCharIdx = wordIndices[Math.floor(wordIndices.length / 2)];
                        const midCharEl = textData[midCharIdx].dom;
                        const targetPos = getSafeTarget(midCharEl);

                        lightnings.push(new Lightning(startX, startY, targetPos.x, targetPos.y, lightningColor));
                        shakeTime = 3;
                    }, i * 30);
                });

                setTimeout(() => {
                    changeTextState(targets, 'gray', null);
                    wardenHP = Math.max(0, wardenHP - 5);
                    if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';
                    if (wardenHP <= 0) endGame('defeat');
                }, 200 + distinctWordIndices.length * 30);
            } else {
                if (ui.wardenHp && wardenHP > 0) {
                    const targetPos = getSafeTarget(null);
                    lightnings.push(new Lightning(startX, startY, targetPos.x, targetPos.y, lightningColor));
                    setTimeout(() => {
                        wardenHP -= 10;
                        if (ui.wardenHp) ui.wardenHp.style.width = wardenHP + '%';
                        if (wardenHP <= 0) endGame('defeat');
                    }, 200);
                }
            }

            vCardValues[chosenKey] = Math.max(0, vCardValues[chosenKey] - vDecreaseAmount[chosenKey]);
            updateCardDisplay();
        }
    };

    // Legacy support wrapper (optional, but good for safety)
    window.AliceBattleRef = window.AliceConquest;

})();
