/**
 * AvatarController — owns the model, its measured capabilities and all motion.
 *
 * Responsibilities:
 *   • load + normalize the GLB (axis, scale, floor placement),
 *   • probe the rig and build a pivot for the detected head part,
 *   • compose every animation channel into transforms in exactly one place so
 *     no two controllers can fight over the same node,
 *   • expose a small behaviour API to the app (setState / setEmotion / speak).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { inspectRig, disposeSubtree } from "./RigInspector.js";
import { AnimationManager } from "./AnimationManager.js";
import { IdleAnimationController } from "./IdleAnimationController.js";
import { GazeController } from "./GazeController.js";
import { PoseManager } from "./PoseManager.js";
import { EmotionManager } from "./EmotionManager.js";
import { FacialAnimationController } from "./FacialAnimationController.js";
import { LipSyncController } from "./LipSyncController.js";

const MAX_BODY_YAW = 0.22;
const MAX_BODY_PITCH = 0.12;
const MAX_HEAD_YAW = 0.2;
const MAX_HEAD_PITCH = 0.14;
const MAX_HEAD_ROLL = 0.16;

export class AvatarController {
    constructor({ scene, targetHeight = 1.85, onEmotionChange } = {}) {
        this.scene = scene;
        this.targetHeight = targetHeight;
        this.onEmotionChange = onEmotionChange;

        this.root = null;
        this.gltfScene = null;
        this.model = null;
        this.mixer = null;
        this.headPivot = null;
        this.rig = null;
        this.measurements = { height: targetHeight, width: 1, depth: 1 };
        this.state = "idle";
        this.ready = false;
        this.loadError = null;
        this.baseY = 0;

        this.animation = new AnimationManager();
        this.poses = new PoseManager(this.animation);
        this.emotions = new EmotionManager({
            poses: this.poses,
            animation: this.animation,
            onChange: (emotion, cfg) => {
                if (this.onEmotionChange) this.onEmotionChange(emotion, cfg);
            },
        });
        this.idle = new IdleAnimationController(this.animation);
        this.gaze = new GazeController(this.animation, { hasHead: false });
        this.facial = new FacialAnimationController(null);
        this.lipsync = new LipSyncController({
            facial: this.facial,
            animation: this.animation,
            onStateChange: (active) => this.setState(active ? "speaking" : "idle", { silent: true }),
        });

        // Motion channels that are not owned by a controller.
        this.animation.define("attention", 0, 2.5);
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    async load(url, { onProgress } = {}) {
        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
            loader.load(
                url,
                resolve,
                (event) => {
                    if (!onProgress) return;
                    const pct = event.total ? Math.round((event.loaded / event.total) * 100) : null;
                    onProgress(event.loaded, event.total, pct);
                },
                (error) => reject(error)
            );
        }).catch((error) => {
            this.loadError = error?.message || String(error);
            throw error;
        });

        this.gltfScene = gltf.scene;
        this.root = new THREE.Group();
        this.root.name = "phoenix_avatar_root";
        this.root.add(this.gltfScene);
        this.scene.add(this.root);

        this._normalize();

        // Inspect AFTER normalization so measured bounds match what is rendered.
        this.rig = inspectRig(this.root, { clips: gltf.animations || [] });
        this.measurements = {
            height: this.rig.size.y,
            width: this.rig.size.x,
            depth: this.rig.size.z,
        };

        this._prepareMaterials();
        this._buildHeadPivot();

        this.gaze.hasHead = Boolean(this.headPivot);
        this.facial.registerBones(this.root);

        // If a future GLB ships real animation clips, play the first as a base
        // loop. The procedural layer stays additive on top.
        if (gltf.animations?.length) {
            this.mixer = new THREE.AnimationMixer(this.model);
            const idleClip =
                gltf.animations.find((c) => /idle|stand|breath/i.test(c.name)) || gltf.animations[0];
            this.mixer.clipAction(idleClip).play();
        }

        this.ready = true;
        return this;
    }

    _normalize() {
        const scene = this.gltfScene;

        // Sketchfab exports are frequently Z-up; glTF expects Y-up.
        let box = new THREE.Box3().setFromObject(scene);
        let size = box.getSize(new THREE.Vector3());
        if (size.z > size.y * 1.15) {
            scene.rotation.x = -Math.PI / 2;
            scene.updateMatrixWorld(true);
            box = new THREE.Box3().setFromObject(scene);
            size = box.getSize(new THREE.Vector3());
        }

        const scale = this.targetHeight / Math.max(size.y, 0.0001);
        scene.scale.multiplyScalar(scale);
        scene.updateMatrixWorld(true);

        box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());

        // Feet on the floor, centred on the origin.
        scene.position.x -= center.x;
        scene.position.z -= center.z;
        scene.position.y -= box.min.y;
        scene.updateMatrixWorld(true);
    }

    _prepareMaterials() {
        this.gltfScene.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.castShadow = true;
            obj.receiveShadow = false;
            // Keep transmission materials cheap: the avatar is viewed from one
            // side only and the scene has no refractions to resolve.
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) {
                if (!mat) continue;
                if (mat.transmission > 0) mat.transmission = 0;
                mat.envMapIntensity = 0.6;
                mat.needsUpdate = true;
            }
        });
    }

    _buildHeadPivot() {
        const head = this.rig?.head;
        if (!head?.mesh) return;

        const mesh = head.mesh;
        const parent = mesh.parent || this.root;

        const pivot = new THREE.Group();
        pivot.name = "phoenix_head_pivot";
        parent.add(pivot);

        parent.updateMatrixWorld(true);
        const local = parent.worldToLocal(head.pivot.clone());
        pivot.position.copy(local);
        pivot.rotation.order = "YXZ";
        pivot.updateMatrixWorld(true);

        // Re-parent the head part onto the pivot without moving it in space.
        pivot.attach(mesh);

        this.headPivot = pivot;
        this.headMesh = mesh;
    }

    /** Camera framing derived from the measured model, not guessed numbers. */
    getFraming() {
        const h = this.measurements.height;
        return {
            target: new THREE.Vector3(0, h * 0.56, 0),
            position: new THREE.Vector3(0, h * 0.62, h * 2.15),
            minDistance: h * 1.6,
            maxDistance: h * 2.6,
        };
    }

    // ── Behaviour API ────────────────────────────────────────────────────────

    setEmotion(emotion, options = {}) {
        const key = this.emotions.set(emotion, options);
        this.facial.setExpression(key);
        return key;
    }

    /**
     * @param {"idle"|"listening"|"thinking"|"speaking"} state
     */
    setState(state, { silent = false } = {}) {
        if (this.state === state) return;
        const previous = this.state;
        this.state = state;

        this.gaze.setMode(state);

        switch (state) {
            case "listening":
                this.poses.apply("listening", { speed: 3.5 });
                this.animation.set("attention", 1, 3);
                this.idle.setIntensity(0.55);
                break;
            case "thinking":
                this.poses.apply("thinking", { speed: 3 });
                this.animation.set("attention", 0.8, 3);
                this.idle.setIntensity(0.5);
                break;
            case "speaking":
                // Keep the emotion pose if it exists, otherwise the speaking one.
                if (this.emotions.current === "neutral") this.poses.apply("speaking", { speed: 4 });
                this.animation.set("attention", 0.9, 3);
                this.idle.setIntensity(1.1);
                break;
            default:
                this.poses.apply(this.emotions.get(this.emotions.current).pose, { speed: 2.6 });
                this.animation.set("attention", 0, 3);
                this.idle.setIntensity(1);
                if (previous === "speaking" && !silent) this.lipsync.stop();
        }
    }

    /** Called for a conversational reply; returns true if TTS will speak it. */
    speak(utterance, emotion) {
        if (!utterance) return false;
        this.lipsync.start(utterance, emotion);
        return true;
    }

    // ── Frame loop ───────────────────────────────────────────────────────────

    tick(dt) {
        if (!this.ready) return;

        this.idle.update(dt);
        this.gaze.update(dt);
        this.lipsync.update(dt, this.animation.time);
        this.facial.update(dt);

        this.animation.update(dt);
        if (this.mixer) this.mixer.update(dt);

        this._applyTransforms();
    }

    _applyTransforms() {
        const v = (name) => this.animation.get(name);

        const breath = v("breath");
        const bodyYawRaw = v("sway") + v("pose_yaw") + v("gazeYaw") * 0.22;
        const bodyPitchRaw = v("pose_pitch") + v("emoLean") + v("speechLean");
        const bodyLift = v("pose_lift") + v("emoLift");

        let headYaw = v("gazeYaw") + v("pose_headYaw") + v("microYaw");
        let headPitch = v("gazePitch") + v("pose_headPitch") + v("emoHeadPitch") + v("speechNod");
        let headRoll = v("pose_headRoll") + v("microRoll") + v("emoHeadRoll");

        let bodyYaw = bodyYawRaw;
        let bodyPitch = bodyPitchRaw;

        if (this.headPivot) {
            headYaw = THREE.MathUtils.clamp(headYaw, -MAX_HEAD_YAW, MAX_HEAD_YAW);
            headPitch = THREE.MathUtils.clamp(headPitch, -MAX_HEAD_PITCH, MAX_HEAD_PITCH);
            headRoll = THREE.MathUtils.clamp(headRoll, -MAX_HEAD_ROLL, MAX_HEAD_ROLL);
        } else {
            // No head part: fold a fraction of the head motion into the body so
            // attention is still readable, without pretending a head turned.
            bodyYaw += headYaw * 0.4;
            bodyPitch += headPitch * 0.2;
            headYaw = headPitch = headRoll = 0;
        }

        this.root.rotation.y = THREE.MathUtils.clamp(bodyYaw, -MAX_BODY_YAW, MAX_BODY_YAW);
        this.root.rotation.x = THREE.MathUtils.clamp(bodyPitch, -MAX_BODY_PITCH, MAX_BODY_PITCH);

        // Breathing is applied directly to the model, not the root, so camera
        // framing and floor contact stay stable.
        this.gltfScene.position.y += (this.baseY + breath * 0.012 - this.gltfScene.position.y) * 0.35;
        // The normalizer already placed the feet at y=0; baseY stores that.
        if (this.baseY === 0) this.baseY = this.gltfScene.position.y;

        if (this.headPivot) {
            this.headPivot.rotation.set(headPitch, headYaw, headRoll, "YXZ");
        }

        if (this._glowRing) {
            const a = 0.055 + Math.abs(breath) * 0.03 + v("speechOpen") * 0.05;
            this._glowRing.material.opacity = a;
        }
    }

    /** Let the app tie ambient scene pieces to the avatar's breathing. */
    attachGlowRing(mesh) {
        this._glowRing = mesh;
    }

    /** Capability report for the HUD and debugging. */
    getStatus() {
        return {
            ready: this.ready,
            loadError: this.loadError,
            state: this.state,
            emotion: this.emotions.current,
            rig: this.rig
                ? {
                      hasSkeleton: this.rig.hasSkeleton,
                      boneCount: this.rig.boneCount,
                      hasFacialRig: this.rig.hasFacialRig,
                      morphTargets: this.rig.morphTargets,
                      clipCount: this.rig.clipCount,
                      meshCount: this.rig.meshCount,
                      head: this.rig.head
                          ? {
                                name: this.rig.head.name,
                                confidence: this.rig.head.confidence,
                                candidateCount: this.rig.head.candidateCount,
                            }
                          : null,
                      summary: this.rig.summary(),
                  }
                : null,
            facial: this.facial.status,
            lipsync: this.lipsync.status,
            headPivot: Boolean(this.headPivot),
            measurements: this.measurements,
        };
    }

    dispose() {
        this.gaze.dispose();
        this.lipsync.stop();
        if (this.root) {
            this.scene.remove(this.root);
            disposeSubtree(this.root);
        }
        this.mixer?.stopAllAction();
        this.ready = false;
    }
}
