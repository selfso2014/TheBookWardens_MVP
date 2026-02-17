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

    const aliceStory = "For it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it.";

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

        // FORCE VISIBILITY & LAYOUT (Multi-line fix)
        ui.textField.style.setProperty('opacity', '1', 'important');
        ui.textField.style.setProperty('mask-image', 'none', 'important');
        ui.textField.style.setProperty('-webkit-mask-image', 'none', 'important');

        ui.textField.style.overflow = 'visible';
        ui.textField.style.color = '#fff';
        ui.textField.style.display = 'block'; // Allow wrapping
        ui.textField.style.whiteSpace = 'normal'; // Allow wrapping
        ui.textField.style.height = 'auto';
        ui.textField.style.minHeight = '150px';
        ui.textField.style.lineHeight = '1.6';
        ui.textField.style.fontSize = '0.9em'; // 90% size

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
                charSpan.innerText = word[i];
                charSpan.id = `char-${wordIdx}-${i}`;
                charSpan.style.transition = 'color 0.3s, text-shadow 0.3s, transform 0.2s';

                // 50/50 Chance Logic
                // If random > 0.5 => Gray (Corrupted), Else => White (Purified)
                if (Math.random() > 0.5) {
                    charSpan.className = 'b-char gray';
                    charSpan.style.setProperty('color', '#555', 'important');
                    charSpan.style.textShadow = 'none';
                    charSpan.dataset.state = 'gray';
                    grayChars++;
                } else {
                    charSpan.className = 'b-char white';
                    charSpan.style.setProperty('color', '#ffffff', 'important');
                    charSpan.style.textShadow = '0 0 10px #fff'; // Subtle glow for init
                    charSpan.dataset.state = 'white';
                }

                wordSpan.appendChild(charSpan);
                totalChars++;
            }
            ui.textField.appendChild(wordSpan);
        });

        updateVillainHP();
    }

    function updateVillainHP() {
        // TUG OF WAR LOGIC
        // Blue Bar = Warden's Territory (White Chars)
        // Red Back = Villain's Territory (Gray Chars)

        const whiteChars = totalChars - grayChars;
        const wardenPercent = (whiteChars / totalChars) * 100;

        if (ui.villainHp) {
            ui.villainHp.style.width = wardenPercent + '%';
        }

        // Win/Loss Condition
        if (totalChars > 0) {
            if (grayChars <= 0) endGame('victory'); // All White
            if (whiteChars <= 0) endGame('defeat'); // All Gray
        }
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

            // Strong White Transition
            charEl.style.setProperty('color', '#ffffff', 'important');
            charEl.style.textShadow = '0 0 10px #fff, 0 0 20px cyan, 0 0 30px cyan';
            charEl.style.transform = 'scale(1.1)';

            grayChars--;
            setTimeout(() => {
                charEl.style.textShadow = 'none';
                charEl.style.transform = 'scale(1)';
            }, 600);
        } else {
            charEl.classList.remove('white');
            charEl.classList.add('gray');

            // Strong Gray Transition
            charEl.style.setProperty('color', '#555', 'important');
            charEl.style.textShadow = '0 0 10px #ff0000';
            charEl.style.transform = 'scale(0.9)';

            grayChars++;
            setTimeout(() => {
                charEl.style.textShadow = 'none';
                charEl.style.transform = 'scale(1)';
            }, 600);
        }
        return true;
    }

    function getTargetCharsForWarden(type) {
        if (!ui.textField) return [];
        // Collect all GRAY chars in THIS text field
        const allGray = Array.from(ui.textField.querySelectorAll('.b-char[data-state="gray"]'));
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
        if (!ui.textField) return [];
        // Collect all WHITE chars in THIS text field
        const allWhite = Array.from(ui.textField.querySelectorAll('.b-char[data-state="white"]'));
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

    function showIntroModal() {
        const container = document.getElementById('screen-alice-battle');
        if (!container) return;

        // Check if modal already exists
        let modal = document.getElementById('alice-intro-modal');
        if (modal) {
            modal.style.display = 'flex';
            return;
        }

        modal = document.createElement('div');
        modal.id = 'alice-intro-modal';
        modal.style.position = 'absolute';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.zIndex = '500';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.backdropFilter = 'blur(5px)';
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.5s';

        const card = document.createElement('div');
        card.style.background = 'linear-gradient(135deg, #1a0505 0%, #000 100%)';
        card.style.border = '2px solid #D50000';
        card.style.borderRadius = '15px';
        card.style.padding = '30px';
        card.style.maxWidth = '500px';
        card.style.textAlign = 'center';
        card.style.boxShadow = '0 0 30px rgba(213, 0, 0, 0.4)';
        card.style.color = '#fff';

        // Villain Image
        const img = document.createElement('img');
        img.src = 'finalredvillain.png'; // Using existing asset
        img.style.width = '80px';
        img.style.height = '80px';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '50%';
        img.style.border = '2px solid #D50000';
        img.style.marginBottom = '20px';
        img.style.backgroundColor = '#000';
        card.appendChild(img);

        // Title
        const title = document.createElement('h2');
        title.innerText = "FINAL CHALLENGE";
        title.style.fontFamily = "'Cinzel', serif";
        title.style.color = '#D50000';
        title.style.fontSize = '2rem';
        title.style.marginBottom = '10px';
        title.style.marginTop = '0';
        card.appendChild(title);

        // Story Text
        const p = document.createElement('p');
        p.innerHTML = "You have traveled far, Warden.<br>Now, face <b>the Final Villain</b>!<br><br>It is trying to erase the story.<br>Use your magic to bring the words back!";
        p.style.fontSize = '1.1rem';
        p.style.lineHeight = '1.6';
        p.style.color = '#ddd';
        p.style.marginBottom = '30px';
        card.appendChild(p);

        // Button
        const btn = document.createElement('button');
        btn.innerText = "START BATTLE";
        btn.style.padding = '12px 40px';
        btn.style.fontSize = '1.2rem';
        btn.style.backgroundColor = '#D50000';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '30px';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = "'Cinzel', serif";
        btn.style.boxShadow = '0 0 15px rgba(213, 0, 0, 0.6)';
        btn.style.transition = 'transform 0.2s';

        btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
        btn.onmouseout = () => btn.style.transform = 'scale(1)';
        btn.onclick = () => {
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.style.display = 'none';
                gameState = 'playing';
                lastVillainAttackTime = Date.now();
            }, 500);
        };
        card.appendChild(btn);

        modal.appendChild(card);
        container.appendChild(modal);

        // Fade In
        setTimeout(() => modal.style.opacity = '1', 10);
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
                ui.log = container.querySelector('#al-log'); // Scoped log
                if (ui.log) ui.log.innerText = ""; // Clear log

                ui.finalScreen = document.getElementById('alice-final-screen');
                ui.storyDisplay = document.getElementById('story-display');
                ui.resultHeader = document.getElementById('result-header');

                // CRITICAL FIX: Scope to container
                ui.textField = container.querySelector('#alice-text');

                window.addEventListener('resize', resize);
                resize();

                // RESET & SETUP
                wardenHP = 100;
                gameState = 'paused'; // Start PAUSED for Intro
                lightnings = [];
                lastVillainAttackTime = Date.now();

                // SETUP UNIFIED BAR (TUG OF WAR) & LABELS
                if (ui.villainHp) {
                    ui.villainHp.style.width = '50%';
                    ui.villainHp.style.backgroundColor = '#2962FF';

                    const parentBar = ui.villainHp.parentElement;
                    parentBar.style.backgroundColor = '#D50000';
                    parentBar.style.border = '2px solid #fff';
                    parentBar.style.height = '24px';

                    // FIXED POSITIONING (Force Visibility)
                    parentBar.style.position = 'absolute';
                    parentBar.style.top = '36%'; // Between Villain and Text
                    parentBar.style.left = '50%';
                    parentBar.style.transform = 'translateX(-50%)';
                    parentBar.style.width = '90%'; // Wider
                    parentBar.style.zIndex = '950';
                    parentBar.style.marginTop = '0';
                    parentBar.style.boxShadow = '0 0 15px rgba(0,0,0,0.8)';
                    parentBar.style.overflow = 'visible';

                    // Add Labels if missing
                    if (!parentBar.querySelector('.lbl-warden')) {
                        const wLbl = document.createElement('div');
                        wLbl.className = 'lbl-warden';
                        wLbl.innerText = "WARDEN";
                        wLbl.style.position = 'absolute';
                        wLbl.style.left = '0'; // Inside or close
                        wLbl.style.top = '-20px'; // Above bar
                        wLbl.style.color = '#2962FF';
                        wLbl.style.fontWeight = 'bold';
                        wLbl.style.fontSize = '0.8rem'; // Small
                        wLbl.style.fontFamily = 'Cinzel, serif';
                        wLbl.style.textShadow = '0 0 5px #000';
                        parentBar.appendChild(wLbl);

                        const vLbl = document.createElement('div');
                        vLbl.className = 'lbl-villain';
                        vLbl.innerText = "VILLAIN";
                        vLbl.style.position = 'absolute';
                        vLbl.style.right = '0'; // Inside or close
                        vLbl.style.top = '-20px'; // Above bar
                        vLbl.style.color = '#D50000';
                        vLbl.style.fontWeight = 'bold';
                        vLbl.style.fontSize = '0.8rem'; // Small
                        vLbl.style.fontFamily = 'Cinzel, serif';
                        vLbl.style.textShadow = '0 0 5px #000';
                        parentBar.appendChild(vLbl);
                    }
                }

                // Adjust Layout compactness
                const villainArea = container.querySelector('.entity-area.villain');
                if (villainArea) {
                    villainArea.style.height = '35vh'; // Give space
                    villainArea.style.minHeight = '200px';
                }

                // Move Text Field Up (Remove Gap)
                if (ui.textField) {
                    const tfParent = ui.textField.parentElement;
                    tfParent.style.marginTop = '0';
                    tfParent.style.paddingTop = '60px'; // Space for Bar
                    tfParent.style.zIndex = '800';

                    // WIDER TEXT FIELD
                    ui.textField.style.width = '120%';
                    ui.textField.style.marginLeft = '-10%'; // Center alignment
                    ui.textField.style.minHeight = '300px'; // More lines (~7 lines)
                }

                if (ui.wardenHp) ui.wardenHp.parentElement.style.display = 'none';

                if (ui.gameUi) ui.gameUi.style.opacity = '1';
                if (ui.finalScreen) {
                    ui.finalScreen.style.display = 'none';
                    ui.finalScreen.style.opacity = '0';
                }

                cardValues.ink = 190; cardValues.rune = 30; cardValues.gem = 50;

                // Compact Villain Cards
                const vCards = container.querySelector('.villain-cards');
                if (vCards) {
                    vCards.style.transform = 'scale(0.8)';
                    vCards.style.transformOrigin = 'bottom center'; // Anchor to bottom
                    vCards.style.marginTop = '0';
                }

                initTextBattlefield();
                updateCardDisplay();

                if (animFrameId) cancelAnimationFrame(animFrameId);
                animateLoop(); // Loop runs but does nothing if paused

                // SHOW INTRO MODAL
                showIntroModal();

            } catch (e) { console.error(e); }
        },

        triggerAttack: function (type) {
            if (gameState !== 'playing' || cardValues[type] <= 0) return;

            const sourceEl = document.getElementById('card-' + type);
            if (!sourceEl) return;

            // 1. Identify Targets
            const targetChars = getTargetCharsForWarden(type);

            if (targetChars.length === 0) {
                // No log, just visual shake
                sourceEl.style.transform = "scale(0.95)";
                setTimeout(() => sourceEl.style.transform = "scale(1)", 100);
                return;
            }

            // 2. Consume Resource
            cardValues[type] = Math.max(0, cardValues[type] - decreaseAmount[type]);
            updateCardDisplay();

            // 3. Visual Feedback
            let color = '#00ffff';
            if (type === 'ink') { color = '#b300ff'; }
            if (type === 'rune') { color = '#00f2ff'; }
            if (type === 'gem') { color = '#ffffff'; }

            // NO LOGGING

            sourceEl.style.boxShadow = `0 0 20px 5px ${color}`;
            sourceEl.style.borderColor = color;
            setTimeout(() => {
                sourceEl.style.boxShadow = 'none';
                sourceEl.style.borderColor = '#555';
            }, 300);

            // 4. Launch Lightnings
            const sBox = sourceEl.getBoundingClientRect();
            let startX = sBox.left + sBox.width / 2;
            let startY = sBox.top;

            // FALLBACK FOR SOURCE
            if (sBox.width === 0 && sBox.height === 0) {
                startX = window.innerWidth / 2;
                startY = window.innerHeight - 100; // Bottom Center fallback
            }

            targetChars.forEach((charEl, idx) => {
                setTimeout(() => {
                    const tBox = charEl.getBoundingClientRect();
                    // Add some randomness to target center
                    let targetX = tBox.left + tBox.width / 2;
                    let targetY = tBox.top + tBox.height / 2;

                    // FALLBACK FOR TARGET
                    if (tBox.width === 0 && tBox.height === 0) {
                        targetX = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
                        targetY = window.innerHeight / 2 + (Math.random() - 0.5) * 100;
                    }

                    lightnings.push(new Lightning(startX, startY, targetX, targetY, false, 0, color));

                    // 5. Apply Effect after delay (impact)
                    setTimeout(() => {
                        changeCharState(charEl, 'white');
                        updateVillainHP();
                    }, 150); // Flight time

                }, idx * 30); // Staggered launch
            });

            // Villain Re-Action
            lastVillainAttackTime = Date.now(); // Reset villain timer
        },

        triggerVillainAttack: function () {
            if (gameState !== 'playing') return;

            // Decide Attack Type
            const rand = Math.random();
            let type = 'joker'; let cardId = 'v-card-joker'; let color = '#ff00aa';
            if (rand > 0.6) { type = 'king'; cardId = 'v-card-king'; color = '#ff0055'; }
            if (rand > 0.9) { type = 'queen'; cardId = 'v-card-queen'; color = '#ff0000'; }

            const sourceEl = document.getElementById(cardId) || document.getElementById('villain-visual-container');
            const targetChars = getTargetCharsForVillain(type);

            // Visual Tell
            if (document.getElementById(cardId)) {
                const cEl = document.getElementById(cardId);
                cEl.style.boxShadow = `0 0 20px 10px ${color}`;
                setTimeout(() => cEl.style.boxShadow = 'none', 500);
            }

            // NO LOGGING

            const sBox = sourceEl.getBoundingClientRect();
            let startX = sBox.left + sBox.width / 2;
            let startY = sBox.bottom - 50;

            // FALLBACK FOR VILLAIN SOURCE
            if (sBox.width === 0 && sBox.height === 0) {
                startX = window.innerWidth / 2;
                startY = 100; // Top Center fallback
            }

            // If no letters to corrupt, we just wait (or could shake the screen)
            if (targetChars.length === 0) {
                // No target logic needed, victory is handled by updateVillainHP
                return;
            }

            // Corrupt Text
            targetChars.forEach((charEl, idx) => {
                setTimeout(() => {
                    const tBox = charEl.getBoundingClientRect();
                    let targetX = tBox.left + tBox.width / 2;
                    let targetY = tBox.top + tBox.height / 2;

                    // FALLBACK FOR TARGET
                    if (tBox.width === 0 && tBox.height === 0) {
                        targetX = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
                        targetY = window.innerHeight / 2 + (Math.random() - 0.5) * 100;
                    }

                    lightnings.push(new Lightning(startX, startY, targetX, targetY, false, 0, color));

                    setTimeout(() => {
                        changeCharState(charEl, 'gray');
                        updateVillainHP();
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
