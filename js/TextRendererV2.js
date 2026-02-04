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

        this.initStyles();
    }

    initStyles() {
        if (!this.container) return;
        this.container.style.position = "relative"; // For absolute positioning overlays if needed
        this.container.style.fontFamily = this.options.fontFamily;
        this.container.style.fontSize = this.options.fontSize;
        this.container.style.lineHeight = this.options.lineHeight;
        this.container.style.padding = this.options.padding;
        this.container.style.textAlign = "left";
        // Prevent scrolling shifts by default (container height should be fixed or managed)
    }

    /**
     * Parses the raw text containing '/' separators into structural data.
     * Renders invisible spans to the DOM.
     * 
     * @param {string} rawText - Text with '/' for chunk delimiters.
     */
    prepare(rawText) {
        if (!this.container) return;

        // 1. Reset
        this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = [];
        this.isLayoutLocked = false;

        // 2. Parse
        // Split by chunks first
        const rawChunks = rawText.split("/");

        let globalWordIndex = 0;

        rawChunks.forEach((chunkText, chunkIndex) => {
            // Clean trim
            const cleanChunk = chunkText.trim();
            if (!cleanChunk) return;

            const chunkWordIndices = [];
            // Split chunk into words
            const rawWords = cleanChunk.split(/\s+/);

            rawWords.forEach((w) => {
                // Create Span
                const span = document.createElement("span");
                span.className = "tr-word"; // Base class
                // FORCE STYLES for Debugging/Visibility
                span.style.color = "#ffffff";
                span.style.opacity = "0"; // Start hidden
                span.style.marginRight = this.options.wordSpacing;
                span.style.display = "inline-block";

                // CRITICAL FIX: Force line-height to be tight on the word element itself.
                // This maximizes the bounding box accuracy to the actual glyphs.
                // The parent container still handles the massive 2.5 line-height spacing.
                span.style.lineHeight = "1.2";

                // vertical-align: middle ensures this tight box sits in the middle of the tall line
                span.style.verticalAlign = "middle";

                span.dataset.index = globalWordIndex;

                // 1. Text Content
                span.textContent = w;

                this.container.appendChild(span);

                // Store Metadata
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
        // Remove existing cursor if any (to prevent duplicates on re-prepare)
        const oldCursor = document.querySelector('.tr-cursor');
        if (oldCursor) oldCursor.remove();

        this.cursor = document.createElement("span");
        this.cursor.className = "tr-cursor";

        // CRITICAL FIX: Remove cursor from document flow immediately.
        // This prevents it from sitting "below the text" if JS updates fail.
        this.cursor.style.position = "fixed";
        this.cursor.style.top = "-1000px"; // Hide off-screen initially
        this.cursor.style.left = "-1000px";
        this.cursor.style.zIndex = "9999"; // Ensure it floats above text
        this.cursor.style.pointerEvents = "none"; // Click-through

        // APPEND TO BODY to escape any CSS Stacking Context / Transform issues in container
        document.body.appendChild(this.cursor);
    }

    /**
     * Locks the layout by calculating and caching the geometry of every word.
     * MUST be called after 'prepare' and before any interaction.
     */
    lockLayout() {
        if (this.words.length === 0) return;

        // Force a reflow
        const containerRect = this.container.getBoundingClientRect();

        // --- 1. Cache Word Rects ---
        let currentLineY = -9999;
        let lineBuffer = [];

        this.words.forEach(word => {
            const r = word.element.getBoundingClientRect();

            // C. TYPOGRAPHIC CENTER STRATEGY
            // Geometric Center (0.5) is visually too low.
            // User Feedback: 0.35 was STILL too low.
            // Very Aggressive Correction: Shift to 0.25 (Top Quartile).
            const visualCenterY = r.top + (r.height * 0.25);

            word.rect = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                centerX: r.left + r.width / 2,
                centerY: r.top + r.height / 2, // Geometric Center (for debug)
                visualCenterY: visualCenterY   // Typographic Center (for cursor)
            };

            // --- 2. Line Detection ---
            // Simple logic: if this word's top is significantly lower than previous, new line.
            // But since elements are now vertically aligned middle, their top might vary slightly.
            // Use a threshold relative to the *Container's* effective line height (approx 60px)
            // Or just check if 'top' jumped more than the element's height.
            if (Math.abs(word.rect.top - currentLineY) > (word.rect.height * 1.5)) {
                // Commit previous line
                if (lineBuffer.length > 0) {
                    this.lines.push(this._finalizeLine(lineBuffer));
                }
                // Start new line
                lineBuffer = [word];
                currentLineY = word.rect.top;
            } else {
                lineBuffer.push(word);
            }
        });

        // Commit last line
        if (lineBuffer.length > 0) {
            this.lines.push(this._finalizeLine(lineBuffer));
        }

        this.isLayoutLocked = true;
        console.log(`[TextRenderer] Layout Locked (Range-Based): ${this.words.length} words, ${this.lines.length} lines.`);
    }

    _finalizeLine(words) {
        // Calculate bounding box of the line
        const first = words[0].rect;
        const last = words[words.length - 1].rect;

        // Define lineIndex derived from current lines count
        const lineIndex = this.lines.length;

        // Find min top and max bottom in this line
        const minTop = Math.min(...words.map(w => w.rect.top));
        const maxBottom = Math.max(...words.map(w => w.rect.bottom));

        // Assign Line Index to Words for precise lookup
        // Also calculate Average Visual Center for the Line
        let sumVisualY = 0;
        words.forEach(w => {
            w.lineIndex = lineIndex;
            sumVisualY += w.rect.visualCenterY;
        });

        const avgVisualY = sumVisualY / words.length;

        return {
            index: lineIndex,
            startIndex: words[0].index,
            endIndex: words[words.length - 1].index,
            wordIndices: words.map(w => w.index),
            visualY: avgVisualY, // NEW: The mathematically derived visual center
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

    /**
     * Resets cursor to the start of the first word (Left side).
     * Used for the initial 3-second ready phase.
     */
    resetToStart() {
        if (this.words.length > 0) {
            this.updateCursor(this.words[0], 'start');
        }
    }

    /**
     * Visually reveals words in the chunk sequentially (Typing Effect).
     * @param {number} chunkIndex 
     * @param {number} interval - ms between words (default 150ms, relaxed pace)
     * @returns {Promise} - Resolves when animation finishes
     */
    revealChunk(chunkIndex, interval = 150) {
        if (!this.isLayoutLocked) {
            this.lockLayout();
        }

        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return Promise.resolve();

        const indices = this.chunks[chunkIndex];

        return new Promise((resolve) => {
            // Check if this chunk starts a new line
            // If so, we shift the timeline to allow cursor to "jump" to the start first
            const firstW = this.words[indices[0]];
            const chunkStartsLine = this.lines.some(l => l.startIndex === firstW.index);

            // If it's a new line (and not the very first intro chunk which is handled by game.js),
            // we insert a "Travel Time"
            let timeOffset = 0;
            if (chunkStartsLine && chunkIndex > 0) {
                timeOffset = 400; // ms for cursor return sweep
                // Trigger the move to start immediately (at t=0 relative to this call)
                this.updateCursor(firstW, 'start');
            }

            indices.forEach((wordIdx, i) => {
                const w = this.words[wordIdx];
                const delay = i * interval + timeOffset;

                // Check Line Start for internal words
                const isLineStart = this.lines.some(l => l.startIndex === w.index);

                // CRITICAL: "Cursor moves first" logic for Line Breaks
                // If this word starts a new line, flip cursor to the LEFT 
                // slightly before the word appears.
                if (isLineStart && i > 0) {
                    const leadTime = Math.min(interval * 0.8, 300);
                    setTimeout(() => {
                        this.updateCursor(w, 'start');
                    }, delay - leadTime);
                }

                // Staggered Timeout
                setTimeout(() => {
                    // Force Opacity 1
                    w.element.style.opacity = "1";
                    w.element.style.visibility = "visible"; // Extra safety
                    w.element.classList.add("revealed");

                    // Move cursor along with words (Standard: End of word)
                    this.updateCursor(w, 'end');
                }, delay);
            });

            // Resolve after total duration
            setTimeout(resolve, indices.length * interval + timeOffset);
        });
    }

    updateCursor(wordObj, align = 'end') {
        if (!this.cursor || !wordObj || !wordObj.element) return;

        try {
            // LIVE TRACKING STRATEGY
            // Do not use cached 'this.lines' or 'wordObj.rect' for cursor positioning.
            // The text container might have animated/shifted (e.g. translateY) after lockLayout.
            // We must measure the element's CURRENT position on screen.
            const currentRect = wordObj.element.getBoundingClientRect();

            // Offset logic: Top of the tight box + 52% of height
            // User requested "slightly lower than center"
            const visualY = currentRect.top + (currentRect.height * 0.52);

            // X Position based on Alignment
            let visualX;
            if (align === 'start' || align === 'left') {
                visualX = currentRect.left - 4; // Start of word
            } else {
                visualX = currentRect.right + 2; // End of word
            }

            // Apply Styles
            this.cursor.style.position = "fixed";
            this.cursor.style.left = visualX + "px";
            this.cursor.style.top = visualY + "px";
            this.cursor.style.opacity = "1";

        } catch (e) {
            console.error("[TextRenderer] Cursor Update Error:", e);
        }
    }

    /**
     * Performs a high-performance hit test against the cached layout.
     * @param {number} gx - Gaze X
     * @param {number} gy - Gaze Y
     * @returns {object|null} - { type: 'word'|'line', data: ... }
     */
    hitTest(gx, gy) {
        if (!this.isLayoutLocked) return null;

        // 1. Optimize: First find the LINE.
        // Gaze Y is usually the primary filter.
        // Expand hit area slightly (padding)
        const LINE_PADDING = 20; // px

        const line = this.lines.find(l =>
            gy >= (l.rect.top - LINE_PADDING) &&
            gy <= (l.rect.bottom + LINE_PADDING)
        );

        if (!line) return null;

        // 2. Find WORD within Line
        // Expand X padding
        const WORD_PADDING = 15; // px

        const wordIndex = line.wordIndices.find(idx => {
            const w = this.words[idx];
            return gx >= (w.rect.left - WORD_PADDING) &&
                gx <= (w.rect.right + WORD_PADDING);
        });

        if (wordIndex !== undefined) {
            return {
                type: 'word',
                word: this.words[wordIndex],
                line: line
            };
        }

        // Hit line but not specific word (whitespace or margin)
        return {
            type: 'line',
            line: line
        };
    }
}

// Export for module usage or global
window.TextRenderer = TextRenderer;
