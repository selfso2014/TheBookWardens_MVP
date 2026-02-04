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
                span.textContent = w;
                span.className = "tr-word"; // Base class
                // span.style.opacity = "0";   // Handled by CSS class .tr-word
                span.style.marginRight = this.options.wordSpacing;
                span.style.display = "inline-block"; // Important for reliable rects
                span.dataset.index = globalWordIndex;

                this.container.appendChild(span);

                // Store Metadata
                this.words.push({
                    index: globalWordIndex,
                    text: w,
                    chunkId: chunkIndex,
                    element: span,
                    rect: null // Will be filled in lockLayout
                });

                chunkWordIndices.push(globalWordIndex);
                globalWordIndex++;
            });

            this.chunks.push(chunkWordIndices);
        });

        // 3. Add a "cursor" element at the end (optional, can be managed separately)
        this.cursor = document.createElement("span");
        this.cursor.className = "tr-cursor";
        // REMOVED INLINE STYLES to let CSS control it (z-index, color, size)
        // Only layout-essential styles remain if needed, but CSS is better.
        this.container.appendChild(this.cursor);
    }

    /**
     * Locks the layout by calculating and caching the geometry of every word.
     * MUST be called after 'prepare' and before any interaction.
     */
    lockLayout() {
        if (this.words.length === 0) return;

        // Force a reflow if needed (reading properties does this)
        const containerRect = this.container.getBoundingClientRect();

        // --- 1. Cache Word Rects ---
        let currentLineY = -9999;
        let lineBuffer = [];

        // Helper: Create a Range to get TIGHT bounds of the text node (ignoring line-height)
        const range = document.createRange();

        this.words.forEach(word => {
            // A. Get Bounding Box (Visual Block including line-height/padding)
            const r = word.element.getBoundingClientRect();

            // B. Get TIGHT Glyph Bounds (Actual Ink) using Range
            // Assuming word.element contains a single text node or simple text
            range.selectNodeContents(word.element);
            const tightRect = range.getBoundingClientRect();

            // Calculate Visual Center based on TIGHT bounds (Robust fallback if tightRect is empty is r)
            // Safety Check: tightRect should have height and represent a valid screen position
            // If Text is hidden (opacity:0), tightRect might be 0.
            const useTight = tightRect.height > 0 && tightRect.top >= 0;

            // Visual Center Y: Center of the actual glyphs
            let visualCenterY = useTight
                ? tightRect.top + (tightRect.height / 2)
                : r.top + (r.height / 2);

            // Final Safety Net: If calculation failed (NaN or 0), force fallback to Box Center
            if (!visualCenterY || isNaN(visualCenterY)) {
                visualCenterY = r.top + (r.height / 2);
            }

            word.rect = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                centerX: r.left + r.width / 2,
                centerY: r.top + r.height / 2, // Default Box Center
                visualCenterY: visualCenterY   // NEW: Precise Glyph Center
            };

            // --- 2. Line Detection ---
            // Simple logic: if this word's top is significantly lower than previous, new line.
            // Using a threshold of approx half line-height.
            if (Math.abs(word.rect.top - currentLineY) > (word.rect.height * 0.5)) {
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
     * Visually reveals words in the chunk sequentially (Typing Effect).
     * @param {number} chunkIndex 
     * @param {number} interval - ms between words (default 50ms)
     * @returns {Promise} - Resolves when animation finishes
     */
    revealChunk(chunkIndex, interval = 50) {
        if (!this.isLayoutLocked) {
            this.lockLayout();
        }

        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return Promise.resolve();

        const indices = this.chunks[chunkIndex];

        return new Promise((resolve) => {
            indices.forEach((wordIdx, i) => {
                const w = this.words[wordIdx];
                // Staggered Timeout
                setTimeout(() => {
                    w.element.style.opacity = "1";
                    w.element.classList.add("revealed");

                    // Move cursor along with words
                    this.updateCursor(w);
                }, i * interval);
            });

            // Resolve after total duration
            setTimeout(resolve, indices.length * interval);
        });
    }

    updateCursor(wordObj) {
        if (!this.cursor || !wordObj) return;

        // Correct Vertical Alignment: Center of the LINE
        // Instead of word-relative heuristics, we use the Line's cached bounding box.
        let visualY;

        if (wordObj.lineIndex !== undefined && this.lines[wordObj.lineIndex]) {
            // Use the Robust Average Visual Center of the Line
            visualY = this.lines[wordObj.lineIndex].visualY;
        } else {
            // Fallback: Individual Word Visual Center
            visualY = wordObj.rect.visualCenterY;
        }

        const r = wordObj.rect; // Use cached rect

        this.cursor.style.position = "fixed";
        this.cursor.style.left = (r.right + 2) + "px";
        this.cursor.style.top = visualY + "px";

        // Remove height override for Dot Cursor
        this.cursor.style.height = "";

        this.cursor.style.opacity = "1";
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
