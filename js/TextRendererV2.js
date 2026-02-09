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

    prepare(rawText) {
        if (!this.container) return;

        // 0. Safety First: Stop any previous rendering
        this.cancelAllAnimations();

        // 1. Reset
        this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = [];
        this.isLayoutLocked = false;

        // 2. Parse
        const rawChunks = rawText.split("/");
        let globalWordIndex = 0;

        // Reset Pagination State
        this.pages = [];
        this.currentPageIndex = 0;

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

        // 5. Automatic Pagination
        // We need to wait for layout to settle (rendering) before calculating height overflow.
        // But since we want to hide overflow immediately, let's do it next frame.
        // However, `prepare` is synchronous. Let's assume the caller will handle `showPage(0)`.
        this.paginate();
    }

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
                            if (window.Game && window.Game.gazeManager) {
                                window.Game.gazeManager.setContext({
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
                            if (window.Game && window.Game.gazeManager && this.lines[w.lineIndex]) {
                                window.Game.gazeManager.setContext({
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
            this.cursor.style.opacity = "1";

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
        // "Single Source of Truth": Reuse the cursor's last known Y position.
        // This guarantees 100% visual match.
        if (this.latestCursorY !== undefined && this.latestCursorY !== null) {
            targetY = this.latestCursorY;
        } else {
            // Fallback: Current Cursor Position (Read from DOM)
            const rect = this.cursor.getBoundingClientRect();
            targetY = rect.top + (rect.height * 0.52);
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

    // --- NEW: Gaze Replay Visualization (Line-Locked) ---
    playGazeReplay(gazeData, onComplete) {
        if (!gazeData || gazeData.length < 2) {
            console.warn("[TextRenderer] No gaze data for replay.");
            if (onComplete) onComplete();
            return;
        }

        console.log(`[TextRenderer] Starting Line-Locked Replay with ${gazeData.length} points...`);

        // 1. Calculate Line Indices (Simulation Logic)
        // mimics simple "Return Sweep Detection" to increment line index.
        const visualLines = this.lines || [];
        if (visualLines.length === 0) {
            console.warn("[TextRenderer] No visual lines available for mapping.");
            if (onComplete) onComplete();
            return;
        }

        const processedPath = [];

        // Start at the first line of the current screen
        let simGazeLineIndex = 0;
        let lastValleyTime = -9999;
        let lastPeakTime = -9999;
        let contentStarted = false; // [NEW] Wait for actual line detection

        // Ensure sorted
        // gazeData.sort((a, b) => a.t - b.t);

        for (let i = 2; i < gazeData.length; i++) {
            const d2 = gazeData[i - 2];
            const d1 = gazeData[i - 1];
            const d0 = gazeData[i];

            if (!d1 || !d2) continue;

            // [NEW] Check if content reading has actually started
            if (!contentStarted) {
                if (typeof d1.lineIndex === 'number' && d1.lineIndex >= 0) {
                    contentStarted = true;
                    // Reset simIndex to the first detected line to sync
                    simGazeLineIndex = d1.lineIndex;
                } else {
                    // Skip data before content start (Noise filter)
                    continue;
                }
            }

            const t = d1.t;
            // Use Raw X for Replay X
            const rawX = d1.x;

            // Stats for Detection
            const smoothX = (d1.gx !== undefined) ? d1.gx : d1.x;
            const velX = (d1.vx !== undefined) ? d1.vx : 0;

            // --- Logic from Live-Dashboard (Chart 4) ---

            // 1. Peak (SmoothX Local Max)
            const isPeak = (d1.gx > d2.gx && d1.gx > d0.gx);

            // 2. Valley (Velocity X < -0.4 is a strong leftward sweep)
            const isValley = (velX < -0.4);

            if (isValley) {
                lastValleyTime = t;
            }

            // 3. Trigger (Peak shortly after Valley)
            // Window: 500ms
            if (isPeak && (t - lastValleyTime < 500)) {
                // Debounce: Don't trigger multiple lines instantly
                if (t - lastPeakTime > 500) {
                    simGazeLineIndex++;
                    lastPeakTime = t;
                    // console.log(`[Replay] Line Jump detected at ${t}ms -> Line ${simGazeLineIndex}`);
                }
            }

            // Clamp index to available lines in this paragraph
            // If simGazeLineIndex exceeds visualLines, stay at last line.
            // If user read partially, it stays at current.
            const safeLineIndex = Math.min(Math.max(0, simGazeLineIndex), visualLines.length - 1);

            const lineObj = visualLines[safeLineIndex];
            const lineY = lineObj ? lineObj.visualY : 0;

            // Validation: Skip if RawX is garbage (e.g. 0 or NaN)
            if (isNaN(rawX) || rawX === 0) continue;

            // Push to path
            processedPath.push({
                x: rawX,
                y: lineY, // LOCKED visual Y
                t: t
            });
        }

        // Fallback: If logic found no points (rare), just force raw plot?
        // But likely we have points.
        if (processedPath.length < 2) {
            console.warn("[TextRenderer] Processed path too short.");
            if (onComplete) onComplete(); return;
        }

        // 2. Setup Canvas
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

        // 3. Animate
        const path = processedPath;
        let startTime = null;
        const duration = 2500;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = (timestamp - startTime) / duration;
            if (progress >= 1) {
                canvas.style.transition = "opacity 0.5s";
                canvas.style.opacity = "0";
                setTimeout(() => { canvas.remove(); if (onComplete) onComplete(); }, 500);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const maxIdx = Math.floor(path.length * progress);
            if (maxIdx > 1) {
                ctx.beginPath();
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'rgba(255, 0, 255, 0.6)'; // Magenta
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < maxIdx; i++) {
                    // Check for Line Jump? 
                    // If visualY changed, it means jump.
                    // Just connect them -> Diagonal line.
                    ctx.lineTo(path[i].x, path[i].y);
                }
                ctx.stroke();

                // Head
                const head = path[maxIdx - 1];
                ctx.beginPath();
                ctx.fillStyle = '#ff00ff';
                ctx.shadowColor = '#ff00ff';
                ctx.shadowBlur = 10;
                ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }
}
window.TextRenderer = TextRenderer;
