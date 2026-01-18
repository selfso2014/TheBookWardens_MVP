/**
 * The Book Wardens: Game Logic
 */
const Game = {
    state: {
        gems: 0,
        currentWordIndex: 0,
        readProgress: 0, // 0..100
        isTracking: false,
        rift: {
            currentWord: null,
            dwellTime: 0,
            requiredDwell: 1000,
            totalRifts: 0,
            fixedRifts: 0
        }
    },

    init() {
        console.log("Game Init");
        this.bindEvents();
        this.updateUI();

        // 3. Auto-start if redirected from In-App Browser
        const params = new URLSearchParams(window.location.search);
        if (params.get("skip") === "1" && !this.isInAppBrowser()) {
            console.log("Auto-starting game due to skip param");
            const startBtn = document.getElementById("btn-start-game");
            if (startBtn) {
                setTimeout(() => startBtn.click(), 500);
            }
        }
    },

    bindEvents() {
        const startBtn = document.getElementById("btn-start-game");
        if (startBtn) {
            startBtn.onclick = async () => {
                // 1. Check In-App Browser
                if (this.isInAppBrowser()) {
                    this.openSystemBrowser();
                    return;
                }

                // 2. Normal Flow
                startBtn.style.display = "none";
                const loader = document.getElementById("loader-container");
                const bar = document.getElementById("loader-bar");
                if (loader && bar) {
                    loader.style.display = "block";
                    bar.getBoundingClientRect();
                    bar.style.width = "100%";
                }

                setTimeout(() => {
                    this.switchScreen("screen-word");
                }, 800);

                // Initialize in background
                this.trackingInitPromise = (async () => {
                    try {
                        if (typeof window.startEyeTracking === "function") {
                            const ok = await window.startEyeTracking();
                            if (!ok) {
                                throw new Error("Permission denied or initialization failed.");
                            }
                            return true;
                        } else {
                            console.warn("window.startEyeTracking not found.");
                            return false;
                        }
                    } catch (e) {
                        console.error(e);
                        alert("Eye tracking initialization failed: " + e.message);
                        this.switchScreen("screen-home");

                        if (startBtn) {
                            startBtn.style.display = "inline-block";
                            startBtn.disabled = false;
                            startBtn.textContent = "Enter the Rift";
                        }
                        return false;
                    }
                })();
            };
        }
    },

    onCalibrationFinish() {
        console.log("Calibration done. Entering Reading Rift...");
        setTimeout(() => {
            this.switchScreen("screen-read");
        }, 1000);
    },

    isInAppBrowser() {
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        return (
            /KAKAOTALK/i.test(ua) ||
            /FBAV/i.test(ua) ||
            /Line/i.test(ua) ||
            /Instagram/i.test(ua) ||
            /Snapchat/i.test(ua) ||
            /Twitter/i.test(ua) ||
            /DaumApps/i.test(ua)
        );
    },

    openSystemBrowser() {
        const url = window.location.href;
        if (/Android/i.test(navigator.userAgent)) {
            let newUrl = url;
            if (newUrl.indexOf("?") === -1) newUrl += "?skip=1";
            else if (newUrl.indexOf("skip=1") === -1) newUrl += "&skip=1";

            const noProtocol = newUrl.replace(/^https?:\/\//, "");
            const intentUrl = `intent://${noProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
            window.location.href = intentUrl;
        } else {
            alert("Please copy the URL and open it in Safari or Chrome to play.");
            navigator.clipboard.writeText(url).then(() => {
                alert("URL copied to clipboard!");
            }).catch(() => { });
        }
    },

    switchScreen(screenId) {
        document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
        const target = document.getElementById(screenId);
        if (target) target.classList.add("active");

        if (screenId === "screen-read") {
            this.startReadingSession();
        }
    },

    updateUI() {
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.state.gems;
    },

    // --- 1. Word Forge ---
    async checkVocab(optionIndex) {
        const isCorrect = (optionIndex === 1);
        if (isCorrect) {
            alert("Correct! +10 Gems");
            this.state.gems += 10;
            this.updateUI();

            if (this.trackingInitPromise) {
                const ok = await this.trackingInitPromise;
                if (!ok) return;
            }

            this.switchScreen("screen-calibration");
            setTimeout(() => {
                if (typeof window.startCalibrationRoutine === "function") {
                    window.startCalibrationRoutine();
                } else {
                    this.switchScreen("screen-read");
                }
            }, 500);
        } else {
            alert("Try again!");
        }
    },

    // --- 1.5 Owl ---
    startOwlScene() {
        this.state.isTracking = true;
        this.state.isOwlTracker = true;
        this.switchScreen("screen-owl");
        if (typeof window.showGazeDot === "function") {
            window.showGazeDot(999999);
        }
    },

    startReadingFromOwl() {
        // Stop owl tracking and start reading
        this.state.isOwlTracker = false;
        this.switchScreen("screen-read");
        this.startReadingSession();
    },

    // --- 2. Reading Rift (Original Logic kept for reference, overlaid below) ---
    startReadingSession_OLD() {
        // ... existing logic ...
    },

    confrontVillain() {
        this.state.isTracking = false;
        this.switchScreen("screen-boss");
    },

    // ... pagination methods omitted for brevity as they are overridden or unused in Typewriter mode usually ...

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Owl Interaction
        if (this.state.isOwlTracker) {
            const pupils = document.querySelectorAll('.pupil');
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const maxMove = 20;

            let dx = (x - cx) / (window.innerWidth / 2) * maxMove;
            let dy = (y - cy) / (window.innerHeight / 2) * maxMove;
            dx = Math.max(-maxMove, Math.min(maxMove, dx));
            dy = Math.max(-maxMove, Math.min(maxMove, dy));

            pupils.forEach(p => {
                p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            });
            return;
        }
    },

    onCalibrationFinish() {
        console.log("Calibration finished. Starting Owl Scene.");
        this.startOwlScene();
    },

    // --- 3. Boss Battle ---
    checkBoss(optionIndex) {
        const isCorrect = (optionIndex === 1);
        if (isCorrect) {
            alert("Direct Hit! The Shadow fades...");
            this.state.gems += 50;
            this.updateUI();
            this.switchScreen("screen-win");
        } else {
            alert("The Shadow deflects your attack! Try reading carefully.");
        }
    }
};

// --- Typewriter Mode Logic (New) ---
Game.typewriter = {
    // Data with chunk markers
    // User provided text with '/' for chunks.
    // I will replace '/' with a special marker or handle it logic.
    // Actually, I will pre-process the raw text here into an array of chunks for each paragraph.
    // But since `paragraphs` is expected to be an array of strings (chunks) or paragraphs?
    // User requests "chunks". 
    // Implementation: I will split paragraphs by newline first, then keep the `/` logic for pausing.
    paragraphs: [
        "Alice was beginning to get very tired / of sitting by her sister / on the bank, / and of having nothing to do: / once or twice / she had peeped into the book / her sister was reading, / but it had no pictures / or conversations / in it, / “and what is the use of a book,” / thought Alice / “without pictures / or conversations?”",

        "So she was considering / in her own mind / (as well as she could, / for the hot day / made her feel very sleepy / and stupid), / whether the pleasure / of making a daisy-chain / would be worth the trouble / of getting up / and picking the daisies, / when suddenly / a White Rabbit / with pink eyes / ran close by her.",

        "There was nothing / so very remarkable / in that; / nor did Alice think it / so very much out of the way / to hear the Rabbit / say to itself, / “Oh dear! / Oh dear! / I shall be late!” / (when she thought it over afterwards, / it occurred to her / that she ought to have wondered / at this, / but at the time / it all seemed quite natural); / but when the Rabbit / actually took a watch / out of its waistcoat-pocket, / and looked at it, / and then hurried on, / Alice started to her feet, / for it flashed across her mind / that she had never before seen / a rabbit / with either a waistcoat-pocket, / or a watch / to take out of it, / and burning with curiosity, / she ran across the field / after it, / and fortunately / was just in time / to see it / pop down / a large rabbit-hole / under the hedge.",

        "In another moment / down went Alice / after it, / never once considering / how in the world / she was to get out again.",

        "The rabbit-hole / went straight on / like a tunnel / for some way, / and then dipped / suddenly down, / so suddenly / that Alice had not a moment / to think about / stopping herself / before she found herself / falling down / a very deep well.",

        "Either the well / was very deep, / or she fell / very slowly, / for she had plenty of time / as she went down / to look about her / and to wonder / what was going to happen next. / First, / she tried to look down / and make out / what she was coming to, / but it was too dark / to see anything; / then she looked / at the sides of the well, / and noticed / that they were filled / with cupboards / and book-shelves; / here and there / she saw maps / and pictures / hung upon pegs. / She took down a jar / from one of the shelves / as she passed; / it was labelled / “ORANGE MARMALADE”, / but to her great disappointment / it was empty: / she did not like / to drop the jar / for fear of killing somebody underneath, / so managed to put it / into one of the cupboards / as she fell past it."
    ],
    quizzes: [
        { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
        { q: "What did Alice see?", o: ["A White Rabbit.", "A Cheshire Cat.", "A Mad Hatter."], a: 0 },
        { q: "What did the Rabbit say?", o: ["I'm hungry!", "Oh dear! I shall be late!", "Hello Alice!"], a: 1 },
        { q: "What did the Rabbit pull out?", o: ["A carrot.", "A watch.", "A map."], a: 1 },
        { q: "Where did Alice fall?", o: ["Up a tree.", "Into a deep well.", "Into a river."], a: 1 },
        { q: "What did she see on the shelves?", o: ["Orange Marmalade.", "Books only.", "Nothing."], a: 0 }
    ],
    currentParaIndex: 0,
    currentText: "",
    charIndex: 0,
    timer: null,
    isPaused: false,

    start() {
        // Reset
        this.currentParaIndex = 0;
        const el = document.getElementById("book-content");
        if (el) {
            el.innerHTML = "";
            el.style.columnCount = "1";
            el.style.height = "auto";
            el.style.overflowY = "auto";
        }
        this.playNextParagraph();
    },

    playNextParagraph() {
        const el = document.getElementById("book-content");
        if (!el) return;

        el.innerHTML = "";

        if (this.currentParaIndex >= this.paragraphs.length) {
            Game.switchScreen("screen-win");
            return;
        }

        this.currentText = this.paragraphs[this.currentParaIndex];
        this.charIndex = 0;
        this.isPaused = false;

        this.currentP = document.createElement("p");
        // Font size 2x of previous 1.2rem -> 2.4rem
        this.currentP.style.fontSize = "2.4rem";
        this.currentP.style.textAlign = "left";
        this.currentP.style.lineHeight = "1.5";
        this.currentP.style.fontFamily = "'Crimson Text', serif";
        this.currentP.style.margin = "20px";

        // Create Cursor
        this.cursorBlob = document.createElement("span");
        this.cursorBlob.className = "cursor";
        this.currentP.appendChild(this.cursorBlob);

        el.appendChild(this.currentP);

        if (this.timer) clearTimeout(this.timer);
        this.tick();
    },

    tick() {
        if (this.isPaused) return;

        // Advance character
        let char = this.currentText[this.charIndex];

        // Skip '/' delimiter but trigger pause logic
        let isChunkEnd = false;
        if (char === '/') {
            isChunkEnd = true;
            this.charIndex++; // Skip the slash
            if (this.charIndex < this.currentText.length) {
                char = this.currentText[this.charIndex];
            } else {
                char = "";
            }
        }

        // Add char to P (insert before cursor)
        if (this.charIndex < this.currentText.length) {
            const charNode = document.createTextNode(char);
            this.currentP.insertBefore(charNode, this.cursorBlob);
            this.charIndex++;
        }

        // Auto-scroll
        const el = document.getElementById("book-content");
        if (el) el.scrollTop = el.scrollHeight;

        // Check if finished
        if (this.charIndex >= this.currentText.length) {
            this.isPaused = true;
            // Remove cursor after done? Or keep blinking? User didn't specify, but nice to remove or stop.
            // Reference code keeps removing it per paragraph.
            if (this.currentP.contains(this.cursorBlob)) {
                this.currentP.removeChild(this.cursorBlob);
            }

            setTimeout(() => {
                this.showVillainQuiz();
            }, 1000);
        } else {
            // Speed Logic
            let nextDelay = 30; // Fast base speed

            if (isChunkEnd) {
                nextDelay = 800; // Chunk End
            } else {
                const lastChar = char;
                if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
                    nextDelay = 600;
                }
            }

            this.timer = setTimeout(() => this.tick(), nextDelay);
        }
    },

    showVillainQuiz() {
        const modal = document.getElementById("villain-modal");
        const qEl = document.getElementById("quiz-text");
        const oEl = document.getElementById("quiz-options");

        if (!modal || !qEl || !oEl) {
            this.onQuizCorrect(); return;
        }

        const qData = this.quizzes[this.currentParaIndex] || { q: "Continue?", o: ["Yes", "No"], a: 0 };
        qEl.textContent = qData.q;
        oEl.innerHTML = "";

        qData.o.forEach((optText, idx) => {
            const btn = document.createElement("button");
            btn.className = "quiz-btn";
            btn.textContent = optText;
            btn.onclick = () => {
                if (idx === qData.a) {
                    btn.classList.add("correct");
                    setTimeout(() => {
                        modal.style.display = "none";
                        this.onQuizCorrect();
                    }, 500);
                } else {
                    btn.classList.add("wrong");
                    setTimeout(() => btn.classList.remove("wrong"), 500);
                }
            };
            oEl.appendChild(btn);
        });

        modal.style.display = "flex";
    },

    onQuizCorrect() {
        this.currentParaIndex++;
        this.playNextParagraph();
    }
};

// Override startReadingSession
Game.startReadingSession = function () {
    console.log("Starting Typewriter Logic...");
    if (typeof window.showGazeDot === "function") window.showGazeDot(999999);

    const el = document.getElementById("book-content");
    if (el) {
        el.style.columnWidth = "auto";
        el.style.columnGap = "normal";
    }
    const bar = document.querySelector(".rift-seal-bar");
    if (bar) bar.style.display = "none";

    this.typewriter.start();
};

window.Game = Game;
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});
