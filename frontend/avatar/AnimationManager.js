/**
 * AnimationManager — frame-rate independent blending for procedural animation.
 *
 * Phoenix's GLB has no animation clips, so there is no THREE.AnimationMixer
 * track to cross-fade. Instead this manager stores named scalar channels and
 * smooths every channel toward a target with exponential damping. Controllers
 * push targets; AvatarController composes the smoothed values into transforms.
 *
 * Because each channel has exactly one writer per frame and transforms are
 * composed in one place, no two systems can fight over the same bone.
 */

export class AnimationManager {
    constructor() {
        /** @type {Map<string, {value:number, target:number, speed:number}>} */
        this.channels = new Map();
        /** @type {Array<(dt:number, channels:Map<string,number>) => void>} */
        this.appliers = [];
        this._values = {};
        this.time = 0;
        this.enabled = true;
    }

    /** Declare a channel. Safe to call twice; keeps existing value. */
    define(name, initial = 0, speed = 6) {
        if (!this.channels.has(name)) {
            this.channels.set(name, { value: initial, target: initial, speed });
        }
        return this;
    }

    /** Set the target for a channel (created on demand). */
    set(name, target, speed) {
        const ch = this.channels.get(name);
        if (!ch) {
            this.define(name, target, speed ?? 6);
            return this;
        }
        ch.target = target;
        if (speed != null) ch.speed = speed;
        return this;
    }

    /** Nudge a target by a delta, clamped to a range. */
    add(name, delta, { min = -Infinity, max = Infinity, speed } = {}) {
        const ch = this.channels.get(name);
        const base = ch ? ch.target : 0;
        const next = Math.min(max, Math.max(min, base + delta));
        return this.set(name, next, speed);
    }

    get(name) {
        return this.channels.get(name)?.value ?? 0;
    }

    /** Snap a channel without smoothing (used for hard resets). */
    reset(name, value = 0) {
        const ch = this.channels.get(name);
        if (ch) {
            ch.value = value;
            ch.target = value;
        }
        return this;
    }

    /** Register a function called once per update with the smoothed values. */
    onUpdate(fn) {
        this.appliers.push(fn);
        return () => {
            const i = this.appliers.indexOf(fn);
            if (i !== -1) this.appliers.splice(i, 1);
        };
    }

    update(dt) {
        if (!this.enabled) return;
        // Clamp dt so a backgrounded tab does not cause a huge jump on return.
        const step = Math.min(dt, 0.1);
        this.time += step;

        const values = this._values;
        this.channels.forEach((ch, name) => {
            // Exponential smoothing: 1 - e^(-speed*dt) is frame-rate independent.
            const k = 1 - Math.exp(-ch.speed * step);
            ch.value += (ch.target - ch.value) * k;
            values[name] = ch.value;
        });

        for (const fn of this.appliers) fn(step, values, this.time);
    }
}
