/**
 * LipSyncController — speech-driven motion, strictly while audio is playing.
 *
 * The browser's SpeechSynthesisUtterance emits `boundary` events per word on
 * Chromium, which gives real timing instead of a blind sine wave. That timing
 * drives mouth openness (when the asset has a jaw or morph target — this one
 * does not) plus a subtle head emphasis nod (always available).
 *
 * `isActive` only becomes true on the utterance's `start` event and is cleared
 * on `end`/`error`, so the avatar never performs a speaking animation for
 * audio that is not audible.
 */

export class LipSyncController {
    constructor({ facial, animation, onStateChange } = {}) {
        this.facial = facial;
        this.animation = animation;
        this.onStateChange = onStateChange;

        this.isActive = false;
        this.armed = false;
        this.utterance = null;
        this.emotion = "neutral";
        this.mouth = 0;
        this.wordEnergy = 0;
        this.pulseTimer = 0;
        this.boundaryCount = 0;

        this.animation.define("speechNod", 0, 9);
        this.animation.define("speechOpen", 0, 10);
        this.animation.define("speechLean", 0, 4);
    }

    /** Arm lip-sync for an utterance that has not started yet. */
    start(utterance, emotion = "neutral") {
        this.stop();
        this.utterance = utterance || null;
        this.emotion = emotion;
        this.armed = true;
        this.boundaryCount = 0;
        this.wordEnergy = 0.55;

        if (!utterance) return;

        utterance.onstart = () => {
            this.isActive = true;
            this.animation.set("speechLean", 0.012, 4);
            if (this.onStateChange) this.onStateChange(true);
        };

        utterance.onboundary = () => {
            this.boundaryCount += 1;
            this.wordEnergy = 0.45 + Math.random() * 0.55;
            this.pulseTimer = 0.09 + Math.random() * 0.07;
        };

        utterance.onend = () => this.stop();
        utterance.onerror = () => this.stop();
    }

    stop() {
        const wasActive = this.isActive;
        this.isActive = false;
        this.armed = false;
        this.utterance = null;
        this.mouth = 0;
        this.animation.set("speechNod", 0, 6);
        this.animation.set("speechOpen", 0, 8);
        this.animation.set("speechLean", 0, 3);
        this.facial?.setMouthOpen(0);
        if (wasActive && this.onStateChange) this.onStateChange(false);
    }

    update(dt, t) {
        if (!this.isActive) return;

        this.pulseTimer -= dt;

        if (this.pulseTimer > 0) {
            this.mouth = Math.min(1, this.mouth + dt * 14);
        } else {
            this.mouth = Math.max(0, this.mouth - dt * 9);
            if (this.mouth <= 0.01) this.wordEnergy *= 0.6;
        }

        // Fallback oscillation so the head still moves when the voice engine
        // emits no boundary events at all.
        const idleWave = (Math.sin(t * 7.3) * 0.5 + 0.5) * 0.28 * this.wordEnergy;
        const openness = Math.max(this.mouth * this.wordEnergy, idleWave);

        this.facial?.setMouthOpen(openness);
        this.animation.set("speechOpen", openness * 0.5, 12);
        this.animation.set("speechNod", Math.sin(t * 2.4) * 0.012 + openness * 0.010, 8);
    }

    get status() {
        return {
            active: this.isActive,
            armed: this.armed,
            boundaryEvents: this.boundaryCount,
        };
    }
}
