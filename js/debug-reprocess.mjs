import fs from 'fs';
import { detectVelXSpikes } from './velx-spike-detector.js';

/**
 * Debugging Script for Gaze Data Reprocessing
 * Usage: node debug-reprocess.mjs <input_csv_path> <output_csv_path>
 * Input CSV Format: timestamp, rawX, rawY (Header optional but recommended to skip)
 */

if (process.argv.length < 4) {
    console.log("Usage: node debug-reprocess.mjs <input_csv_path> <output_csv_path>");
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

// --- 1. Load Data ---
console.log(`Loading data from ${inputFile}...`);
const rawContent = fs.readFileSync(inputFile, 'utf-8');
const lines = rawContent.split(/\r?\n/).filter(line => line.trim() !== '');

const data = [];
let firstTimestamp = null;

// Detect Delimiter & Header
let colMap = { t: 0, x: 1, y: 2, lineIndex: -1 };
let startRow = 0;
let delimiter = ','; // Default

if (lines.length > 0) {
    const firstLine = lines[0].trim();

    // Detect delimiter
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    if (tabCount > commaCount) delimiter = '\t';

    // Basic split
    const parts = firstLine.split(delimiter).map(s => s.trim().toLowerCase());

    // Heuristic: If first token is not a number, assume header
    if (isNaN(parseFloat(parts[0]))) {
        console.log(`Header detected (Delimiter: '${delimiter === '\t' ? 'TAB' : 'COMMA'}'). Mapping columns...`);
        colMap = { t: -1, x: -1, y: -1, lineIndex: -1 };

        parts.forEach((p, i) => {
            if (p.includes('time') || p === 't') colMap.t = i;
            else if (p.includes('rawx') || p === 'x') colMap.x = i;
            else if (p.includes('rawy') || p === 'y') colMap.y = i;
            else if (p.includes('lineindex') || p === 'line' || p === 'answer') colMap.lineIndex = i;
        });

        // Fallbacks
        if (colMap.t === -1) colMap.t = 0;
        if (colMap.x === -1) colMap.x = 1;
        if (colMap.y === -1) colMap.y = 2;

        console.log(`Mapped: T=${colMap.t}, X=${colMap.x}, Y=${colMap.y}, LineIndex=${colMap.lineIndex}`);
        startRow = 1;
    } else {
        console.log(`Result: No Header detected. Using default indices (T=0, X=1, Y=2). Delimiter: '${delimiter === '\t' ? 'TAB' : 'COMMA'}'`);
    }
}

let lastValidLineIndex = null;

for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    // Use the correctly detected delimiter
    const parts = line.split(delimiter).map(s => s.trim());

    if (parts.length < 3) continue;

    const t_raw = parseFloat(parts[colMap.t]);
    const x = parseFloat(parts[colMap.x]);
    const y = parseFloat(parts[colMap.y]);

    // Parse optional LineIndex with Carry-Forward Logic
    let lIdx = null;
    if (colMap.lineIndex !== -1 && parts[colMap.lineIndex] !== undefined) {
        const rawVal = parts[colMap.lineIndex];
        if (rawVal !== "" && rawVal !== undefined && rawVal !== null && rawVal !== "null") {
            const parsed = parseFloat(rawVal);
            if (Number.isFinite(parsed)) lIdx = parsed;
            else lIdx = rawVal;

            lastValidLineIndex = lIdx; // Update history
        } else {
            lIdx = lastValidLineIndex; // Use history
        }
    } else if (lastValidLineIndex !== null) {
        lIdx = lastValidLineIndex;
    }

    if (firstTimestamp === null && !isNaN(t_raw)) firstTimestamp = t_raw;

    let t = t_raw;

    if (!isNaN(t)) {
        data.push({
            t,
            x: isNaN(x) ? null : x,
            y: isNaN(y) ? null : y,
            gx: null, gy: null,
            vx: null, vy: null,
            type: 'Unknown',
            lineIndex: lIdx,
            detectedLineIndex: undefined,
            extrema: undefined,
            isReturnSweep: false
        });
    }
}

console.log(`Loaded ${data.length} samples.`);

