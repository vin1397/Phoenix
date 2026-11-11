/**
 * PoseManager — reusable, named body poses for a model without a skeleton.
 *
 * Each pose is a small set of additive offsets (radians / model units) applied
 * to the root and the head pivot. Because there is no rig, a pose can only
 * express lean, turn and head attitude — there are no arm or hand gestures to
 * drive. Poses that would need limbs (greeting wave, confident stance with
 * hands on hips) are represented by the closest attitude the asset supports
 * and are marked `partial` so nothing is overstated.
 *
 * Transitions are handled by AnimationManager smoothing, so switching poses
 * always blends instead of cutting.
 */

const D = Math.PI / 180;

export const POSES = {
    neutral: {
        label: "Neutral standing",
        partial: false,
        yaw: 0,
        pitch: 0,
        lift: 0,
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
        speed: 3.5,
    },
    listening: {
        label: "Listening",
        partial: false,
        yaw: 0.02,
        pitch: 0.012,
        lift: 0.004,
        headYaw: 0,
        headPitch: -2 * D,
        headRoll: 4 * D, // slight, attentive tilt
        speed: 4,
    },
    thinking: {
        label: "Thinking",
        partial: false,
        yaw: -3 * D,
        pitch: -0.018,
        lift: 0,
        headYaw: -7 * D,
        headPitch: 5 * D,
        headRoll: -5 * D,
        speed: 3,
    },
    speaking: {
        label: "Speaking",
        partial: false,
        yaw: 0,
        pitch: 0.02,
        lift: 0.006,
        headYaw: 0,
        headPitch: -1.5 * D,
        headRoll: 0,
        speed: 4.5,
    },
    greeting: {
        label: "Greeting",
        partial: true, // no arm rig: a slight bow instead of a wave
        yaw: 0,
        pitch: 0.06,
        lift: -0.01,
        headYaw: 0,
        headPitch: 7 * D,
        headRoll: 0,
        speed: 2.6,
    },
    confident: {
        label: "Confident",
        partial: true,
        yaw: 2 * D,
        pitch: -0.035,
        lift: 0.012,
        headYaw: 3 * D,
        headPitch: -4 * D,
        headRoll: -2 * D,
        speed: 3,
    },
    surprised: {
        label: "Surprised",
        partial: false,
        yaw: 0,
        pitch: -0.06,
        lift: 0.014,
        headYaw: 0,
        headPitch: -8 * D,
        headRoll: 0,
        speed: 7,
    },
    explaining: {
        label: "Explaining",
        partial: true,
        yaw: 1.5 * D,
        pitch: 0.015,
        lift: 0.004,
        headYaw: 4 * D,
        headPitch: 1 * D,
        headRoll: 2 * D,
        speed: 3.5,
    },
};

const CHANNELS = ["yaw", "pitch", "lift", "headYaw", "headPitch", "headRoll"];

export class PoseManager {
    constructor(animation) {
        this.animation = animation;
        this.current = "neutral";
        this.currentWeight = 1;

        for (const ch of CHANNELS) this.animation.define(`pose_${ch}`, 0, 3.5);

        this.apply("neutral", { instant: true });
    }

    has(name) {
        return Boolean(POSES[name]);
    }

    get(name) {
        return POSES[name] || POSES.neutral;
    }

    /**
     * Blend to a pose. `weight` scales the offsets, which lets an emotion lean
     * on a pose without replacing it outright.
     */
    apply(name, { weight = 1, instant = false, speed } = {}) {
        const pose = this.get(name);
        this.current = this.has(name) ? name : "neutral";
        this.currentWeight = weight;

        for (const ch of CHANNELS) {
            const value = (pose[ch] || 0) * weight;
            const s = speed ?? pose.speed ?? 3.5;
            if (instant) this.animation.reset(`pose_${ch}`, value);
            else this.animation.set(`pose_${ch}`, value, s);
        }
        return this.current;
    }

    /** Add a one-off offset on top of the current pose, e.g. a flinch. */
    impulse(channel, amount, speed = 9) {
        const ch = this.animation.channels.get(`pose_${channel}`);
        if (!ch) return;
        this.animation.set(`pose_${channel}`, ch.target + amount, speed);
        setTimeout(() => {
            const pose = this.get(this.current);
            this.animation.set(`pose_${channel}`, (pose[channel] || 0) * this.currentWeight, 3);
        }, 320);
    }
}
