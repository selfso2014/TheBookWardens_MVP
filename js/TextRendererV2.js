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
import { bus } from "./core/EventBus.js";
import { TextChunker } from "./utils/TextChunker.js";

export class TextRenderer {
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

        // [New] Animation Safety
        this.activeAnimations = []; // Store timeout IDs to cancel them on reset/page turn

        // Visual Elements
        this.cursor = null;
        this.impactElement = null;

        this.initStyles();
    }

    // [New] Safety Method: Kill all pending text reveals
    cancelAllAnimations() {
        if (this.activeAnimations.length > 0) {
            console.log(`[TextRenderer] Cancelling ${this.activeAnimations.length} pending animations.`);
            this.activeAnimations.forEach(id => clearTimeout(id));
            this.activeAnimations = [];
        }
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

    prepareDynamic(chapterData, wpm = 150) {
        if (!this.container) return;
        this.cancelAllAnimations();

        // Clear state
        this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = [];
        this.isLayoutLocked = false;

        if (!chapterData || !chapterData.paragraphs) return;

        // Flatten paragraphs into single token stream
        let allTokens = [];
        let allHighlights = [];
        let tokenOffset = 0;

        chapterData.paragraphs.forEach(p => {
            // Add paragraph break if needed? Usually text flows.
            // But we might want a visual break.
            // For now, simple concatenation.

            p.tokens.forEach(t => {
                allTokens.push(t);
            });

            if (p.vocab_highlights) {
                p.vocab_highlights.forEach(h => {
                    allHighlights.push({
                        ...h,
                        target_token_index: h.target_token_index + tokenOffset,
                        originalParagraphId: p.id
                    });
                });
            }
            tokenOffset += p.tokens.length;
        });

        // Use DSC Algorithm to chunk text
        console.log(`[TextRenderer] Preparing Dynamic Text for WPM: ${wpm}`);
        const groupedChunks = TextChunker.process(allTokens, wpm, allHighlights);

        // Render Chunks to DOM
        let globalWordIndex = 0;

        // Create Highlight Map for O(1) Lookup
        const highlightMap = new Map();
        allHighlights.forEach(h => highlightMap.set(h.target_token_index, h));

        groupedChunks.forEach((chunkTokens, chunkIdx) => {
            const currentChunkIndices = [];

            chunkTokens.forEach((tokenObj) => {
                // Determine if this is a Rune Word
                // tokenObj has 'originalIndex' relative to 'allTokens' if passed correctly?
                // Wait, TextChunker loop uses 'i' from 0..tokens.length.
                // So tokenObj.originalIndex IS the global index if we passed allTokens.
                const isRuneWord = highlightMap.has(tokenObj.originalIndex);
                const highlightData = highlightMap.get(tokenObj.originalIndex);

                // Create Span
                const span = document.createElement("span");
                span.className = "tr-word";
                if (isRuneWord) {
                    span.classList.add("rune-word");
                    span.dataset.wordId = highlightData.word_id;
                    // Initial Style for Rune Word?
                    // Bold? Glow? Handled by CSS or Logic later.
                    // span.style.fontWeight = "bold"; // Example default
                }

                span.style.color = "#ffffff"; // Default
                span.style.opacity = "0";
                span.style.marginRight = this.options.wordSpacing;
                span.style.display = "inline-block";
                span.style.lineHeight = "1.2";
                span.style.verticalAlign = "middle";
                span.dataset.index = globalWordIndex;
                span.textContent = tokenObj.t;

                this.container.appendChild(span);

                // Add to system
                this.words.push({
                    element: span,
                    text: tokenObj.t,
                    index: globalWordIndex,
                    rect: null,
                    isRuneWord: isRuneWord,
                    runeId: isRuneWord ? highlightData.word_id : null
                });

                currentChunkIndices.push(globalWordIndex);
                globalWordIndex++;
            });

            this.chunks.push(currentChunkIndices);
        });

        console.log(`[TextRenderer] Dynamic Layout: ${this.chunks.length} chunks from ${allTokens.length} tokens.`);

        // Common Setup
        this.addVisualAugments();
        this.paginate();
    }

    addVisualAugments() {
        // Reset Pagination State
        this.pages = [];
        this.currentPageIndex = 0;
        this.validatedLines = new Set();

        // Remove old layers
        const oldLayer = document.getElementById("pang-marker-layer");
        if (oldLayer) oldLayer.remove();

        const oldCursor = document.querySelector('.tr-cursor');
        if (oldCursor) oldCursor.remove();

        // Create Cursor
        this.cursor = document.createElement("span");
        this.cursor.className = "tr-cursor";
        this.cursor.style.position = "fixed";
        this.cursor.style.top = "-1000px";
        this.cursor.style.left = "-1000px";
        this.cursor.style.zIndex = "9999";
        this.cursor.style.pointerEvents = "none";
        this.cursor.style.opacity = "0";
        this.cursor.style.backgroundColor = "transparent";
        document.body.appendChild(this.cursor);

        // Create Impact
        if (!this.impactElement) {
            this.impactElement = document.createElement('div');
            this.impactElement.id = "tr-impact-effect";
            this.impactElement.style.position = "fixed";
            this.impactElement.style.borderRadius = "50%";
            this.impactElement.style.backgroundColor = "magenta";
            this.impactElement.style.boxShadow = "0 0 15px magenta";
            this.impactElement.style.zIndex = "999999";
            this.impactElement.style.pointerEvents = "none";
            this.impactElement.style.opacity = "0";
            this.impactElement.style.width = "10px";
            this.impactElement.style.height = "10px";
            document.body.appendChild(this.impactElement);
        }

        if (this.words.length > 0) {
            setTimeout(() => {
                this.updateCursor(this.words[0], 'start');
                this.cursor.style.opacity = '0';
            }, 50);
        }

        this.lastReturnTime = Date.now() + 2000;
    }

    prepare(rawText) {
        if (!this.container) return;
        this.cancelAllAnimations();

        // Clear previous state
        if (this.container) this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = []; // [FIX] Reset lines
        this.isLayoutLocked = false; // [FIX] Unlock layout

        if (!rawText) return;

        // ... Legacy Logic ...

        // --- DYNAMIC CHUNKING LOGIC (Legacy Mode) ---
        // 1. Get Target Chunk Size (Default to 4 if not set)
        const targetSize = (typeof Game !== 'undefined' && Game.targetChunkSize) ? Game.targetChunkSize : 4;
        console.log(`[TextRenderer] Preparing text with Chunk Size: ${targetSize}`);

        // 2. Normalize Text: Remove existing '/' delimiters which were static
        const cleanText = rawText.replace(/\//g, " ");

        // 3. Split into Words
        const rawWords = cleanText.trim().split(/\s+/);

        let currentChunkIndices = [];
        let wordCountInChunk = 0;

        rawWords.forEach((w, index) => {
            // ... legacy rendering ...
            const span = document.createElement("span");
            span.className = "tr-word";
            span.style.color = "#ffffff";
            span.style.opacity = "0";
            span.style.marginRight = this.options.wordSpacing;
            span.style.display = "inline-block";
            span.style.lineHeight = "1.2";
            span.style.verticalAlign = "middle";
            span.dataset.index = index;
            span.textContent = w;

            this.container.appendChild(span);
            this.words.push({ element: span, text: w, index: index, rect: null });

            currentChunkIndices.push(index);
            wordCountInChunk++;

            const isPunctuation = w.includes('.') || w.includes('?') || w.includes('!') || w.includes(',') || w.includes(';') || w.includes(':');

            if (isPunctuation || wordCountInChunk >= targetSize) {
                this.chunks.push(currentChunkIndices);
                currentChunkIndices = [];
                wordCountInChunk = 0;
            }
        });

        if (currentChunkIndices.length > 0) this.chunks.push(currentChunkIndices);

        this.addVisualAugments();
        this.paginate();
    }

    /* paginate() { ... } */

    paginate() {
        if (!this.container || this.words.length === 0) return;

        const containerHeight = this.container.clientHeight;
        const paddingBottom = 40; // Safety margin
        const maxHeight = containerHeight - paddingBottom;

        let currentPage = [];
        this.pages = [currentPage];

        // Temporarily ensure all words are visible to measure properly
        this.words.forEach(w => w.element.style.display = "inline-block");

        // Simple Greedy Pagination by Top coordinate
        // WE MUST MEASURE. Forcing a reflow here is necessary.
        let currentY = -9999;
        let pageStartY = this.words[0].element.offsetTop;

        // Strategy: Iterate words. If a word's bottom exceeds (pageStart + maxHeight), start new page.
        this.words.forEach((w, i) => {
            const el = w.element;
            const top = el.offsetTop;
            const bottom = top + el.offsetHeight;

            // Check if this word fits in current page
            // Relative Top from current page start
            const relTop = top - pageStartY;
            const relBottom = bottom - pageStartY;

            if (relBottom > maxHeight && currentPage.length > 0) {
                // Overflow! Start new page.
                currentPage = [];
                this.pages.push(currentPage);
                pageStartY = top; // New page starts here roughly
            }

            currentPage.push(w);
            w.pageIndex = this.pages.length - 1;
        });

        console.log(`[TextRenderer] Paginated into ${this.pages.length} pages.`);
    }

    showPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.pages.length) return false;

        // [SAFETY] Stop any ongoing typing effects from previous page!
        this.cancelAllAnimations();

        this.currentPageIndex = pageIndex;

        // Hide ALL words first
        this.words.forEach(w => {
            w.element.style.display = "none";
            w.element.style.opacity = "0"; // Reset opacity for animation
            w.element.classList.remove("revealed");
        });

        // Show words in current page
        const pageWords = this.pages[pageIndex];
        pageWords.forEach(w => {
            w.element.style.display = "inline-block";
        });

        // Important: Re-lock Layout for this page's content
        // This ensures hit-testing words on THIS page works correctly.
        // We delay slightly to allow display:block to reflow.
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                this.lockLayout(); // Recalculate lines for current page
                resolve();
            });
        });
    }

    lockLayout() {
        if (this.words.length === 0) return;

        // [CRITICAL FIX] Reset lines array before recalculating.
        // Otherwise, lines accumulate across page turns, causing index jumps (e.g., 0 -> 9).
        this.lines = [];

        const containerRect = this.container.getBoundingClientRect();
        let currentLineY = -9999;
        let lineBuffer = [];

        this.words.forEach(word => {
            const r = word.element.getBoundingClientRect();

            // [CRITICAL FIX] Skip invisible words (e.g., words from other pages).
            // They have rect {0,0,0,0} and should not form lines.
            if (r.width === 0 && r.height === 0) return;

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

        // [CRITICAL] Reset Line Index for NEW Page / Layout Lock
        // When we lock layout (usually means page start), the index MUST start at 0.
        this.currentVisibleLineIndex = 0;

        console.log(`[TextRenderer] Layout Locked: ${this.words.length} words (checked), ${this.lines.length} lines created.`);
        if (this.lines.length > 0) {
            console.log(`[TextRenderer] Line 0 Y: ${this.lines[0].rect.top.toFixed(1)}, Line ${this.lines.length - 1} Y: ${this.lines[this.lines.length - 1].rect.top.toFixed(1)}`);
        } else {
            console.warn("[TextRenderer] WARNING: No lines created! Check word visibility or threshold.");
        }
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
                if (isLineStart) {
                    const cursorMoveTime = Math.max(0, revealTime - 200);
                    const tid1 = setTimeout(() => {
                        this.updateCursor(w, 'start');
                        // SYNC: Tell GazeDataManager...
                        if (typeof w.lineIndex === 'number' && this.lines[w.lineIndex]) {
                            this.currentVisibleLineIndex = w.lineIndex;
                            // [COORDINATION] Robust Gaze Manager Lookup
                            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
                            if (gm && typeof gm.setContext === 'function') {
                                gm.setContext({
                                    lineIndex: w.lineIndex,
                                    lineY: this.lines[w.lineIndex].visualY
                                });
                            }
                        }
                    }, cursorMoveTime);
                    this.activeAnimations.push(tid1);
                }

                // 2. Reveal Word
                const tid2 = setTimeout(() => {
                    w.element.style.opacity = "1";
                    w.element.style.visibility = "visible";
                    w.element.classList.add("revealed");

                    // Update Line Index Context
                    if (typeof w.lineIndex === 'number') {
                        if (w.lineIndex !== this.currentVisibleLineIndex) {
                            this.currentVisibleLineIndex = w.lineIndex;
                            // [COORDINATION] Robust Gaze Manager Lookup
                            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
                            if (gm && typeof gm.setContext === 'function' && this.lines[w.lineIndex]) {
                                gm.setContext({
                                    lineIndex: w.lineIndex,
                                    lineY: this.lines[w.lineIndex].visualY
                                });
                            }
                        }
                    }

                    // Move Cursor to End of Word
                    this.updateCursor(w, 'end');
                }, revealTime);
                this.activeAnimations.push(tid2);

                // Increment base time
                cumulativeDelay += interval;
            });

            // Cleanup Logic? (Optional, but good for memory)
            // For now, simple centralized clearance on reset is enough.

            // Resolve Promise after the last word is shown
            const finalTid = setTimeout(resolve, cumulativeDelay + 100);
            this.activeAnimations.push(finalTid);
        });
    }

    updateCursor(wordObj, align = 'end') {
        const readScreen = document.getElementById('screen-read');
        // Safely check if active. If NOT active, force hide and return.
        if (readScreen && !readScreen.classList.contains('active')) {
            if (this.cursor) this.cursor.style.display = 'none';
            return;
        }

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
            this.cursor.style.opacity = "0"; // Force Hidden (Guide Runner)
            this.cursor.style.backgroundColor = "transparent";

            // STORE TRUTH: Save exact Y for Pang Event
            this.latestCursorY = visualY;
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

    // --- RGT (Relative Gaze Trigger) Logic ---
    checkRuneTriggers(gazeX, gazeY) {
        if (!this.lines || this.lines.length === 0) return;

        const gdm = window.gazeDataManager;
        if (!gdm) return;

        // 1. Get 'a' and 'b' (User's Gaze Range)
        const a = gdm.currentLineMinX;
        const b = gdm.globalMaxX;

        // Validation: If we don't have enough data yet, use conservative absolute hit test?
        // Or just wait. 'a' defaults to 99999, 'b' to 0. 
        if (a > 90000 || b <= a) {
            // Not calibrated enough on this line/session.
            // Fallback: Use viewport width as approximation?
            // Let's just return to avoid false positives. 
            // Standard hitTest (absolute) will handle click-like events if needed, 
            // but for "responsive" effect, we want RGT.
            return;
        }

        // 2. Normalized Gaze X (0.0 to 1.0)
        let Gx_norm = (gazeX - a) / (b - a);
        Gx_norm = Math.max(0, Math.min(1, Gx_norm)); // Clamp

        // 3. Find Line near Gaze Y
        // We expand the vertical tolerance because gaze Y is often inaccurate.
        const LINE_TOLERANCE_Y = 60; // +/- 60px
        const activeLine = this.lines.find(line => {
            const midY = (line.rect.top + line.rect.bottom) / 2;
            return Math.abs(gazeY - midY) < LINE_TOLERANCE_Y;
        });

        if (!activeLine) return;

        // 4. Check Words in this Line
        if (!this.containerRect) this.containerRect = this.container.getBoundingClientRect();
        const containerWidth = this.containerRect.width;
        const containerLeft = this.containerRect.left;

        activeLine.wordIndices.forEach(idx => {
            const word = this.words[idx];
            if (!word.isRuneWord || word.activated) return; // Skip if normal or already done

            // Calculate Word's Normalized Position in Container
            // Center of word relative to container
            const wordCenter = (word.rect.left + word.rect.right) / 2;
            const Wx_norm = (wordCenter - containerLeft) / containerWidth;

            // 5. Compare & Trigger
            // Tolerance: How close/predictive? 
            // 0.15 = 15% of screen width.
            const diff = Math.abs(Gx_norm - Wx_norm);

            // Heuristic: If gaze is 'ahead' or 'on', trigger.
            // Overshoot handling is naturally done by 'a' and 'b' clamping.

            if (diff < 0.15) {
                this.activateRuneWord(word);
            }
        });
    }

    activateRuneWord(word) {
        word.activated = true;
        word.element.classList.add('active-rune'); // CSS Animation

        console.log(`[RGT] Rune Word Triggered: "${word.text}" (ID: ${word.runeId})`);

        // Emit Event for Game Logic (Score, FX)
        // We use a small timeout to prevent blocking render loop
        setTimeout(() => {
            bus.emit('rune_touched', word.runeId);
        }, 0);
    }

    // --- End RGT Logic ---

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
        // Revert: User reported (+1) logic makes it appear one line TOO LOW.
        // This implies internal state (lineIndex/cursor) is already up-to-date or 'latestCursorY' represents the correct line.
        // We will strictly use the provided lineIndex or latestCursorY.

        let targetIndex = -1;

        if (typeof lineIndex === 'number' && lineIndex >= 0) {
            targetIndex = lineIndex;
        } else if (this.currentVisibleLineIndex !== undefined) {
            targetIndex = this.currentVisibleLineIndex;
        }

        // Attempt to get exact Visual Y from Line Objects
        if (this.lines && this.lines[targetIndex]) {
            targetY = this.lines[targetIndex].visualY;
        } else {
            // Fallback: Just use latestCursorY (Single Source of Truth)
            if (this.latestCursorY !== undefined && this.latestCursorY !== null) {
                targetY = this.latestCursorY;
            } else {
                // Last Resort: Current DOM Cursor
                const rect = this.cursor.getBoundingClientRect();
                targetY = rect.top + (rect.height * 0.52);
            }
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
        impact.style.left = (window.innerWidth - 20) + "px"; // [FIX] Right Edge
        impact.style.top = targetY + "px";
        impact.style.transform = "translate(-50%, -50%) scale(1.0)"; // Start Small (10px)

        // Force Reflow
        void impact.offsetWidth;

        // Animate: Visible Flash (0.2s for Snappy feedback)
        // Changed from 0.5s to 0.2s per user request.
        impact.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-in";

        requestAnimationFrame(() => {
            impact.style.transform = "translate(-50%, -50%) scale(2.0)"; // End at 20px
            impact.style.opacity = "0";
        });

        if (this.validatedLines && typeof lineIndex === 'number' && lineIndex >= 0) {
            this.validatedLines.add(lineIndex);
        }

        return true;
    }

    // [NEW] Sync View from Data (Global Layer Version)
    syncPangMarkers() {
        // 1. Ensure Global Layer Exists on Body (Fixed Overlay)
        let layer = document.getElementById("pang-marker-layer");
        if (!layer) {
            layer = document.createElement("div");
            layer.id = "pang-marker-layer";
            layer.style.position = "fixed"; // Global Fixed Overlay
            layer.style.top = "0";
            layer.style.left = "0";
            layer.style.width = "100%";
            layer.style.height = "100%";
            layer.style.pointerEvents = "none";
            layer.style.zIndex = "999000";
            document.body.appendChild(layer);
        }

        // 2. Clear & Repopulate
        layer.innerHTML = "";

        if (!this.validatedLines) return;

        this.validatedLines.forEach(lineIdx => {
            const line = this.lines[lineIdx];
            if (!line) return;

            // Coordinates are Fixed Viewport Relative
            // Use same logic as triggerReturnEffect (Right Edge)
            const targetX = window.innerWidth - 20;
            const targetY = line.visualY;

            const marker = document.createElement("div");
            marker.className = "pang-marker";
            marker.style.position = "absolute";
            marker.style.left = targetX + "px";
            marker.style.top = targetY + "px";
            marker.style.width = "10px";
            marker.style.height = "10px";
            marker.style.backgroundColor = "magenta";
            marker.style.borderRadius = "50%";
            marker.style.boxShadow = "0 0 5px magenta";
            marker.style.transform = "translate(-50%, -50%) scale(2.0)"; // Slightly prominent

            layer.appendChild(marker);
        });
    }

    // --- NEW: Gaze Replay Visualization (GLI-based Segmentation & Scaling) ---
    // --- NEW: Gaze Replay Visualization (Pang Event Driven + Combo System) ---
    playGazeReplay(gazeData, onComplete) {
        // [ROBUST] Sync Markers before starting replay to ensure visibility
        this.syncPangMarkers();

        if (!gazeData || gazeData.length < 2) {
            console.warn("[TextRenderer] No gaze data for replay.");
            if (onComplete) onComplete();
            return;
        }

        // Helper to force visibility against any async fade-outs
        const forceVisibility = () => {
            if (this.container) {
                this.container.style.transition = "none";
                this.container.style.opacity = "1";
                this.container.style.visibility = "visible";
            }
            if (this.words && this.words.length > 0) {
                this.words.forEach(w => {
                    if (w.element) {
                        w.element.style.transition = "none";
                        w.element.style.opacity = "1";
                        w.element.style.visibility = "visible";
                        w.element.classList.remove("faded-out");
                        w.element.classList.remove("chunk-fade-out"); // Specific class used by fadeOutChunk
                        w.element.classList.remove("hidden");
                    }
                });
            }
        };

        // 1. Immediate Enforcement
        forceVisibility();

        // 2. Continuous Enforcement (Anti-Async Guard)
        const safetyInterval = setInterval(forceVisibility, 10);

        console.log(`[TextRenderer] Text restored. Waiting 500ms, enforcing visibility...`);
        // DELAY REPLAY START
        setTimeout(() => {
            clearInterval(safetyInterval);

            // [NEW] CRITICAL FIX: Do NOT Re-Lock Layout.
            // We use the ORIGINAL coordinates from the reading session.
            // Re-locking causes micro-shifts if the browser layout engine decided to reflow.
            // if (this.words.length > 0) {
            //    console.log("[TextRenderer] Zero-Error Mapping: Re-calculating layout...");
            //    this.lockLayout();
            // }

            // Use the freshly calculated lines (or existing ones)
            const visualLines = this.lines || [];

            if (visualLines.length === 0) {
                console.warn("[TextRenderer] No visual lines available for mapping. Forcing one-time lock.");
                // Emergency Fallback only
                this.lockLayout();
            }

            console.log(`[TextRenderer] Starting Pang-Log Driven Replay...`);

            // [NEW] Source of Truth: Pang Logs
            // We ONLY replay lines that successfully triggered a Pang Event.
            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
            const rawPangLogs = (gm && typeof gm.getPangLogs === 'function') ? gm.getPangLogs() : [];

            console.log(`[TextRenderer] Found ${rawPangLogs.length} Pang Events for Replay.`);

            const processedPath = [];

            // ---------------------------------------------------------
            // LOGIC: Filter data based on Pang Logs
            // ---------------------------------------------------------

            if (rawPangLogs.length === 0) {
                console.log("[TextRenderer] No Pang Events recorded. Skipping Replay.");
                if (onComplete) onComplete();
                return;
            }

            // Sort Logs by Time (just in case)
            rawPangLogs.sort((a, b) => a.t - b.t);

            // Iterate Logs to build PATH
            let lastLogEndTime = 0; // To prevent overlap if needed, or track gaps

            rawPangLogs.forEach((log, idx) => {
                const targetLineIndex = log.lineIndex;
                const endTime = log.t;

                // Safety: Check if line exists
                if (!visualLines[targetLineIndex]) return;

                // [ZERO-ERROR] Use the CURRENT Visual Y from the freshly locked layout
                const targetLineObj = visualLines[targetLineIndex];
                const fixedY = targetLineObj.visualY;

                const segmentData = gazeData.filter(d => {
                    return (
                        d.t <= endTime &&
                        d.t > lastLogEndTime &&
                        typeof d.lineIndex === 'number' &&
                        d.lineIndex === targetLineIndex
                    );
                });

                if (segmentData.length < 5) {
                    // Too short segment
                } else {
                    // Add Jump Marker if this is not the first segment
                    if (processedPath.length > 0) {
                        processedPath.push({ isJump: true });
                    }

                    // --- [NEW] X-Axis Scaling Logic ---
                    // 1. Calculate Source Range (MinX, MaxX) from actual gaze data
                    let sourceMinX = Infinity;
                    let sourceMaxX = -Infinity;

                    segmentData.forEach(d => {
                        const gx = (typeof d.gx === 'number') ? d.gx : d.x;
                        if (gx < sourceMinX) sourceMinX = gx;
                        if (gx > sourceMaxX) sourceMaxX = gx;
                    });

                    const sourceWidth = sourceMaxX - sourceMinX;

                    // Target Visual Range (Text Line Width)
                    const targetLeft = targetLineObj.rect.left;
                    const targetWidth = targetLineObj.rect.width; // Should be full width

                    segmentData.forEach(d => {
                        // Use SmoothX if available, else RawX
                        const gx = (typeof d.gx === 'number') ? d.gx : d.x;

                        let scaledX = gx;

                        // Apply Scaling only if we have a valid width to map
                        if (sourceWidth > 10 && targetWidth > 0) {
                            // Normalize (0.0 ~ 1.0)
                            let ratio = (gx - sourceMinX) / sourceWidth;
                            ratio = Math.max(0, Math.min(1, ratio));
                            scaledX = targetLeft + (ratio * targetWidth);
                        } else {
                            scaledX = targetLeft + (gx - sourceMinX);
                        }

                        processedPath.push({
                            x: scaledX, // SCALED X
                            y: fixedY, // FORCE Y to Center of Line
                            t: d.t, // Original Timestamp
                            isJump: false
                        });
                    });
                }

                lastLogEndTime = endTime;
            });

            // [DEBUG] Expose Replay Path for Dashboard
            try {
                if (window.opener) window.opener.dashboardReplayData = processedPath;
                window.dashboardReplayData = processedPath;

                // [NEW] Pass to GazeDataManager for Cloud Upload
                if (window.gazeDataManager && typeof window.gazeDataManager.setReplayData === 'function') {
                    window.gazeDataManager.setReplayData(processedPath);
                }
            } catch (e) {
                console.warn("Could not expose replay data to opener", e);
            }

            // ---------------------------------------------------------
            // VALIDATION & RENDER (CANVAS + COMBO)
            // ---------------------------------------------------------
            if (processedPath.length < 2) {
                console.warn("[TextRenderer] No processed path generated (maybe no data matched Pang Logs).");
                if (onComplete) onComplete();
                return;
            }

            // --- 1. Canvas Setup (Existing) ---
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '999999';
            document.body.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            const path = processedPath;

            // --- 2. Combo System Setup ---
            const pathStartTime = path[0].t;
            const pathEndTime = path[path.length - 1].t;

            // [SPEED UP] Make replay very fast (3.0s fixed)
            const duration = 3000;

            let startTime = null;

            // Remap logs to Progress (0..1)
            const replayEvents = rawPangLogs.map(log => {
                let t = log.t;
                if (t < pathStartTime) t = pathStartTime;
                if (t > pathEndTime) t = pathEndTime;

                let ratio = (t - pathStartTime) / (pathEndTime - pathStartTime);
                if (isNaN(ratio)) ratio = 0;

                return {
                    progressTrigger: ratio, // 0.0 ~ 1.0
                    lineIndex: log.lineIndex,
                    triggered: false
                };
            }).sort((a, b) => a.progressTrigger - b.progressTrigger);

            // Combo State
            this.comboState = {
                current: 0,
                lastLine: -1,
                totalScore: 0
            };

            // No more giant UI container (_initScoreUI removed)

            const animate = (timestamp) => {
                forceVisibility();

                if (!startTime) startTime = timestamp;

                const elapsed = timestamp - startTime;
                const progress = elapsed / duration;

                if (progress >= 1) {
                    canvas.style.transition = "opacity 0.5s";
                    canvas.style.opacity = "0";
                    setTimeout(() => { canvas.remove(); if (onComplete) onComplete(); }, 500);
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // --- 3. Combo Check ---
                this._checkReplayCombo(progress, replayEvents, visualLines);

                // --- 4. Draw Path ---
                const maxIdx = Math.floor(path.length * progress);

                if (maxIdx >= 0 && maxIdx < path.length) {
                    const head = path[maxIdx];
                    if (head && !head.isJump) {
                        ctx.beginPath();
                        ctx.fillStyle = '#00ff00';
                        ctx.shadowColor = '#00ff00';
                        ctx.shadowBlur = 10;
                        ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }
                requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);

        }, 500);
    }

    // --- COMBO SYSTEM HELPERS ---

    _checkReplayCombo(progress, events, visualLines) {
        events.forEach(ev => {
            if (!ev.triggered && progress >= ev.progressTrigger) {
                ev.triggered = true;

                const lineIdx = ev.lineIndex;
                let score = 10;

                // Continuity: line == last + 1
                if (lineIdx === this.comboState.lastLine + 1) {
                    this.comboState.current++;
                } else {
                    if (this.comboState.lastLine === -1 && lineIdx === 0) {
                        this.comboState.current = 1;
                    } else {
                        this.comboState.current = 1;
                    }
                }

                if (this.comboState.current > 1) {
                    score += (this.comboState.current * 10);
                }

                this.comboState.totalScore += score;
                this.comboState.lastLine = lineIdx;

                if (visualLines[lineIdx]) {
                    const lineY = visualLines[lineIdx].visualY;
                    // Trigger minimal popup & flash
                    this._showMiniScore(score, lineY);
                    this._spawnReplayPulse(lineY);
                }

                if (window.Game && typeof window.Game.addInk === 'function') {
                    // window.Game.addInk(score); 
                }
            }
        });
    }

    _showMiniScore(score, yPos) {
        // [ENHANCED] Combo Text (150% Scale)
        const el = document.createElement('div');
        el.className = 'replay-mini-score';
        el.innerHTML = `Combo! <br>+${score}`; // Combo text + Score

        const xPos = window.innerWidth - 60;

        el.style.position = 'fixed';
        el.style.left = xPos + 'px';
        el.style.top = yPos + 'px';
        el.style.transform = 'translate(-50%, -50%) scale(0)'; // Start scaling from 0
        el.style.color = '#FFD700'; // Gold Color for Combo
        el.style.fontWeight = 'bold';
        el.style.fontSize = '14px'; // 14px Base Font
        el.style.fontFamily = 'monospace';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '1000000';
        el.style.textAlign = 'center';
        el.style.textShadow = '0 0 15px #FFD700, 0 0 5px orange'; // Stronger Glow
        // Apply Transition for Scale & Opacity
        el.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.5s 0.5s';
        el.style.opacity = '1';

        document.body.appendChild(el);

        // Pop Up Animation (Scale 1.2)
        requestAnimationFrame(() => {
            el.style.transform = 'translate(-50%, -50%) scale(1.2)';
            el.style.opacity = '1';
        });

        // Trigger Flying Ink Animation
        this._animateScoreToHud(xPos, yPos, score);

        // Remove after delay
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
        }, 800);
    }

    _animateScoreToHud(startX, startY, score) {
        // Find Target (Ink Icon/Counter in HUD)
        const targetEl = document.getElementById("ink-count");
        if (!targetEl) return;

        // Use parent for bigger target area if possible
        const targetRect = (targetEl.parentElement || targetEl).getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        // Calculate Control Point (CP) for Bezier Curve
        // CP.x = startX (Vertical rise initially)
        // CP.y = Midpoint between HUD and First Line of Text
        let firstLineY = startY;
        if (this.lines && this.lines.length > 0) {
            firstLineY = this.lines[0].visualY || this.lines[0].rect.top;
        }
        // Ensure CP is higher than startY even if on first line
        if (firstLineY > startY) firstLineY = startY;

        // CP Y: Midpoint between HUD (targetY) and First Line
        // We add an extra offset (-50) to ensure it arcs OVER the text if needed
        const cpX = startX;
        const cpY = (targetY + firstLineY) / 2 - 50;

        // Create Flying Particle
        const p = document.createElement('div');
        p.className = 'flying-ink';
        p.innerText = `+${score}`;
        p.style.position = 'fixed';
        p.style.left = startX + 'px';
        p.style.top = startY + 'px';
        p.style.color = '#00ffff';
        p.style.fontWeight = 'bold';
        p.style.fontSize = '18px';
        p.style.pointerEvents = 'none';
        p.style.zIndex = '1000001';
        p.style.transform = 'translate(-50%, -50%) scale(1.5)';
        p.style.transition = 'transform 0.1s';

        document.body.appendChild(p);

        // Animation Loop (Quadratic Bezier)
        let startTime = null;
        const duration = 1000;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = (timestamp - startTime) / duration;

            if (progress >= 1) {
                if (p.parentNode) p.remove();
                if (window.Game && typeof window.Game.addInk === 'function') {
                    window.Game.addInk(score);
                }
                const hudIcon = targetEl.parentElement || targetEl;
                hudIcon.style.transition = "transform 0.1s";
                hudIcon.style.transform = "scale(1.3)";
                setTimeout(() => hudIcon.style.transform = "scale(1)", 150);
                return;
            }

            // Ease-In-Out
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const t = ease;

            // Quadratic Bezier Formula
            // B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
            const invT = 1 - t;
            const currentX = (invT * invT * startX) + (2 * invT * t * cpX) + (t * t * targetX);
            const currentY = (invT * invT * startY) + (2 * invT * t * cpY) + (t * t * targetY);

            p.style.left = currentX + 'px';
            p.style.top = currentY + 'px';

            // Shrink slightly (1.5 -> 1.0)
            const scale = 1.5 - (progress * 0.5);
            p.style.transform = `translate(-50%, -50%) scale(${scale})`;

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _spawnReplayPulse(yPos) {
        const pulse = document.createElement('div');
        pulse.style.position = 'fixed';
        pulse.style.right = '20px';
        pulse.style.top = yPos + 'px';
        pulse.style.width = '8px';
        pulse.style.height = '8px';
        pulse.style.borderRadius = '50%';
        pulse.style.backgroundColor = 'magenta';
        pulse.style.boxShadow = '0 0 10px magenta';
        pulse.style.zIndex = '999999';
        pulse.style.transform = 'translate(50%, -50%) scale(1)';
        pulse.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';

        document.body.appendChild(pulse);

        requestAnimationFrame(() => {
            pulse.style.transform = 'translate(50%, -50%) scale(3)';
            pulse.style.opacity = '0';
        });

        setTimeout(() => pulse.remove(), 200);
    }
}
window.TextRenderer = TextRenderer;
