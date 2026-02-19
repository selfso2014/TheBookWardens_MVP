export class IntroManager {
    constructor(game) {
        this.game = game;
    }

    init() {
        this.bindEvents();
        this.checkAutoStart();
        this.initWPMPreviews();
    }

    bindEvents() {
        const startBtn = document.getElementById("btn-start-game");
        if (startBtn) {
            startBtn.onclick = async () => {
                // 1. Check In-App Browser
                if (this.isInAppBrowser()) {
                    this.openSystemBrowser();
                    return;
                }

                // 2. Fullscreen Request
                try {
                    if (document.documentElement.requestFullscreen) {
                        await document.documentElement.requestFullscreen();
                    }
                } catch (e) {
                    console.warn("Fullscreen deferred: " + e.message);
                }

                // 3. Start Rift Intro
                this.startRiftIntro();
            };
        }

        // --- DEBUG: Mission Report Shortcut ---
        this.createDebugReportButton();
    }

    createDebugReportButton() {
        // Prevent duplicate button
        if (document.getElementById("btn-debug-report")) return;

        const container = document.getElementById("screen-home");
        if (!container) return;

        const debugBtn = document.createElement("button");
        debugBtn.id = "btn-debug-report";
        debugBtn.innerText = "🛠 Test Report";
        debugBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255, 0, 0, 0.2);
            border: 1px solid red;
            color: white;
            padding: 8px 12px;
            font-size: 0.8rem;
            cursor: pointer;
            z-index: 10000;
            border-radius: 4px;
        `;

        debugBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent other clicks
            console.log("[Debug] Jumping to Mission Report with Mock Data...");

            // Mock Data for Scoring Animation Check
            const mockScoreData = {
                wpm: 245,      // Target WPM
                ink: 135,      // Ink Collected
                rune: 12,      // Runes Deciphered
                gem: 5         // Gems Earned
            };

            if (this.game && typeof this.game.goToNewScore === 'function') {
                this.game.goToNewScore(mockScoreData);
            } else {
                console.error("[Debug] Game.goToNewScore not found!");
            }
        };

        container.appendChild(debugBtn);
    }

    checkAutoStart() {
        const params = new URLSearchParams(window.location.search);
        // Check for 'skip_intro=1' or legacy 'skip=1'
        if ((params.get("skip_intro") === "1" || params.get("skip") === "1") && !this.isInAppBrowser()) {
            console.log("[IntroManager] Auto-starting game (Skip Intro)...");

            // Wait for DOM if needed, then switch
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => {
                    this.game.switchScreen("screen-home");
                });
            } else {
                this.game.switchScreen("screen-home");
            }
        }
    }

    // --- Rift Intro Sequence (Cinematic 20s) ---
    async startRiftIntro() {
        console.log("[IntroManager] Starting Rift Intro Sequence...");

        // Use Game's Switch Screen
        this.game.switchScreen("screen-rift-intro");
        if (this.game.sceneManager) {
            this.game.sceneManager.resetRiftIntro();
        }

        // Helper for delays
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        const introScreen = document.getElementById("screen-rift-intro");
        const villainContainer = document.getElementById("rift-villain-container");
        const textContainer = document.getElementById("rift-text-container");
        const meteorLayer = document.getElementById("meteor-layer");

        // --- SCENE 1: PEACE (0s - 2.2s) ---
        await wait(200);
        if (textContainer) {
            textContainer.style.opacity = 1;
            textContainer.style.transform = "translateY(0)";
        }

        if (this.game.sceneManager) this.game.sceneManager.showStoryText("Every story holds a world within.");
        await wait(2000);

        // --- SCENE 2: WARNING (2.2s - 4.2s) ---
        if (introScreen) {
            introScreen.classList.remove("scene-peace");
            introScreen.classList.add("scene-warning");
        }

        if (this.game.sceneManager) this.game.sceneManager.showStoryText("But chaos seeks to consume it.");

        if (villainContainer) villainContainer.style.opacity = 0.6;
        await wait(2000);

        // --- SCENE 3: INVASION (4.2s - 5.7s) ---
        if (introScreen) {
            introScreen.classList.remove("scene-warning");
            introScreen.classList.add("scene-invasion");
        }

        // Use explicit type "villain" if supported by SceneManager, usually it handles arguments
        // But referencing game.js: showStoryText(msg, type) was invoked on sceneManager?
        // Actually, game.js had its own showStoryText but called this.sceneManager.showStoryText in startRiftIntro.
        // Let's assume SceneManager has it. If not, we might need to move that helper here too.
        // Checking game.js line 60: this.sceneManager.showStoryText(...)
        // So SceneManager HAS it.
        if (this.game.sceneManager) this.game.sceneManager.showStoryText("The Rift opens!", "villain");

        if (villainContainer) villainContainer.style.opacity = 1;

        // Start light meteors
        const lightMeteorLoop = setInterval(() => {
            if (Math.random() > 0.7) this.spawnMeteor(meteorLayer);
        }, 300);

        await wait(1500);
        clearInterval(lightMeteorLoop);

        // --- SCENE 4: DESTRUCTION (5.7s - 9.5s) ---
        if (introScreen) {
            introScreen.classList.remove("scene-invasion");
            introScreen.classList.add("scene-destruction");
        }

        if (this.game.sceneManager) this.game.sceneManager.showStoryText("The words are fading...<br>WARDEN, RESTORE THE STORY!");
        if (textContainer) textContainer.classList.add("rift-damaged");

        const heavyMeteorLoop = setInterval(() => {
            this.spawnMeteor(meteorLayer);
            this.spawnMeteor(meteorLayer);
        }, 100);

        await wait(3000);
        await wait(800);
        clearInterval(heavyMeteorLoop);

        // --- SCENE 5: TRANSITION ---
        if (this.game.sceneManager) this.game.sceneManager.showStoryText("Initializing Word Forge...");
        await wait(1000);

        console.log("[IntroManager] Rift Intro Done. Moving to Word Forge.");

        // Final Transition logic
        this.game.state.vocabIndex = 0;
        this.game.loadVocab(0);
        this.game.switchScreen("screen-word");
    }

    spawnMeteor(layer) {
        if (!layer) return;
        const m = document.createElement("div");
        m.className = "meteor";

        // Spawn Area: Top-Left to Top-Center for Diagonal Fall
        const startX = (Math.random() * window.innerWidth * 1.0) - (window.innerWidth * 0.2);
        const startY = Math.random() * 400;

        m.style.left = startX + "px";
        m.style.top = startY + "px";

        const size = 200 + Math.random() * 300;
        m.style.width = size + "px";

        const speed = 0.8 + Math.random() * 0.7;
        m.style.animationDuration = speed + "s";
        m.style.animationDelay = (Math.random() * 0.2) + "s";

        layer.appendChild(m);
        setTimeout(() => m.remove(), 2000);
    }

    // --- Utility: Browser Detection ---
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
    }

    openSystemBrowser() {
        const url = window.location.href;
        if (/Android/i.test(navigator.userAgent)) {
            let newUrl = url;
            if (newUrl.indexOf("?") === -1) newUrl += "?skip_intro=1";
            else if (newUrl.indexOf("skip_intro=1") === -1) newUrl += "&skip_intro=1";

            const noProtocol = newUrl.replace(/^https?:\/\//, "");
            const intentUrl = `intent://${noProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
            window.location.href = intentUrl;
        } else {
            alert("Please copy the URL and open it in Safari or Chrome to play.");
            navigator.clipboard.writeText(url).then(() => {
                alert("URL copied to clipboard!");
            }).catch(() => { });
        }
    }

    // --- WPM Previews ---
    initWPMPreviews() {
        const boxes = document.querySelectorAll('.wpm-anim-box');
        if (boxes.length === 0) return;

        const sentences = [
            "The sun was warm in the sky.",
            "A small boy walked to the park.",
            "He saw a dog on the grass."
        ];
        const fullText = sentences.join(" ");

        boxes.forEach(box => {
            const wpm = parseInt(box.getAttribute('data-wpm'), 10) || 100;
            if (box._previewCleanup) box._previewCleanup();
            this.runWPMPreview(box, wpm, fullText);
        });
    }

    runWPMPreview(container, wpm, text) {
        container.innerHTML = "";
        container.style.position = "relative";
        container.style.whiteSpace = "normal";
        container.style.overflow = "hidden";
        container.style.display = "block";
        container.style.height = "auto";
        container.style.minHeight = "1.8em";
        container.style.fontSize = "0.85rem";
        container.style.lineHeight = "1.4";
        container.style.color = "#aaa";

        const words = text.split(" ");
        let wordSpans = [];

        words.forEach(w => {
            const span = document.createElement("span");
            span.textContent = w;
            span.style.opacity = "0";
            span.style.marginRight = "0.3em";
            span.style.display = "inline-block";
            span.style.transition = "opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
            span.style.transform = "translateY(10px)";
            span.style.color = "#eee";
            container.appendChild(span);
            wordSpans.push(span);
        });

        let currentIndex = 0;
        let isRunning = true;
        let timer = null;
        let chunkCount = 0;

        // Use Game's calculation logic if available
        let params = { interval: 300, chunkSize: 3, delay: 500 };
        if (this.game.calculateWPMAttributes) {
            params = this.game.calculateWPMAttributes(wpm);
        }

        const WORD_INTERVAL = params.interval;
        const TARGET_CHUNK_SIZE = params.chunkSize;
        const CHUNK_DELAY = params.delay;

        const tick = () => {
            if (!isRunning) return;

            if (currentIndex >= wordSpans.length) {
                setTimeout(() => {
                    wordSpans.forEach(s => {
                        s.style.opacity = "0";
                        s.style.transform = "translateY(10px)";
                    });
                    currentIndex = 0;
                    chunkCount = 0;
                    tick();
                }, 2000);
                return;
            }

            const span = wordSpans[currentIndex];
            const wordText = words[currentIndex];

            span.style.opacity = "1";
            span.style.transform = "translateY(0)";

            currentIndex++;
            chunkCount++;

            setTimeout(() => {
                if (isRunning && span) {
                    span.style.opacity = "0.3";
                }
            }, 2000);

            let nextDelay = WORD_INTERVAL;
            const isEnd = wordText.includes('.') || wordText.includes('?') || wordText.includes('!');
            const isComma = wordText.includes(',');

            if (isEnd || isComma || chunkCount >= TARGET_CHUNK_SIZE) {
                nextDelay = CHUNK_DELAY;
                chunkCount = 0;
            }

            timer = setTimeout(tick, nextDelay);
        };

        tick();

        container._previewCleanup = () => {
            isRunning = false;
            if (timer) clearTimeout(timer);
            container.innerHTML = "";
        };
    }
}
