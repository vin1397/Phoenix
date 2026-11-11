/**
 * IdleAnimationController — the "alive" baseline.
 *
 * Drives breathing, weight shift and occasional micro-adjustments. Everything
 * is tiny: the goal is that the character reads as standing and breathing, not
 * that it visibly bobs. Amplitudes are in radians / model units.
 */

export class IdleAnimationController {
    constructor(animation, { enabled = true } = {}) {
        this.animation = animation;
        this.enabled = enabled;

        // Breath: ~4.2s cycle, the classic calm-resting rate.
        this.breathPeriod = 4.2;
        this.breathAmplitude = 1;
        // Weight shift: slow lateral sway, deliberately not in sync with breath.
        this.swayPeriod = 11.0;
        this.swayAmplitude = 0.010; // radians
        // Micro head adjustments, triggered at random intervals.
        this.microTimer = 3 + Math.random() * 4;
        this.microTarget = 0;
        this.microRollTarget = 0;

        this.animation.define("breath", 0, 4);
        this.animation.define("sway", 0, 1.2);
        this.animation.define("microYaw", 0, 2.5);
        this.animation.define("microRoll", 0, 2.5);
    }

    update(dt) {
        if (!this.enabled) return;

        const t = this.animation.time;

        // Breathing is applied directly (it is a sine, not a spring target).
        const breath = Math.sin((t / this.breathPeriod) * Math.PI * 2);
        const breathCh = this.animation.channels.get("breath");
        if (breathCh) {
            breathCh.value = breath * this.breathAmplitude;
            breathCh.target = breathCh.value;
        }

        this.animation.set(
            "sway",
            Math.sin((t / this.swayPeriod) * Math.PI * 2) * this.swayAmplitude,
            2
        );

        // Occasional small head adjustment so the pose never looks frozen.
        this.microTimer -= dt;
        if (this.microTimer <= 0) {
            this.microTimer = 4 + Math.random() * 7;
            this.microTarget = (Math.random() - 0.5) * 0.045; // ±1.3°
            this.microRollTarget = (Math.random() - 0.5) * 0.03;
        }
        this.animation.set("microYaw", this.microTarget, 1.4);
        this.animation.set("microRoll", this.microRollTarget, 1.4);
    }

    /** Calm the idle layer down while a stronger behaviour owns the body. */
    setIntensity(scale) {
        this.breathAmplitude = Math.max(0, Math.min(1.6, scale));
        this.swayAmplitude = 0.010 * Math.max(0.2, Math.min(1.4, scale));
    }
}
