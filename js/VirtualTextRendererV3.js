/**
 * VirtualTextRendererV3.js
 * 
 * Optimized Text Renderer using Virtualization (Windowing) Key Concepts:
 * 1. Only renders words currently visible in the viewport + small buffer.
 * 2. Recycles DOM elements or aggressively culls off-screen elements.
 * 3. Handles 'Chunk' reveals just like V2, but only applies styles to active nodes.
 * 4. Drastically reduces DOM count (1000+ -> ~100) and GPU memory usage.
 */
import { TextChunker } from './TextChunker.js';

export class VirtualTextRenderer {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.options = {
            fontSize: options.fontSize || "1.3rem",
            lineHeight: options.lineHeight || "2.8",
            wordSpacing: options.wordSpacing || "0.4em",
            padding: options.padding || "20px",
            fontFamily: "Pretendard, sans-serif",
            bufferLines: 2, // Lines to keep above/below viewport
        };

        // Data Source
        this.allWords = []; // Plain JS Objects { text, index, isRune, runeId, ... }
        this.chunks = [];   // Array of word indices arrays
        this.lines = [];    // Array of { startIndex, endIndex, top, bottom }

        // State
        this.activeAnimations = [];
        this.currentWordIndex = 0;
        this.visibleRange = { start: 0, end: 0 }; // Word indices currently in DOM

        // DOM Cache
        this.activeElements = new Map(); // wordIndex -> DOM Element
        this.pool = []; // Recycled spans

        // Metrics
        this.containerWidth = 0;
        this.containerHeight = 0;

        this.initStyles();

