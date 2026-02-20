export class VocabManager {
    constructor(game) {
        this.game = game;
        this.vocabList = [];
        this.currentIndex = 0;
        this.isProcessing = false;
    }

    init(vocabList) {
        this.vocabList = vocabList || [];
        this.currentIndex = 0;
    }

    loadVocab(index) {
        if (!this.vocabList || index >= this.vocabList.length) return;

        this.currentIndex = index;
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
                    this.renderFallbackIcon(imgPlaceholder, data.word);
                };
                imgPlaceholder.appendChild(img);
            } else {
                this.renderFallbackIcon(imgPlaceholder, data.word);
            }
        }

        // Update Sentence
        const card = document.querySelector(".word-card");
        if (card) {
            const p = card.querySelector("p");
            if (p) p.innerHTML = data.sentence;
        }

        // Update Counter
        const counterDiv = document.querySelector("#screen-word > div:first-child");
        if (counterDiv) counterDiv.textContent = `WORD FORGE (${index + 1}/${this.vocabList.length})`;

        // Update Options
        const optionsDiv = document.getElementById("vocab-options");
        if (optionsDiv) {
            optionsDiv.innerHTML = "";
            data.options.forEach((optText, idx) => {
                const btn = document.createElement("button");
                btn.className = "option-btn";
                btn.textContent = optText;
                // Use Game proxy or direct manager call if exposed
                // Assuming Game.checkVocab proxies to this manager
                btn.onclick = (e) => this.game.checkVocab(idx, e);
                optionsDiv.appendChild(btn);
            });
        }
    }

    renderFallbackIcon(container, word) {
        let icon = "📜";
        if (word === "Luminous") icon = "✨";
        if (word === "Peculiar") icon = "🎩";
        if (word === "Vanish") icon = "💨";

        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";
        container.innerHTML = `<div style="font-size: 80px; text-shadow: 0 0 20px rgba(255,215,0,0.5); animation: float 3s infinite ease-in-out;">${icon}</div>`;
    }

    async checkVocab(optionIndex, event) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const currentData = this.vocabList[this.currentIndex];
        const isCorrect = (optionIndex === currentData.answer);

        // UI Feedback
        const optionsDiv = document.getElementById("vocab-options");
        const btns = optionsDiv ? optionsDiv.querySelectorAll(".option-btn") : [];
        const selectedBtn = btns[optionIndex];

        btns.forEach(btn => btn.disabled = true);

        if (isCorrect) {
            // Success
            if (selectedBtn) {
                selectedBtn.classList.add("correct");
                this.spawnFloatingText(selectedBtn, "+10 Runes!", "bonus");

                // FX
                const rect = selectedBtn.getBoundingClientRect();
                const startX = event ? event.clientX : (rect.left + rect.width / 2);
                const startY = event ? event.clientY : (rect.top + rect.height / 2);
                this.spawnRuneParticles(startX, startY);
            }

            await new Promise(r => setTimeout(r, 1200));

            this.currentIndex++;
            this.isProcessing = false;

            if (this.currentIndex < this.vocabList.length) {
                this.loadVocab(this.currentIndex);
            } else {
                console.log("[VocabManager] Word Forge Complete.");
                this.game.switchScreen("screen-wpm");
            }
        } else {
            // Fail
            // Penalty
            if (this.game.scoreManager) this.game.scoreManager.addRunes(-5);

            if (selectedBtn) {
                selectedBtn.classList.add("wrong");
                this.spawnFloatingText(selectedBtn, "-5 Rune", "error");
            }

            // Retry Logic: Re-enable others
            btns.forEach((btn, idx) => {
                if (idx !== optionIndex) btn.disabled = false;
            });

            this.isProcessing = false;
        }
    }

    // --- FX ---
    spawnFloatingText(targetEl, text, type) {
        const rect = targetEl.getBoundingClientRect();
        const floatEl = document.createElement("div");
        floatEl.className = `feedback-text ${type}`;
        floatEl.innerText = text;
        floatEl.style.left = (rect.left + rect.width / 2) + "px";
        floatEl.style.top = (rect.top) + "px";
        document.body.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1000);
    }

    spawnRuneParticles(startX, startY) {
        const targetEl = document.getElementById("rune-count");
        if (!targetEl) return;

        // Add Score (Deferred or Immediate? Original was immediate inside anim? No, onfinish)
        // Original: if (i===0) this.addRunes(10);
        // We'll do it via callback or inside loop.

        const targetRect = targetEl.getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        const particleCount = 12;
        const colors = ["#ffd700", "#ffae00", "#ffffff", "#e0ffff"];

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement("div");
            p.className = "rune-particle";

            const size = 5 + Math.random() * 8;
            p.style.width = size + "px";
            p.style.height = size + "px";
            p.style.borderRadius = "50%";
            p.style.position = "fixed";
            p.style.zIndex = "10000";
            p.style.left = startX + "px";
            p.style.top = startY + "px";

            const color = colors[Math.floor(Math.random() * colors.length)];
            p.style.backgroundColor = color;
            p.style.boxShadow = "0 0 10px " + color;

            document.body.appendChild(p);

            // Bezier Logic
            const midX = (startX + targetX) / 2;
            const midY = (startY + targetY) / 2;
            const curveStrength = 150 + Math.random() * 200;
            const curveAngle = Math.random() * Math.PI * 2;
            const cpX = midX + Math.cos(curveAngle) * curveStrength;
            const cpY = midY + Math.sin(curveAngle) * curveStrength;

            const keyframes = [];
            const steps = 30;
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const xx = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * targetX;
                const yy = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * targetY;

                let scale = 1;
                let opacity = 1;

                if (t < 0.2) scale = 0.5 + (t * 5);
                else if (t < 0.8) scale = 1.5 - ((t - 0.2) * 0.5);
                else { scale = 1.2 - ((t - 0.8) * 4); opacity = 1; }

                keyframes.push({ left: `${xx}px`, top: `${yy}px`, transform: `scale(${scale})`, opacity: opacity, offset: t });
            }

            const duration = 1200 + Math.random() * 600;
            const anim = p.animate(keyframes, { duration: duration, easing: "linear", fill: "forwards" });

            anim.onfinish = () => {
                // [FIX] Cancel the animation before removing the element.
                // fill:'forwards' locks computed styles on the node, preventing GC.
                // anim.cancel() reverts to the element's base style, releasing the hold.
                anim.cancel();
                p.remove();
                if (i === 0) {
                    // Reward
                    if (this.game.scoreManager) this.game.scoreManager.addRunes(10);

                    // Pulse
                    targetEl.style.transition = "transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
                    targetEl.style.transform = "scale(1.8)";
                    targetEl.style.filter = "brightness(2.5) drop-shadow(0 0 20px gold)";
                    setTimeout(() => {
                        targetEl.style.transform = "scale(1)";
                        targetEl.style.filter = "brightness(1)";
                    }, 200);
                }
            };
        }
    }
}
