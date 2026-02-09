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
        this.cursor.style.opacity = "0"; // Force hidden (Guide Runner Invisible)
        this.cursor.style.backgroundColor = "transparent"; // Ensure transparent

        document.body.appendChild(this.cursor);

        // 4. Pre-create Impact Element
        this.impactElement = document.createElement('div');
        this.impactElement.id = "tr-impact-effect";
        this.impactElement.style.position = "fixed";
        this.impactElement.style.borderRadius = "50%";
        // [User Request] Revert: Pang Effect MUST be visible (Magenta)
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
                this.cursor.style.opacity = '0'; // Keep hidden
                this.cursor.style.backgroundColor = 'transparent';
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

        // 1. Calculate Target Y (NEXT LINE Logic)
        // User Request: Pang should appear on the LEFT of the NEXT LINE where gaze lands.
        // Current cursor is likely at the END of the PREVIOUS line.

        let nextLineIndex = -1;

        // Try to determine Next Line Index
        if (typeof lineIndex === 'number' && lineIndex >= 0) {
            // If caller provided lineIndex (often current reading line), next is +1
            nextLineIndex = lineIndex + 1;
        } else if (this.currentVisibleLineIndex !== undefined) {
            // Fallback to internal tracker
            nextLineIndex = this.currentVisibleLineIndex + 1;
        }

        // Attempt to get exact Visual Y from Line Objects
        if (this.lines && this.lines[nextLineIndex]) {
            targetY = this.lines[nextLineIndex].visualY;
        } else {
            // Fallback: Estimate Next Line Position based on current cursor
            // Add approximate Line Height (e.g. 60px or derived from font size)
            // Default font size 1.5rem * 2.5 line-height ~= 3.75rem ~= 60px
            const estimatedLineHeight = 60;

            if (this.latestCursorY !== undefined && this.latestCursorY !== null) {
                targetY = this.latestCursorY + estimatedLineHeight;
            } else {
                // Last Resort: Current DOM Cursor + Line Height
                const rect = this.cursor.getBoundingClientRect();
                targetY = rect.top + (rect.height * 0.52) + estimatedLineHeight;
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
        impact.style.left = "40px"; // Fixed Left Margin (Start of Line)
        impact.style.top = targetY + "px";
        impact.style.transform = "translate(-50%, -50%) scale(2.0)"; // Start Medium (20px)

        // Force Reflow
        void impact.offsetWidth;

        // Animate: Visible Flash (0.2s for Snappy feedback)
        // Changed from 0.5s to 0.2s per user request.
        impact.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-in";

        requestAnimationFrame(() => {
            impact.style.transform = "translate(-50%, -50%) scale(4.0)"; // End at 40px
            impact.style.opacity = "0";
        });

        return true;
    }

    // --- NEW: Gaze Replay Visualization (GLI-based Segmentation & Scaling) ---
    playGazeReplay(gazeData, onComplete) {
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

            const visualLines = this.lines || [];
            if (visualLines.length === 0) {
                console.warn("[TextRenderer] No visual lines available for mapping.");
                if (onComplete) onComplete();
                return;
            }

            console.log(`[TextRenderer] Starting GLI-based Segmented Replay (v2.0)...`);

            // ---------------------------------------------------------
            // PHASE 1: Recalculate GLI (Offline Simulation)
            // ---------------------------------------------------------
            let simGLI = 0;
            let hasContentStarted = false;
            let lastTriggerTime = 0;
            let lastPosPeakTime = 0;

            // Helper to get Smooth X (Simple 3-tap or use existing if avail)
            const getSmoothX = (arr, i) => {
                if (typeof arr[i].gx === 'number') return arr[i].gx;
                let sum = arr[i].x;
                let count = 1;
                if (i > 0) { sum += arr[i - 1].x; count++; }
                if (i < arr.length - 1) { sum += arr[i + 1].x; count++; }
                return sum / count;
            };

            // Pre-calculate derived data
            for (let i = 0; i < gazeData.length; i++) {
                const d = gazeData[i];
                d.t = Number(d.t);
                d.x = Number(d.x);
                if (i > 0) {
                    const dt = d.t - gazeData[i - 1].t;
                    if (dt > 0) d.vx = (d.x - gazeData[i - 1].x) / dt;
                    else d.vx = 0;
                } else {
                    d.vx = 0;
                }
                d.gx = getSmoothX(gazeData, i); // Ensure smooth X
                d.refinedGLI = -1; // Init
            }

            // SIMULATION LOOP
            for (let i = 2; i < gazeData.length; i++) {
                const d0 = gazeData[i];
                const d1 = gazeData[i - 1];
                const d2 = gazeData[i - 2];
                const now = d0.t;

                // [NEW] Context Reset (Sync Down)
                // If actual line index resets (e.g. New Level), force GLI down.
                if (typeof d0.lineIndex === 'number' && d0.lineIndex >= 0) {
                    if (simGLI > d0.lineIndex) {
                        simGLI = d0.lineIndex;
                    }
                }

                // 1. Wait for Content
                if (!hasContentStarted) {
                    if (typeof d0.lineIndex === 'number' && d0.lineIndex >= 0) {
                        hasContentStarted = true;
                        simGLI = d0.lineIndex; // Sync Start
                    }
                    d0.refinedGLI = hasContentStarted ? simGLI : -1;
                    continue; // Skip detection until started
                }

                // 2. Detect Logic
                const sx0 = d0.gx;
                const sx1 = d1.gx;
                const sx2 = d2.gx;
                const v0 = d0.vx;
                const v1 = d1.vx;

                // Peak
                const isPosPeak = (sx1 >= sx2) && (sx1 > sx0);
                if (isPosPeak) lastPosPeakTime = d1.t;

                // Valley
                const isVelValley = (d2.vx > v1) && (v1 < v0);
                const isDeepEnough = v1 < -0.4;

                if (isVelValley && isDeepEnough) {
                    const timeSincePeak = d1.t - lastPosPeakTime;
                    if (Math.abs(timeSincePeak) < 600) {
                        if (now - lastTriggerTime >= 800) {
                            // Constraint: Cannot exceed Actual Line Index
                            if (typeof d0.lineIndex === 'number' && d0.lineIndex >= 0) {
                                if (simGLI >= d0.lineIndex) {
                                    // Block overshoot
                                    d0.refinedGLI = simGLI;
                                    continue;
                                }
                            }
                            // Trigger!
                            simGLI++;
                            lastTriggerTime = now;
                            lastPosPeakTime = 0;
                        }
                    }
                }
                d0.refinedGLI = simGLI;
            }

            // ---------------------------------------------------------
            // PHASE 2 & 3: Segmentation & Mapping
            // ---------------------------------------------------------

            const processedPath = [];
            // Group by GLI
            const segments = {};

            gazeData.forEach(d => {
                if (typeof d.refinedGLI !== 'number' || d.refinedGLI < 0) return;
                const gli = d.refinedGLI;

                // Only consider valid lines that actually exist in visualLines
                if (gli >= visualLines.length) return;

                if (!segments[gli]) {
                    segments[gli] = { points: [], minX: Infinity, maxX: -Infinity };
                }
                const seg = segments[gli];
                seg.points.push(d);
                if (d.x < seg.minX) seg.minX = d.x;
                if (d.x > seg.maxX) seg.maxX = d.x;
            });

            // Process each segment to path
            const sortedGLIs = Object.keys(segments).map(Number).sort((a, b) => a - b);

            sortedGLIs.forEach((gli, idx) => {
                const seg = segments[gli];
                const lineObj = visualLines[gli];

                const targetLeft = lineObj.rect.left;
                const targetWidth = lineObj.rect.width;

                const sourceWidth = seg.maxX - seg.minX;

                // Push a "JUMP" marker if not first segment
                if (idx > 0) {
                    // Jump time is roughly between end of prev segment and start of this one
                    processedPath.push({ isJump: true });
                }

                seg.points.forEach(p => {
                    let mappedX = targetLeft;
                    if (sourceWidth > 20) {
                        let ratio = (p.x - seg.minX) / sourceWidth;
                        // Avoid extreme jitter - clamp 0..1
                        ratio = Math.max(0, Math.min(1, ratio));
                        mappedX = targetLeft + (ratio * targetWidth);
                    } else {
                        // Tiny segment (e.g. single word/point)
                        // Just place at start + minimal offset
                        mappedX = targetLeft + 10;
                    }

                    processedPath.push({
                        x: mappedX,
                        y: lineObj.rect.top + (lineObj.rect.height / 2), // Mathematically Centered Y
                        t: p.t,
                        isJump: false
                    });
                });
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
            // VALIDATION & RENDER
            // ---------------------------------------------------------
            if (processedPath.length < 2) {
                console.warn("[TextRenderer] No processed path generated.");
                if (onComplete) onComplete();
                return;
            }

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
            let startTime = null;
            const duration = 5000; // Slowed down by 2x (was 2500)

            const animate = (timestamp) => {
                // Safety enforcement
                forceVisibility();

                if (!startTime) startTime = timestamp;
                const progress = (timestamp - startTime) / duration;

                if (progress >= 1) {
                    canvas.style.transition = "opacity 0.5s";
                    canvas.style.opacity = "0";
                    setTimeout(() => { canvas.remove(); if (onComplete) onComplete(); }, 500);
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Draw Head Only (No Trail)
                const maxIdx = Math.floor(path.length * progress);

                if (maxIdx > 1) {
                    const head = path[maxIdx - 1];
                    if (head && !head.isJump) {
                        ctx.beginPath();
                        ctx.fillStyle = '#00ff00'; // Green
                        ctx.shadowColor = '#00ff00'; // Green Glow
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
}
window.TextRenderer = TextRenderer;
