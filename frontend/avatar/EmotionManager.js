/**
 * EmotionManager — maps Phoenix's emotional state onto body language, lighting
 * and (when the asset supports it) facial expression.
 *
 * The backend already returns a structured `emotion` string with every reply
 * (see src/emotion.py). This module is the single place that decides what that
 * emotion looks like, so UI, lights and pose never disagree.
 */

const D = Math.PI / 180;

export const EMOTIONS = {
    neutral: {
        label: "Neutral",
        icon: "⚡",
        pose: "neutral",
        accent: 0x00e5ff,
        particle: 0x00e5ff,
        rim: 0x7c3aed,
        light: 1.2,
        speed: 3.5,
    },
    happy: {
        label: "Happy",
        icon: "✨",
        pose: "confident",
        accent: 0xfacc15,
        particle: 0xfde047,
        rim: 0xf59e0b,
        light: 1.8,
        speed: 5.5,
        nod: 1,
    },
    sad: {
        label: "Sad",
        icon: "💧",
        pose: "neutral",
        accent: 0x60a5fa,
        particle: 0x93c5fd,
        rim: 0x3b82f6,
        light: 0.7,
        speed: 1.8,
        droop: true,
    },
    angry: {
        label: "Angry",
        icon: "🔥",
        pose: "confident",
        accent: 0xf87171,
        particle: 0xff6060,
        rim: 0xef4444,
        light: 2.0,
        speed: 6,
        droop: false,
    },
    anxious: {
        label: "Anxious",
        icon: "💫",
        pose: "listening",
        accent: 0xa78bfa,
        particle: 0xc4b5fd,
        rim: 0x8b5cf6,
        light: 1.4,
        speed: 4,
    },
    confused: {
        label: "Confused",
        icon: "❓",
        pose: "thinking",
        accent: 0xfb923c,
        particle: 0xfdba74,
        rim: 0xf97316,
        light: 1.3,
        speed: 2.8,
    },
    surprised: {
        label: "Surprised",
        icon: "❗",
        pose: "surprised",
        accent: 0xf472b6,
        particle: 0xf9a8d4,
        rim: 0xec4899,
        light: 2.1,
        speed: 7,
    },
    curious: {
        label: "Curious",
        icon: "🔍",
        pose: "listening",
        accent: 0x34d399,
        particle: 0x6ee7b7,
        rim: 0x10b981,
        light: 1.5,
        speed: 4,
    },
    thinking: {
        label: "Thinking",
        icon: "💭",
        pose: "thinking",
        accent: 0x94a3b8,
        particle: 0xcbd5e1,
        rim: 0x64748b,
        light: 1.0,
        speed: 2.5,
    },
};

export class EmotionManager {
    /**
     * @param {object} opts
     * @param {import("./PoseManager.js").PoseManager} opts.poses
     * @param {import("./AnimationManager.js").AnimationManager} opts.animation
     * @param {(emotion:string, cfg:object) => void} [opts.onChange]
     */
    constructor({ poses, animation, onChange } = {}) {
        this.poses = poses;
        this.animation = animation;
        this.onChange = onChange;
        this.current = "neutral";
        this.intensity = 1;

        // Emotion-specific additive body offsets, blended by AnimationManager.
        this.animation.define("emoLean", 0, 2.5);
        this.animation.define("emoHeadPitch", 0, 2.5);
        this.animation.define("emoHeadRoll", 0, 2.5);
        this.animation.define("emoLift", 0, 2.5);
    }

    normalize(emotion) {
        const key = String(emotion || "neutral").toLowerCase();
        return EMOTIONS[key] ? key : "neutral";
    }

    get(emotion) {
        return EMOTIONS[this.normalize(emotion)];
    }

    /**
     * Apply an emotion. Repeat calls for the same emotion are cheap no-ops
     * except for intensity updates.
     */
    set(emotion, { intensity = 1, silent = false } = {}) {
        const key = this.normalize(emotion);
        const cfg = EMOTIONS[key];
        this.intensity = Math.max(0, Math.min(2, intensity));

        if (key !== this.current) {
            this.current = key;
            this.poses.apply(cfg.pose, { speed: cfg.speed, weight: 1 });

            // Layer the emotional attitude on top of the base pose.
            const w = this.intensity;
            const lean = cfg.pose === "thinking" ? -0.02 : cfg.droop ? 0.045 : 0.01;
            this.animation.set("emoLean", lean * w, cfg.speed);
            this.animation.set("emoHeadPitch", (cfg.droop ? 8 * D : 0) * w, cfg.speed);
            this.animation.set("emoHeadRoll", (cfg.droop ? 4 * D : 0) * w, cfg.speed);
            this.animation.set("emoLift", (cfg.droop ? -0.008 : 0) * w, cfg.speed);
        }

        if (!silent && this.onChange) this.onChange(key, cfg);
        return key;
    }

    /** Emit the current emotion again (used after a UI reconnect). */
    refresh() {
        if (this.onChange) this.onChange(this.current, EMOTIONS[this.current]);
    }
}
