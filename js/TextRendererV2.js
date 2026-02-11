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

        // [NEW] Track Validated Lines for Replay
        this.validatedLines = new Set();

        // Remove old marker layer if exists
        const oldLayer = document.getElementById("pang-marker-layer");
        if (oldLayer) oldLayer.remove();

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

        // [NEW] Record Validated Line for Replay
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
    // --- NEW: Gaze Replay Visualization (Pang Event Driven) ---
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

            const visualLines = this.lines || [];
            if (visualLines.length === 0) {
                console.warn("[TextRenderer] No visual lines available for mapping.");
                if (onComplete) onComplete();
                return;
            }

            console.log(`[TextRenderer] Starting Pang-Log Driven Replay...`);

            // [NEW] Source of Truth: Pang Logs
            // We ONLY replay lines that successfully triggered a Pang Event.
            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
            const pangLogs = (gm && typeof gm.getPangLogs === 'function') ? gm.getPangLogs() : [];

            console.log(`[TextRenderer] Found ${pangLogs.length} Pang Events for Replay.`);

            const processedPath = [];

            // ---------------------------------------------------------
            // LOGIC: Filter data based on Pang Logs
            // ---------------------------------------------------------
            // For each Successful Pang Event (Line N finished at Time T_end):
            // 1. Identify Start Time T_start for this line.
            //    - T_start is roughly when the gaze FIRST entered Line N.
            // 2. Extract Data in [T_start, T_end].
            // 3. Map Y to Line N's fixed Visual Y.
            // 4. Map X to SmoothX.
            // 5. Ignore lines without Pang Events.

            if (pangLogs.length === 0) {
                console.log("[TextRenderer] No Pang Events recorded. Skipping Replay.");
                if (onComplete) onComplete();
                return;
            }

            // Sort Logs by Time (just in case)
            pangLogs.sort((a, b) => a.t - b.t);

            // Iterate Logs
            let lastLogEndTime = 0; // To prevent overlap if needed, or track gaps

            pangLogs.forEach((log, idx) => {
                const targetLineIndex = log.lineIndex;
                const endTime = log.t;

                // Safety: Check if line exists
                if (!visualLines[targetLineIndex]) return;
                const targetLineObj = visualLines[targetLineIndex];
                const fixedY = targetLineObj.visualY;

                // Find Start Time for this Line
                // We scan gazeData backwards from endTime until we find a different lineIndex
                // OR we can just grab all data with (lineIndex == targetLineIndex) that is BEFORE endTime
                // and AFTER the previous log's time.

                // Let's use the GazeData's own timestamps.
                // Filter condition:
                // 1. lineIndex === targetLineIndex (Strict content match)
                // 2. t <= endTime (Before the Pang happened)
                // 3. t > lastLogEndTime (After previous event finished) - Optional but good for hygiene

                const segmentData = gazeData.filter(d => {
                    return (
                        d.t <= endTime &&
                        d.t > lastLogEndTime &&
                        typeof d.lineIndex === 'number' &&
                        d.lineIndex === targetLineIndex
                    );
                });

                if (segmentData.length < 5) {
                    // Too short segment, maybe skip?
                    // console.warn(`[Replay] Line ${targetLineIndex} segment too short (${segmentData.length} pts).`);
                } else {
                    // console.log(`[Replay] Adding Line ${targetLineIndex}: ${segmentData.length} pts.`);

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

                            // Clamp (Optional but recommended to stay within bounds)
                            ratio = Math.max(0, Math.min(1, ratio));

                            // Map to Target
                            scaledX = targetLeft + (ratio * targetWidth);
                        } else {
                            // Fallback for single points or zero-width checks
                            // Just center it or place at start?
                            // Let's place it relative to start
                            scaledX = targetLeft + (gx - sourceMinX);
                        }

                        processedPath.push({
                            x: scaledX, // SCALED X
                            y: fixedY, // FORCE Y to Center of Line
                            t: d.t,
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
            // VALIDATION & RENDER
            // ---------------------------------------------------------
            if (processedPath.length < 2) {
                console.warn("[TextRenderer] No processed path generated (maybe no data matched Pang Logs).");
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
            const duration = 5000; // Fixed 5s Replay

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

                // Calculate current frame index based on progress
                // Since path contains jumps, we traverse it strictly by index ratio
                const maxIdx = Math.floor(path.length * progress);

                // Draw Head (No Trail)
                if (maxIdx >= 0 && maxIdx < path.length) {
                    const head = path[maxIdx];
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
