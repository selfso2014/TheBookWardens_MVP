/**
 * TextRenderer.js
 * 
 * "The Stable Typesetter"
 * 
 * Provides a specialized rendering engine for reading games that prioritizes:
 * 1. Layout Stability: Pre-renders text to lock in geometric coordinates (Reflow Prevention).
 * 2. Coordinate Caching: Caches word positions once, eliminating DOM reads during gameplay.
 * 3. Hit-Testing: Provides O(n) or optimized lookups for gaze-to-word mapping without browser recalculations.
 */

class TextRenderer {
    constructor(containerId, options = {}) {
        // v2026-02-05-1200: Fix Timing & Initial Trigger
        this.containerId = containerId;
        this.container = document.getElementById(containerId);

        this.options = Object.assign({
            fontFamily: "'Crimson Text', serif",
            fontSize: "1.5rem",
            lineHeight: "2.5",
            wordSpacing: "0.3em",
            padding: "20px"
        }, options);

        // State
        this.words = [];       // Array of Word Objects: { id, text, chunkId, element, rect }
        this.chunks = [];      // Array of Chunk Arrays (grouping word indices)
        this.lines = [];       // Array of Line Objects: { y, top, bottom, wordIndices[] }
        this.isLayoutLocked = false;

        // Visual Elements
        this.cursor = null;
        this.impactElement = null;

        this.initStyles();
    }

    initStyles() {
        if (!this.container) return;
        this.container.style.position = "relative";
        this.container.style.fontFamily = this.options.fontFamily;
        this.container.style.fontSize = this.options.fontSize;
        this.container.style.lineHeight = this.options.lineHeight;
        this.container.style.padding = this.options.padding;
        this.container.style.textAlign = "left";
    }

    prepare(rawText) {
        if (!this.container) return;

        // 1. Reset
        this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = [];
        this.isLayoutLocked = false;

        // 2. Parse
        const rawChunks = rawText.split("/");
        let globalWordIndex = 0;

        rawChunks.forEach((chunkText, chunkIndex) => {
            const cleanChunk = chunkText.trim();
            if (!cleanChunk) return;

            const chunkWordIndices = [];
            const rawWords = cleanChunk.split(/\s+/);

            rawWords.forEach((w) => {
                const span = document.createElement("span");
                span.className = "tr-word";
                span.style.color = "#ffffff";
                span.style.opacity = "0";
                span.style.marginRight = this.options.wordSpacing;
                span.style.display = "inline-block";
                span.style.lineHeight = "1.2";
                span.style.verticalAlign = "middle";
                span.dataset.index = globalWordIndex;
                span.textContent = w;

                this.container.appendChild(span);

                this.words.push({
                    index: globalWordIndex,
                    text: w,
                    chunkId: chunkIndex,
                    element: span,
                    rect: null
                });

                chunkWordIndices.push(globalWordIndex);
                globalWordIndex++;
            });
            this.chunks.push(chunkWordIndices);
        });

        // 3. Add a "cursor" element
        const oldCursor = document.querySelector('.tr-cursor');
        if (oldCursor) oldCursor.remove();

        // Remove existing impact element (cleanup)
        if (this.impactElement && this.impactElement.parentNode) {
            this.impactElement.parentNode.removeChild(this.impactElement);
            this.impactElement = null;
        }

        this.cursor = document.createElement("span");
        this.cursor.className = "tr-cursor";
        this.cursor.style.position = "fixed";
        this.cursor.style.top = "-1000px";
        this.cursor.style.left = "-1000px";
        this.cursor.style.zIndex = "9999";
        this.cursor.style.pointerEvents = "none";

        document.body.appendChild(this.cursor);

        // 4. Pre-create Impact Element
        this.impactElement = document.createElement('div');
        this.impactElement.id = "tr-impact-effect";
        this.impactElement.style.position = "fixed";
        this.impactElement.style.borderRadius = "50%";
        this.impactElement.style.backgroundColor = "magenta";
        this.impactElement.style.boxShadow = "0 0 15px magenta";
        this.impactElement.style.zIndex = "999999";
        this.impactElement.style.pointerEvents = "none";
        this.impactElement.style.opacity = "0"; // Initially hidden
        this.impactElement.style.width = "10px";
        this.impactElement.style.height = "10px";
        document.body.appendChild(this.impactElement);

        if (this.words.length > 0) {
            setTimeout(() => {
                this.updateCursor(this.words[0], 'start');
                this.cursor.style.opacity = '1';
                console.log("[TextRenderer] Initial Cursor Posed at Word 0");
            }, 50);
        }

        // FIX: Prevent immediate "false positive" return effect on game start
        // Set cooldown to future (2 seconds from now) matches the READY PHASE
        this.lastReturnTime = Date.now() + 2000;
    }

