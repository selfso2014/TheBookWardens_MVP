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
        // v2026-02-05-1215: Retroactive Animation
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
        this.currentVisibleLineIndex = 0; // Reset on layout lock
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
        this.currentVisibleLineIndex = 0;
    }

    revealChunk(chunkIndex, interval = 150) {
        if (!this.isLayoutLocked) this.lockLayout();
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return Promise.resolve();

        const indices = this.chunks[chunkIndex];
        return new Promise((resolve) => {
            let cumulativeDelay = 0; // Cumulative time tracker

            indices.forEach((wordIdx, i) => {
                const w = this.words[wordIdx];
                // Check if this word starts a new visual line
                const isLineStart = this.lines.some(l => l.startIndex === w.index);

                // --- LINE CHANGE PAUSE (450ms) ---
                // If it's a new line (and not the very first word of the text), 
                // add a "breathing pause" to allow the eye to catch up.
                if (isLineStart && w.index > 0) {
                    cumulativeDelay += 450;
                }

                // Calculate execution time for this word
                const revealTime = cumulativeDelay;

                // 1. Move Cursor Early (Visual Cue)
                // If it's a line start, move the cursor BEFORE the text appears.
                // This guides the eye to the new line.
                if (isLineStart) {
                    const cursorMoveTime = Math.max(0, revealTime - 200); // 200ms lead
                    setTimeout(() => {
                        this.updateCursor(w, 'start');

                        // SYNC: Tell GazeDataManager about new line context!
                        if (typeof w.lineIndex === 'number' && this.lines[w.lineIndex]) {
                            this.currentVisibleLineIndex = w.lineIndex;
                            if (window.Game && window.Game.gazeManager) {
                                window.Game.gazeManager.setContext({
                                    lineIndex: w.lineIndex,
                                    lineY: this.lines[w.lineIndex].visualY
                                });
                            }
                        }
                    }, cursorMoveTime);
                }

                // 2. Reveal Word
                setTimeout(() => {
                    w.element.style.opacity = "1";
                    w.element.style.visibility = "visible";
                    w.element.classList.add("revealed");

                    // Update Line Index Context
                    if (typeof w.lineIndex === 'number') {
                        const newLineIdx = Math.max(this.currentVisibleLineIndex || 0, w.lineIndex);
                        if (newLineIdx !== this.currentVisibleLineIndex) {
                            this.currentVisibleLineIndex = newLineIdx;
                            if (window.Game && window.Game.gazeManager && this.lines[newLineIdx]) {
                                window.Game.gazeManager.setContext({
                                    lineIndex: newLineIdx,
                                    lineY: this.lines[newLineIdx].visualY
                                });
                            }
                        }
                    }

                    // Move Cursor to End of Word
                    this.updateCursor(w, 'end');
                }, revealTime);

                // Increment base time for next word (if not paused)
                cumulativeDelay += interval;
            });

            // Resolve Promise after the last word is shown
            setTimeout(resolve, cumulativeDelay + 100);
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
        // Must have lines
        if (!this.isLayoutLocked || this.lines.length === 0) return null;

        // 1. Strict Hit Test (Vertical)
        // Check if falls exactly within [top, bottom] with padding
        const LINE_PADDING = 30;
        let line = this.lines.find(l => gy >= (l.rect.top - LINE_PADDING) && gy <= (l.rect.bottom + LINE_PADDING));

        // 2. Fallback: Snap to NEAREST Line (Infinite Force Snap)
        // If the gaze is outside ALL strict line boundaries, we force it to the nearest line.
        // This solves the issue where "RawX is reading" but "LineIndex is null or stuck".
        if (!line) {
            let minDist = Infinity;
            let closest = null;
            this.lines.forEach(l => {
                const dist = Math.abs(l.visualY - gy);
                if (dist < minDist) {
                    minDist = dist;
                    closest = l;
                }
            });

            // Just take the closest, no matter how far.
            // Assumption: User is looking at the screen.
            if (closest) {
                line = closest;
            }
        }

        // If for some reason we still have no line (e.g. no lines created), return null
        if (!line) return null;

        // 3. Horizontal Hit Test (Word) within that line
        const WORD_PADDING = 15;
        const wordIndex = line.wordIndices.find(idx => {
            const w = this.words[idx];
            return gx >= (w.rect.left - WORD_PADDING) && gx <= (w.rect.right + WORD_PADDING);
        });

        if (wordIndex !== undefined) return { type: 'word', word: this.words[wordIndex], line: line };

        // If valid line but no word hit (space or margin), still return the line info!
        return { type: 'line', line: line };
    }

    triggerReturnEffect(lineIndex = null) {
        if (!this.cursor) return false;

        // --- Faster Animation (50ms) ---
        // Cooldown is handled by game.js (1.5s logic)
        // Here we just prevent visual glitching if called extremely fast (< 50ms)
        const now = Date.now();
        if (this.lastRenderTime && (now - this.lastRenderTime < 50)) return false;
        this.lastRenderTime = now;

        console.log("[TextRenderer] 🔥 Return Visual Triggered! Line:", lineIndex);

        let targetY;

        // 1. Calculate Target Y
        // Priority: Explicit Line Index (from GazeDataManager)
        if (lineIndex !== null && typeof lineIndex === 'number' && this.lines[lineIndex]) {
            // FIX: Use 0.52 to ALLIGN EXACTLY with the purple cursor's logic.
            // Single Source of Truth for visual vertical alignment.
            const l = this.lines[lineIndex];
            const VERTICAL_ALIGN_FACTOR = 0.52;
            targetY = l.rect.top + (l.rect.height * VERTICAL_ALIGN_FACTOR);
        } else {
            // Fallback: Current Cursor Position
            const rect = this.cursor.getBoundingClientRect();
            targetY = rect.top + (rect.height / 2);
        }

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

        // Reset Style (Instant)
        impact.style.transition = "none";
        impact.style.width = "10px";
        impact.style.height = "10px";
        impact.style.opacity = "1";
        impact.style.left = "20px"; // Fixed Left Margin
        impact.style.top = targetY + "px";
        impact.style.transform = "translate(-50%, -50%) scale(2.0)"; // Start Medium (20px)

        // Force Reflow
        void impact.offsetWidth;

        // Animate: Visible Flash (0.5s)
        // Changed from 0.05s to 0.5s to ensure visibility on mobile devices.
        impact.style.transition = "transform 0.5s ease-out, opacity 0.5s ease-in";

        requestAnimationFrame(() => {
            impact.style.transform = "translate(-50%, -50%) scale(4.0)"; // End at 40px
            impact.style.opacity = "0";
        });

        return true;
    }
}
window.TextRenderer = TextRenderer;