// --- 2. Preprocess (Ported from GazeDataManager) ---
function preprocessData(geoData) {
    if (geoData.length < 2) return;

    // 1. Interpolation
    for (let i = 0; i < geoData.length; i++) {
        const curr = geoData[i];
        const isMissing = curr.x === null || curr.y === null || (curr.x === 0 && curr.y === 0) || isNaN(curr.x);

        if (isMissing) {
            let prevIdx = i - 1;
            while (prevIdx >= 0) {
                const p = geoData[prevIdx];
                if (p.x !== null && !isNaN(p.x) && (p.x !== 0 || p.y !== 0)) break;
                prevIdx--;
            }

            let nextIdx = i + 1;
            while (nextIdx < geoData.length) {
                const n = geoData[nextIdx];
                if (n.x !== null && !isNaN(n.x) && (n.x !== 0 || n.y !== 0)) break;
                nextIdx++;
            }

            if (prevIdx >= 0 && nextIdx < geoData.length) {
                const p = geoData[prevIdx];
                const n = geoData[nextIdx];
                const ratio = (curr.t - p.t) / (n.t - p.t);
                curr.x = p.x + (n.x - p.x) * ratio;
                curr.y = p.y + (n.y - p.y) * ratio;
            } else if (prevIdx >= 0) {
                curr.x = geoData[prevIdx].x;
                curr.y = geoData[prevIdx].y;
            } else if (nextIdx < geoData.length) {
                curr.x = geoData[nextIdx].x;
                curr.y = geoData[nextIdx].y;
            }
        }
    }

    // 2. Gaussian Smoothing (Sigma=3)
    const sigma = 3;
    const radius = Math.ceil(3 * sigma);
    const kernelSize = 2 * radius + 1;
    const kernel = new Float32Array(kernelSize);
    let sumK = 0;
    for (let i = 0; i < kernelSize; i++) {
        const x = i - radius;
        const val = Math.exp(-(x * x) / (2 * sigma * sigma));
        kernel[i] = val;
        sumK += val;
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= sumK;

    for (let i = 0; i < geoData.length; i++) {
        let sumX = 0, sumY = 0, wSum = 0;
        for (let k = 0; k < kernelSize; k++) {
            const idx = i + (k - radius);
            if (idx >= 0 && idx < geoData.length) {
                if (geoData[idx].x !== null) {
                    sumX += geoData[idx].x * kernel[k];
                    sumY += geoData[idx].y * kernel[k];
                    wSum += kernel[k];
                }
            }
        }
        if (wSum > 0) {
            geoData[i].gx = sumX / wSum;
            geoData[i].gy = sumY / wSum;
        } else {
            geoData[i].gx = geoData[i].x;
            geoData[i].gy = geoData[i].y;
        }
    }

    // 3. Velocity Calculation
    for (let i = 0; i < geoData.length; i++) {
        if (i === 0) {
            geoData[i].vx = 0;
            geoData[i].vy = 0;
        } else {
            const dt = geoData[i].t - geoData[i - 1].t;
            if (dt > 0) {
                geoData[i].vx = (geoData[i].gx - geoData[i - 1].gx) / dt;
                geoData[i].vy = (geoData[i].gy - geoData[i - 1].gy) / dt;
            } else {
                geoData[i].vx = 0;
                geoData[i].vy = 0;
            }
        }
    }
}

preprocessData(data);
console.log("Preprocessing complete.");

// --- 3. Line Detection (Ported) ---
function detectLinesMobile(geoData, startTime = 0, endTime = Infinity) {
    if (geoData.length < 10) return 0;

    let startIndex = 0;
    let endIndex = geoData.length - 1;

    // Filter by time if timestamps are compatible
    // Only apply if user provided data has timestamps in expected range
    const firstT = geoData[0].t;
    const lastT = geoData[geoData.length - 1].t;
    // If range is default 0-Infinity, use all.

    const validDataSlice = geoData; // Use all for offline process usually

    // 2. Prepare samples using NEGATIVE VELOCITY ONLY
    // High WPM creates high positive velocity, which inflates MAD and hides return sweeps.
    const samples = validDataSlice.map(d => ({
        ts_ms: d.t,
        velX: d.vx < 0 ? d.vx : 0
    }));

    // 3. Detect Spikes using MAD (Sensitivity k=3.0)
    // With positive velocities removed, the baseline noise is low.
    const { threshold, spikeIntervals } = detectVelXSpikes(samples, { k: 2.0, gapMs: 120, expandOneSample: true });

    // 4. Identify Potential Return Sweeps
    const candidates = spikeIntervals.filter(interval => {
        // Check Displacement
        if (validDataSlice[interval.startIndex] && validDataSlice[interval.endIndex]) {
            const startX = validDataSlice[interval.startIndex].gx;
            const endX = validDataSlice[interval.endIndex].gx;
            const displacement = startX - endX;
            if (displacement < 100) return false;
        } else {
            return false;
        }
        return true;
    });

    candidates.sort((a, b) => a.start_ms - b.start_ms);

    // --- Advanced Validation (Algorithm 1 & 2) ---
    // 0. Dynamic Threshold Calculation
    let observedMinLineDur = Infinity;
    let curLineIdxForDur = -1;
    let curLineStartTForDur = -1;

    for (let i = 0; i < validDataSlice.length; i++) {
        const d = validDataSlice[i];
        if (d.lineIndex !== null && d.lineIndex !== undefined && d.lineIndex !== "") {
            const idx = Number(d.lineIndex);
            if (idx !== curLineIdxForDur) {
                if (curLineIdxForDur !== -1) {
                    const duration = d.t - curLineStartTForDur;
                    if (duration > 50 && duration < observedMinLineDur) {
                        observedMinLineDur = duration;
                    }
                }
                curLineIdxForDur = idx;
                curLineStartTForDur = d.t;
            }
        }
    }
    if (observedMinLineDur === Infinity) observedMinLineDur = 300;

    const MIN_LINE_DURATION = observedMinLineDur * 0.5;
    console.log(`[Dynamic Threshold] MinObserved=${observedMinLineDur}ms -> Threshold=${MIN_LINE_DURATION}ms`);

    const validSweeps = [];
    let currentLineNum = 1;
    let lastSweepEndTime = -Infinity;

    for (const sweep of candidates) {
        const sweepData = validDataSlice[sweep.startIndex];
        const sweepTime = sweepData.t;

        // Algo 2: Time Gap
        const timeSinceLast = sweepData.t - lastSweepEndTime;
        if (validSweeps.length > 0 && timeSinceLast < MIN_LINE_DURATION) {
            console.log(`[Reject Sweep] Rapid Fire: dt=${timeSinceLast}ms < ${MIN_LINE_DURATION}ms at T=${sweepTime}`);
            continue;
        }

        // Algo 1: LineNum Constraint
        let currentLineIndex = sweepData.lineIndex;
        // In this file, carry-forward is already done in loading phase, so lineIndex should be reliable.

        if (currentLineIndex !== null && currentLineIndex !== undefined) {
            const visibleLinesNow = Number(currentLineIndex) + 1;
            const targetLineNum = currentLineNum + 1;

            if (targetLineNum > visibleLinesNow) {
                // Algorithm 1 Refined: Validate Post-Sweep
                const postSweepData = validDataSlice[sweep.endIndex];
                let pIdx = postSweepData.lineIndex;

                if (pIdx == null) {
                    for (let k = sweep.endIndex; k >= sweep.startIndex; k--) {
                        if (validDataSlice[k].lineIndex != null) {
                            pIdx = validDataSlice[k].lineIndex;
                            break;
                        }
                    }
                }

                if (pIdx != null) {
                    const visibleAfter = Number(pIdx) + 1;
                    if (targetLineNum > visibleAfter) {
                        console.log(`[Reject Sweep] Premature: Target ${targetLineNum} > Visible ${visibleAfter} (at Sweep End)`);
                        continue;
                    }
                }
            }
        }

        validSweeps.push(sweep);
        lastSweepEndTime = sweep.end_ms;
        currentLineNum++;
    }

    let lineNum = 1;
    let lastEndRelIdx = 0;

    const markLine = (relStart, relEnd, num) => {
        if (relEnd <= relStart) return;
        for (let k = relStart; k < relEnd; k++) {
            if (geoData[k]) geoData[k].detectedLineIndex = num;
        }
        if (geoData[relStart]) geoData[relStart].extrema = "LineStart";
        if (geoData[relEnd - 1]) geoData[relEnd - 1].extrema = "PosMax";
    };

    for (const sweep of validSweeps) {
        const lineEndRelIdx = sweep.startIndex;
        if (lineEndRelIdx - lastEndRelIdx > 5) {
            markLine(lastEndRelIdx, lineEndRelIdx, lineNum);
            lineNum++;
        }
        lastEndRelIdx = sweep.endIndex + 1;
        for (let k = sweep.startIndex; k <= sweep.endIndex; k++) {
            if (geoData[k]) geoData[k].isReturnSweep = true;
        }
    }

    if (samples.length - lastEndRelIdx > 5) {
        markLine(lastEndRelIdx, samples.length, lineNum);
    }

    console.log(`Detected ${lineNum} lines (Advanced Validation Applied).`);
}

detectLinesMobile(data);

// --- 4. Export CSV ---
console.log(`Writing results to ${outputFile}...`);
let csvHeader = "RelativeTimestamp_ms,RawX,RawY,SmoothX,SmoothY,VelX,VelY,Type,ReturnSweep,LineIndex,CharIndex,AlgoLineIndex,Extrema\n";
let csvContent = csvHeader;

data.forEach(d => {
    const row = [
        d.t,
        d.x !== null ? d.x : "",
        d.y !== null ? d.y : "",
        d.gx !== null ? d.gx.toFixed(2) : "",
        d.gy !== null ? d.gy.toFixed(2) : "",
        d.vx !== null ? d.vx.toFixed(4) : "",
        d.vy !== null ? d.vy.toFixed(4) : "",
        d.type,
        (d.isReturnSweep ? "TRUE" : ""),
        (d.lineIndex !== null && d.lineIndex !== undefined) ? d.lineIndex : "",
        (d.charIndex !== null && d.charIndex !== undefined) ? d.charIndex : "",
        (d.detectedLineIndex !== undefined) ? d.detectedLineIndex : "",
        (d.extrema !== undefined) ? d.extrema : ""
    ];
    csvContent += row.join(",") + "\n";
});

fs.writeFileSync(outputFile, csvContent, 'utf-8');
console.log("Done.");