    lockLayout() {
        if (this.words.length === 0) return;
        const containerRect = this.container.getBoundingClientRect();
        let currentLineY = -9999;
        let lineBuffer = [];

        this.words.forEach(word => {
            const r = word.element.getBoundingClientRect();
            // Typographic Center Correction (Top Quartile)
            const visualCenterY = r.top + (r.height * 0.25);

            word.rect = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                centerX: r.left + r.width / 2,
                centerY: r.top + r.height / 2,
                visualCenterY: visualCenterY
            };

            // Use larger threshold for line detection
            if (Math.abs(word.rect.top - currentLineY) > (word.rect.height * 1.5)) {
                if (lineBuffer.length > 0) {
                    this.lines.push(this._finalizeLine(lineBuffer));
                }
                lineBuffer = [word];
                currentLineY = word.rect.top;
            } else {
                lineBuffer.push(word);
            }
        });

        if (lineBuffer.length > 0) {
            this.lines.push(this._finalizeLine(lineBuffer));
        }

        this.isLayoutLocked = true;
        console.log(`[TextRenderer] Layout Locked: ${this.words.length} words, ${this.lines.length} lines.`);
    }

    _finalizeLine(words) {
        const first = words[0].rect;
        const last = words[words.length - 1].rect;
        const lineIndex = this.lines.length;
        const minTop = Math.min(...words.map(w => w.rect.top));
        const maxBottom = Math.max(...words.map(w => w.rect.bottom));

        let sumVisualY = 0;
        words.forEach(w => {
            w.lineIndex = lineIndex;
            sumVisualY += w.rect.visualCenterY;
        });

        return {
            index: lineIndex,
            startIndex: words[0].index,
            endIndex: words[words.length - 1].index,
            wordIndices: words.map(w => w.index),
            visualY: sumVisualY / words.length,
            rect: {
                left: first.left,
                right: last.right,
                top: minTop,
                bottom: maxBottom,
                width: last.right - first.left,
                height: maxBottom - minTop
            }
        };
    }

    resetToStart() {
        if (this.words.length > 0) {
            this.updateCursor(this.words[0], 'start');
        }
    }

    revealChunk(chunkIndex, interval = 150) {
        if (!this.isLayoutLocked) this.lockLayout();
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return Promise.resolve();

        const indices = this.chunks[chunkIndex];
        return new Promise((resolve) => {
            const firstW = this.words[indices[0]];
            const chunkStartsLine = this.lines.some(l => l.startIndex === firstW.index);
            let timeOffset = 0;

            if (chunkStartsLine && chunkIndex > 0) {
                timeOffset = 400;
                this.updateCursor(firstW, 'start');
            }

            indices.forEach((wordIdx, i) => {
                const w = this.words[wordIdx];
                const delay = i * interval + timeOffset;
                const isLineStart = this.lines.some(l => l.startIndex === w.index);

                if (isLineStart && i > 0) {
                    const leadTime = Math.min(interval * 0.8, 300);
                    setTimeout(() => this.updateCursor(w, 'start'), delay - leadTime);
                }

                setTimeout(() => {
                    w.element.style.opacity = "1";
                    w.element.style.visibility = "visible";
                    w.element.classList.add("revealed");
                    this.updateCursor(w, 'end');
                }, delay);
            });

            setTimeout(resolve, indices.length * interval + timeOffset);
        });
    }

    updateCursor(wordObj, align = 'end') {
        if (!this.cursor || !wordObj || !wordObj.element) return;
        try {
            const currentRect = wordObj.element.getBoundingClientRect();
            let visualY = currentRect.top + (currentRect.height * 0.52);
            if (!wordObj.element.classList.contains("revealed")) visualY -= 10;

            let visualX;
            if (align === 'start' || align === 'left') visualX = currentRect.left - 4;
            else visualX = currentRect.right + 2;

            this.cursor.style.position = "fixed";
            this.cursor.style.left = visualX + "px";
            this.cursor.style.top = visualY + "px";
            this.cursor.style.opacity = "1";
        } catch (e) {
            console.error("[TextRenderer] Cursor Update Error:", e);
        }
    }

    fadeOutChunk(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return;
        const indices = this.chunks[chunkIndex];
        indices.forEach((wordIdx, i) => {
            const w = this.words[wordIdx];
            if (w && w.element) {
                setTimeout(() => {
                    w.element.classList.remove("revealed");
                    w.element.classList.add("chunk-fade-out");
                }, i * 50);
            }
        });
    }

    scheduleFadeOut(chunkIndex, delayMs) {
        setTimeout(() => this.fadeOutChunk(chunkIndex), delayMs);
    }

    hitTest(gx, gy) {
        if (!this.isLayoutLocked) return null;
        const LINE_PADDING = 20;
        const line = this.lines.find(l => gy >= (l.rect.top - LINE_PADDING) && gy <= (l.rect.bottom + LINE_PADDING));
        if (!line) return null;

        const WORD_PADDING = 15;
        const wordIndex = line.wordIndices.find(idx => {
            const w = this.words[idx];
            return gx >= (w.rect.left - WORD_PADDING) && gx <= (w.rect.right + WORD_PADDING);
        });

        if (wordIndex !== undefined) return { type: 'word', word: this.words[wordIndex], line: line };
        return { type: 'line', line: line };
    }

    triggerReturnEffect() {
        if (!this.cursor) return false;

        const now = Date.now();
        const COOLDOWN = 1500;

        if (this.lastReturnTime && (now - this.lastReturnTime < COOLDOWN)) return false;

        this.lastReturnTime = now;
        console.log("[TextRenderer] 🔥 Return Triggered!");

        // 1. Calculate Position based on CURRENT CURSOR Y
        const rect = this.cursor.getBoundingClientRect();
        const targetY = rect.top + (rect.height / 2);

        // SAFETY: Lazy-create if missing
        if (!this.impactElement || !document.contains(this.impactElement)) {
            console.warn("[TextRenderer] Impact element missing, recreating.");
            this.impactElement = document.createElement('div');
            this.impactElement.style.position = "fixed";
            this.impactElement.style.borderRadius = "50%";
            this.impactElement.style.backgroundColor = "magenta";
            this.impactElement.style.boxShadow = "0 0 15px magenta";
            this.impactElement.style.zIndex = "999999";
            this.impactElement.style.pointerEvents = "none";
            this.impactElement.style.opacity = "0";
            document.body.appendChild(this.impactElement);
        }

        const impact = this.impactElement;

        // Reset Style
        impact.style.transition = "none";
        impact.style.width = "10px";
        impact.style.height = "10px";
        impact.style.opacity = "1";
        impact.style.left = "20px"; // Fixed Left Margin
        impact.style.top = targetY + "px";
        impact.style.transform = "translate(-50%, -50%) scale(0.5)";

        // Force Reflow
        void impact.offsetWidth;

        // Animate: Snappy Pop (0.2s)
        // cubic-bezier(0.175, 0.885, 0.32, 1.275) gives a nice "pop" effect
        impact.style.transition = "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out";
        requestAnimationFrame(() => {
            impact.style.transform = "translate(-50%, -50%) scale(5)";
            impact.style.opacity = "0";
        });

        return true;
    }
}
window.TextRenderer = TextRenderer;