        // Bind resize
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        if (this.container) this.resizeObserver.observe(this.container);
    }

    initStyles() {
        if (!this.container) return;
        this.container.style.position = "relative";
        this.container.style.fontFamily = this.options.fontFamily;
        this.container.style.fontSize = this.options.fontSize;
        this.container.style.lineHeight = this.options.lineHeight;
        this.container.style.padding = this.options.padding;
        this.container.style.textAlign = "left";

        // GPU Acceleration
        this.container.style.willChange = "transform";
        this.container.style.transform = "translateZ(0)";
    }

    onResize() {
        // Debounce resize
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
            if (this.allWords.length > 0) {
                console.log("[VirtualRenderer] Resizing - Relayout needed.");
                // For simplicity in MVP, we might just re-render or ignore if text is static.
                // But typically we need to re-measure lines.
                // To avoid complex re-flow mid-game, we'll skip for now unless critical.
            }
        }, 200);
    }

    dispose() {
        // [MEMORY] Critical Cleanup
        this.cancelAllAnimations();

        if (this.resizeObserver) this.resizeObserver.disconnect();

        if (this.container) {
            this.container.innerHTML = "";
        }

        this.activeElements.clear();
        this.pool = [];
        this.allWords = [];
        this.chunks = [];
        this.lines = [];

        console.log("[VirtualRenderer] Disposed.");
    }

    cancelAllAnimations() {
        this.activeAnimations.forEach(id => clearTimeout(id));
        this.activeAnimations = [];
    }

    // --- Core Logic: Prepare Data (No DOM yet) ---
    prepareDynamic(chapterData, wpm = 150) {
        this.dispose();
        // Re-init basics after dispose
        this.activeElements = new Map();
        this.pool = [];
        if (this.container) this.resizeObserver.observe(this.container);

        if (!chapterData || !chapterData.paragraphs) return;

        // 1. Flatten Data
        let globalIndex = 0;
        let allTokens = [];
        let allHighlights = [];
        let tokenOffset = 0;

        chapterData.paragraphs.forEach(p => {
            // Add paragraph break if strict block needed, but flow is fine.
            p.tokens.forEach(t => allTokens.push(t));
            if (p.vocab_highlights) {
                p.vocab_highlights.forEach(h => {
                    allHighlights.push({
                        ...h,
                        target_token_index: h.target_token_index + tokenOffset
                    });
                });
            }
            tokenOffset += p.tokens.length;
        });

        // 2. Chunking
        const groupedChunks = TextChunker.process(allTokens, wpm, allHighlights);
        this.chunks = groupedChunks; // [[0,1,2], [3,4], ...]

        // 3. Create Word Objects (Lightweight)
        const highlightMap = new Map();
        allHighlights.forEach(h => highlightMap.set(h.target_token_index, h));

        groupedChunks.forEach(chunkIndices => {
            chunkIndices.forEach(idx => { // Check TextChunker output format
                // Actually TextChunker returns objects {t, originalIndex, ...} in array
                // Let's assume process returns array of arrays of Token Objects.
            });
        });

        // Re-mapping logic matching TextRendererV2
        let wordIdx = 0;
        this.chunks = [];

        groupedChunks.forEach(chunkTokens => {
            const indices = [];
            chunkTokens.forEach(tokenObj => {
                const isRune = highlightMap.has(tokenObj.originalIndex);
                const hData = highlightMap.get(tokenObj.originalIndex);

                this.allWords.push({
                    index: wordIdx,
                    text: tokenObj.t,
                    isRune: isRune,
                    runeId: isRune ? hData.word_id : null,
                    // Layout placeholers
                    lineIndex: -1,
                    x: 0, y: 0, width: 0, height: 0,
                    dom: null // Reference if active
                });
                indices.push(wordIdx);
                wordIdx++;
            });
            this.chunks.push(indices);
        });

        console.log(`[VirtualRenderer] Prepared ${this.allWords.length} words in ${this.chunks.length} chunks.`);
    }

    // --- Layout: Measure & Line Breaking ---
    // We must measure ALL words once to determine line breaks and total height.
    // To do this efficiently, we append everything, measure, then remove?
    // Or use Canvas measurement? 
    // Accuracy is key. Appending all visibility:hidden is safest for consistent wrapping.
    lockLayout() {
        return new Promise((resolve) => {
            if (!this.container) return resolve();

            // 1. Render ALL words invisible to measure natural flow
            const fragment = document.createDocumentFragment();
            this.allWords.forEach(w => {
                const span = this.createSpan(w);
                span.style.opacity = "0"; // Keep layout, hide visual
                fragment.appendChild(span);
                // We keep direct reference temporarily
                w.tempDom = span;
            });
            this.container.appendChild(fragment);

            // 2. Measure (Reflow triggers here)
            // Group by Top/Bottom to find Lines
            let currentLineY = -1;
            let currentLineIndex = -1;
            const lineThreshold = 10; // px tolerance

            this.allWords.forEach(w => {
                const rect = w.tempDom.getBoundingClientRect();
                // Relative to container
                const contRect = this.container.getBoundingClientRect();
                const relY = rect.top - contRect.top;
                const relX = rect.left - contRect.left;

                w.x = relX;
                w.y = relY;
                w.width = rect.width;
                w.height = rect.height;

                // Line Detection
                if (Math.abs(relY - currentLineY) > lineThreshold) {
                    currentLineY = relY;
                    currentLineIndex++;
                    this.lines[currentLineIndex] = {
                        startIndex: w.index,
                        endIndex: w.index,
                        top: relY,
                        bottom: relY + rect.height
                    };
                } else {
                    // Update current line
                    this.lines[currentLineIndex].endIndex = w.index;
                    this.lines[currentLineIndex].bottom = Math.max(this.lines[currentLineIndex].bottom, relY + rect.height);
                }
                w.lineIndex = currentLineIndex;
            });

            // 3. Clear DOM (Go Virtual!)
            this.container.innerHTML = "";
            this.allWords.forEach(w => {
                w.tempDom = null; // Detach
            });

            console.log(`[VirtualRenderer] Layout Locked: ${this.lines.length} lines.`);
            resolve();
        });
    }

    createSpan(wordObj) {
        const span = document.createElement("span");
        span.className = "tr-word";
        if (wordObj.isRune) {
            span.classList.add("rune-word");
            span.dataset.wordId = wordObj.runeId;
        }
        span.textContent = wordObj.text;
        span.dataset.index = wordObj.index;

        // Styles
        span.style.color = "#ffffff";
        span.style.marginRight = this.options.wordSpacing;
        span.style.display = "inline-block";
        span.style.lineHeight = "1.2";
        span.style.opacity = "0"; // Default hidden

        return span;
    }

    // --- Virtual Rendering: Update View ---
    /**
     * Renders words based on visible chunk or manual range.
     * Strategy: Always ensure words for 'activeChunkIndex' and surrounding context are in DOM.
     */
    updateVisibleRange(centerLineIndex) {
        if (!this.lines.length) return;

        const range = 4; // Render +-4 lines (Total ~9 lines)
        const startLine = Math.max(0, centerLineIndex - range);
        const endLine = Math.min(this.lines.length - 1, centerLineIndex + range);

        const startWordIdx = this.lines[startLine].startIndex;
        const endWordIdx = this.lines[endLine].endIndex;

        // Diff & Patch
        // 1. Remove active elements outside new range
        // 2. Add missing elements inside new range

        // Removal
        for (const [idx, el] of this.activeElements.entries()) {
            if (idx < startWordIdx || idx > endWordIdx) {
                el.remove(); // Remove from DOM
                this.activeElements.delete(idx);
                // Ideally return to pool? Simplified for now.
            }
        }

        // Addition
        // We use absolute positioning for virtual elements? 
        // NO. Absolute positioning is tricky with inline flow.
        // BUT we pre-measured everything (w.x, w.y). 
        // So we CAN use absolute positioning to place them exactly where they were measured!
        // This is robust against reflows.

        const fragment = document.createDocumentFragment();

        for (let i = startWordIdx; i <= endWordIdx; i++) {
            if (!this.activeElements.has(i)) {
                const w = this.allWords[i];
                const span = this.createSpan(w);

                // FORCE POSITIONING based on Locked Layout
                span.style.position = "absolute";
                span.style.left = `${w.x}px`;
                span.style.top = `${w.y}px`;
                span.style.width = `${w.width}px` // Optional, might break font rendering slightly, but prevents jumping
                // Actually height/width are result of content. Fix only pos.

                this.activeElements.set(i, span);
                w.dom = span; // Update reference
                fragment.appendChild(span);
            }
        }

        if (fragment.childNodes.length > 0) {
            this.container.appendChild(fragment);
        }
    }

    // --- Chunk Reveal (API compatible with Game.js) ---
    revealChunk(chunkIndex, interval = 50) {
        return new Promise((resolve) => {
            if (chunkIndex >= this.chunks.length) return resolve();

            const wordIndices = this.chunks[chunkIndex];
            if (wordIndices.length === 0) return resolve();

            // 1. Ensure these words are in DOM (Virtualize around this chunk)
            const firstWord = this.allWords[wordIndices[0]];
            this.updateVisibleRange(firstWord.lineIndex);

            // 2. Animate them
            let delay = 0;
            // [JIT TRACKING] - Trigger start if not already
            if (window.Game && window.Game.state && !window.Game.state.isTracking) {
                window.Game.state.isTracking = true;
            }

            wordIndices.forEach((idx, i) => {
                const timerId = setTimeout(() => {
                    const el = this.activeElements.get(idx);
                    if (el) {
                        el.style.opacity = "1";
                        el.style.transform = "translateY(0)";
                        // Add glow if rune?
                    }
                }, delay);
                this.activeAnimations.push(timerId);
                delay += interval;
            });

            setTimeout(resolve, delay + 100);
        });
    }

    scheduleFadeOut(chunkIndex, delay) {
        const timerId = setTimeout(() => {
            const wordIndices = this.chunks[chunkIndex];
            if (!wordIndices) return;

            wordIndices.forEach(idx => {
                const el = this.activeElements.get(idx);
                if (el) {
                    el.style.transition = "opacity 0.5s";
                    el.style.opacity = "0.2"; // Dim instead of remove to keep context?
                    // Or "Remove from screen" if strictly virtual.
                    // If we "Dim", we keep them visible.
                    // If we remove, user can't read back.
                    // Game design: "Train effect". Old text fades out.
                    el.style.opacity = "0";
                }
            });
        }, delay);
        this.activeAnimations.push(timerId);
    }

    // --- Helpers ---
    showPage(pageIndex) {
        // Compatibility method.
        // Virtual renderer doesn't use pages, it's continuous. 
        // But initial call expects it.
        // Just resolve immediately.
        return Promise.resolve();
    }

    resetToStart() {
        this.activeElements.forEach(el => el.remove());
        this.activeElements.clear();
        this.updateVisibleRange(0);
    }
}
