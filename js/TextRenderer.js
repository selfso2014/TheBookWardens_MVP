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
                span.style.opacity = "0";   // Invisible initially
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
        this.cursor.style.display = "inline-block";
        this.cursor.style.width = "2px";
        this.cursor.style.height = "1em";
        this.cursor.style.backgroundColor = "gold";
        this.cursor.style.opacity = "0";
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

        this.words.forEach(word => {
            const r = word.element.getBoundingClientRect();

            // Store absolute rect (relative to viewport)
            // If the container scrolls, this needs care. 
            // We assume the container is FIXED position or user doesn't scroll during reading.
            // If scrolling happens, we need to store relative to container + scrollTop.

            word.rect = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                centerX: r.left + r.width / 2,
                centerY: r.top + r.height / 2
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
        console.log(`[TextRenderer] Layout Locked: ${this.words.length} words, ${this.lines.length} lines.`);
    }

    _finalizeLine(words) {
        // Calculate bounding box of the line
        const first = words[0].rect;
        const last = words[words.length - 1].rect;

        // Find min top and max bottom in this line
        const minTop = Math.min(...words.map(w => w.rect.top));
        const maxBottom = Math.max(...words.map(w => w.rect.bottom));

        return {
            startIndex: words[0].index,
            endIndex: words[words.length - 1].index,
            wordIndices: words.map(w => w.index),
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
     * Visually reveals words up to the given chunk index.
     * Does NOT change layout. Only changes opacity/color.
     */
    revealChunk(chunkIndex) {
        if (!this.isLayoutLocked) {
            console.warn("Layout not locked! Call lockLayout() first.");
            this.lockLayout();
        }

        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return;

        const indices = this.chunks[chunkIndex];
        indices.forEach(idx => {
            const w = this.words[idx];
            w.element.style.opacity = "1";
            w.element.classList.add("revealed");
        });

        // Move cursor to end of this chunk
        const lastWord = this.words[indices[indices.length - 1]];
        this.updateCursor(lastWord);
    }

    updateCursor(wordObj) {
        if (!this.cursor || !wordObj) return;
        const r = wordObj.rect; // Use cached rect
        // Position cursor visually after the word
        // Since cursor is absolute or we use transform
        // Best to use fixed/absolute positioning based on cached rect
        this.cursor.style.position = "fixed"; // Or absolute relative to body
        this.cursor.style.left = (r.right + 2) + "px";
        this.cursor.style.top = r.top + "px";
        this.cursor.style.height = r.height + "px";
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
