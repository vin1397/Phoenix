/**
 * GazeController — the character attends to the cursor.
 *
 * With no head bone, the head mesh is rotated on its computed neck pivot.
 * Rotation is intentionally small (a few degrees): a hard, snappy head swing
 * looks mechanical, and this model has no neck geometry to hide the seam.
 *
 * Eye tracking and blinking need eye geometry or blendshapes, which this asset
 * does not have — see PROJECT_STATUS.md. `supportsEyes` reports that honestly.
 */

export class GazeController {
    constructor(animation, { hasHead = false, limitYaw = 0.16, limitPitch = 0.10 } = {}) {
        this.animation = animation;
        this.hasHead = hasHead;
        this.limitYaw = limitYaw;
        this.limitPitch = limitPitch;

        this.pointer = { x: 0, y: 0 }; // normalised -1..1
        this.target = { x: 0, y: 0 };
        this.mode = "idle"; // idle | listening | speaking
        this.supportsEyes = false;

        this._onMove = (e) => this._trackPointer(e.clientX, e.clientY);
        this._onTouch = (e) => {
            if (e.touches?.length) this._trackPointer(e.touches[0].clientX, e.touches[0].clientY);
        };

        window.addEventListener("mousemove", this._onMove, { passive: true });
        window.addEventListener("touchmove", this._onTouch, { passive: true });

        this.animation.define("gazeYaw", 0, 3.2);
        this.animation.define("gazePitch", 0, 3.2);
        this.animation.define("eyeYaw", 0, 6);
        this.animation.define("eyePitch", 0, 6);
    }

    _trackPointer(clientX, clientY) {
        const vp = document.getElementById("viewport") || document.body;
        const rect = vp.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const nx = ((clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((clientY - rect.top) / rect.height - 0.5) * 2;
        this.pointer.x = Math.max(-1, Math.min(1, nx));
        this.pointer.y = Math.max(-1, Math.min(1, ny));
    }

    setMode(mode) {
        this.mode = mode;
        // While listening, attention is pinned toward the user; the cursor still
        // makes small corrections on top of that.
        if (mode === "listening") {
            this.target.x = 0;
            this.target.y = 0;
        }
    }

    update() {
        let tx = this.pointer.x;
        let ty = this.pointer.y;

        if (this.mode === "thinking") {
            // Look away and up a touch while reasoning.
            tx = -0.55;
            ty = -0.45;
        } else if (this.mode === "listening") {
            tx = this.pointer.x * 0.35;
            ty = this.pointer.y * 0.35;
        } else if (this.mode === "speaking") {
            tx = this.pointer.x * 0.7;
            ty = this.pointer.y * 0.7;
        }

        this.target.x += (tx - this.target.x) * 0.12;
        this.target.y += (ty - this.target.y) * 0.12;

        // +x on screen means the user is to the right → head turns toward them.
        this.animation.set("gazeYaw", this.target.x * this.limitYaw, 3.2);
        this.animation.set("gazePitch", this.target.y * this.limitPitch, 3.2);

        // Future-ready: independent eye channels stay at zero on this asset.
        if (this.supportsEyes) {
            this.animation.set("eyeYaw", this.target.x * 0.25, 6);
            this.animation.set("eyePitch", this.target.y * 0.15, 6);
        }
    }

    dispose() {
        window.removeEventListener("mousemove", this._onMove);
        window.removeEventListener("touchmove", this._onTouch);
    }
}
