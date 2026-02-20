/**
 * SceneManager.js
 * Handles screen transitions and scene-specific UI logic.
 */
export class SceneManager {
    constructor() {
        this.currentScreen = null;
        this.cursor = null; // Track cursor for visibility toggle
    }

    setCursorReference(cursorElement) {
        this.cursor = cursorElement;
    }

    show(screenId) {
        // [FIX-iOS] Auto-clean resources on screen change
        if (window.Game && typeof window.Game.clearAllResources === 'function') {
            window.Game.clearAllResources();
        }

        // 1. Hide all screens
        document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));

        // 2. Show target
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add("active");
            this.currentScreen = screenId;
        } else {
            console.warn(`[SceneManager] Screen ID '${screenId}' not found.`);
        }

        // 3. Handle Cursor Visibility based on context
        this.updateCursorState(screenId);
    }

    updateCursorState(screenId) {
        if (!this.cursor) return;

        if (screenId === "screen-read") {
            this.cursor.style.display = "block";
            this.cursor.style.opacity = "1";
        } else {
            this.cursor.style.display = "none";
            this.cursor.style.opacity = "0";
        }
    }

    // --- Specific Scene Helpers ---

    resetRiftIntro() {
        const introScreen = document.getElementById("screen-rift-intro");
        const villainContainer = document.getElementById("rift-villain-container");
        const textContainer = document.getElementById("rift-text-container");
        const meteorLayer = document.getElementById("meteor-layer");

        if (introScreen) introScreen.className = "screen active scene-peace";
        if (textContainer) {
            textContainer.className = "";
            textContainer.style.opacity = "0";
            textContainer.style.transform = "translateY(20px)";
        }
        if (villainContainer) villainContainer.className = "";
        if (meteorLayer) meteorLayer.innerHTML = "";
    }

    showStoryText(message, type = "overlay") {
        if (type === "villain") {
            const bubble = document.getElementById("rift-villain-speech");
            if (!bubble) return;
            bubble.innerHTML = message;
            bubble.classList.add("show");
            setTimeout(() => bubble.classList.remove("show"), 3000);
        } else {
            const overlay = document.getElementById("rift-story-overlay");
            if (!overlay) return;
            overlay.innerHTML = message;
            overlay.classList.add("show");
            setTimeout(() => overlay.classList.remove("show"), 3500);
        }
    }

    spawnMeteor(layer) {
        if (!layer) return;
        const m = document.createElement("div");
        m.className = "meteor";

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
}
