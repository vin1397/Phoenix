/**
 * FacialAnimationController — face articulation, or an honest "not available".
 *
 * This asset has no facial bones, no jaw bone and no morph targets, so there is
 * no mouth or eyebrow to drive. This controller:
 *
 *   1. Probes for morph targets and facial bones at startup.
 *   2. Drives them when a future rigged model provides them (emotion → morph
 *      weights, speech → mouth open morph / jaw bone rotation).
 *   3. Otherwise reports `supported: false` and does nothing to the mesh —
 *      no fake blinking, no head-shake pretending to be a mouth.
 *
 * Callers must check `supported` before assuming an expression was applied.
 */

const EXPRESSION_HINTS = {
    happy: ["smile", "happy", "joy", "mouthSmile"],
    sad: ["sad", "frown", "mouthFrown"],
    angry: ["angry", "browAngry", "browLower"],
    surprised: ["surprised", "mouthOpen", "browRaise"],
    confused: ["confused", "browInnerUp"],
    neutral: ["neutral", "mouthClose"],
};

const JAW_NAMES = ["jaw", "chin", "mouth", "lowerjaw"];
const EYE_NAMES = ["eye", "eyeball", "pupil"];

export class FacialAnimationController {
    constructor(rig) {
        this.rig = rig;
        this.morphMeshes = [];
        this.jawBone = null;
        this.eyeBones = [];
        this.blinkSupported = false;
        this.mouthSupported = false;

        this.currentExpression = "neutral";
        this.mouthOpen = 0;
        this.mouthTarget = 0;

        this._probe();
    }

    _probe() {
        if (!this.rig) return;

        for (const part of this.rig.meshes) {
            const dict = part.mesh.morphTargetDictionary;
            if (dict && Object.keys(dict).length) this.morphMeshes.push(part.mesh);
        }

        // Bones are absent on this asset, but a future rigged GLB will expose
        // them through registerBones() below.
        this.jawBone = null;
        this.eyeBones = [];
        this.blinkSupported = false;
        this.mouthSupported = this.morphMeshes.length > 0 && this._hasMorphMatching(["mouthOpen", "jawOpen", "viseme"]);

        this.supported = this.mouthSupported || Boolean(this.jawBone) || Boolean(this.rig.hasFacialRig);
        this.reason = this.supported
            ? "Facial rig detected"
            : "No jaw bone, eye bones or blendshapes in cyber_samurai.glb";
    }

    _hasMorphMatching(keys) {
        for (const mesh of this.morphMeshes) {
            const dict = mesh.morphTargetDictionary || {};
            for (const name of Object.keys(dict)) {
                if (keys.some((k) => name.toLowerCase().includes(k.toLowerCase()))) return true;
            }
        }
        return false;
    }

    /** Map bones named jaw/eye from an arbitrary subtree (for rigged models). */
    registerBones(root) {
        if (!root) return;
        root.traverse((obj) => {
            if (!obj.isBone) return;
            const n = obj.name.toLowerCase();
            if (JAW_NAMES.some((k) => n.includes(k)) && !this.jawBone) {
                this.jawBone = obj;
                this.mouthSupported = true;
            }
            if (EYE_NAMES.some((k) => n.includes(k))) this.eyeBones.push(obj);
        });
        if (this.eyeBones.length) this.blinkSupported = true;
        this.supported = this.mouthSupported || this.blinkSupported || this.morphMeshes.length > 0;
        if (this.supported) this.reason = "Facial rig detected";
    }

    setExpression(emotion) {
        this.currentExpression = emotion;
        if (!this.morphMeshes.length) return false;

        const hints = EXPRESSION_HINTS[emotion] || EXPRESSION_HINTS.neutral;
        for (const mesh of this.morphMeshes) {
            const dict = mesh.morphTargetDictionary || {};
            const influences = mesh.morphTargetInfluences;
            if (!influences) continue;
            for (const [name, index] of Object.entries(dict)) {
                const lower = name.toLowerCase();
                const match = hints.find((h) => lower.includes(h.toLowerCase()));
                // Decay everything that is not this expression, then lift the match.
                influences[index] += ((match ? 0.7 : 0) - influences[index]) * 0.15;
            }
        }
        return true;
    }

    /** @param {number} value 0..1 mouth openness (from LipSyncController) */
    setMouthOpen(value) {
        this.mouthTarget = Math.max(0, Math.min(1, value));
    }

    update(dt) {
        this.mouthOpen += (this.mouthTarget - this.mouthOpen) * Math.min(1, 12 * dt);
        if (!this.mouthSupported) return;

        if (this.jawBone) {
            // ~14° is a comfortable speaking jaw for a humanoid.
            this.jawBone.rotation.x = this.mouthOpen * 0.24;
        }

        for (const mesh of this.morphMeshes) {
            const dict = mesh.morphTargetDictionary || {};
            const influences = mesh.morphTargetInfluences;
            if (!influences) continue;
            for (const [name, index] of Object.entries(dict)) {
                const lower = name.toLowerCase();
                if (lower.includes("mouthopen") || lower.includes("jawopen")) {
                    influences[index] = this.mouthOpen;
                }
            }
        }
    }

    get status() {
        return {
            supported: Boolean(this.supported),
            reason: this.reason || "",
            morphCount: this.morphMeshes.reduce(
                (n, m) => n + Object.keys(m.morphTargetDictionary || {}).length,
                0
            ),
            jawBone: this.jawBone?.name || null,
            eyeBones: this.eyeBones.map((b) => b.name),
        };
    }
}
