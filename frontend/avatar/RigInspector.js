/**
 * RigInspector — measures what a loaded GLB can actually do.
 *
 * Phoenix's current `cyber_samurai.glb` has no skeleton, no skin, no animation
 * clips and no morph targets. It is a static, material-merged mesh set. Rather
 * than assuming a rig exists, every capability the animation layer uses is
 * probed here and reported honestly to the UI.
 *
 * The only articulation we can recover from this asset is *rigid part*
 * articulation: individual mesh nodes, pivoted at a computed joint. That is
 * enough for head turns on the head/helmet piece, and nothing else.
 */

import * as THREE from "three";

const MIN_HEAD_VERTS = 400;

/** Classify every mesh node in the model. */
export function inspectRig(root, { clips = [] } = {}) {
    const meshes = [];
    const bones = [];
    const morphTargets = [];

    root.updateMatrixWorld(true);

    root.traverse((obj) => {
        if (obj.isBone) bones.push(obj);
        if (!obj.isMesh) return;
        meshes.push(obj);
        const dict = obj.morphTargetDictionary;
        if (dict) {
            for (const key of Object.keys(dict)) {
                if (!morphTargets.includes(key)) morphTargets.push(key);
            }
        }
    });

    // World-space bounds of the whole avatar (root is at the origin at load).
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());

    const parts = meshes.map((mesh) => {
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const verts = mesh.geometry?.attributes?.position?.count ?? 0;
        return {
            mesh,
            name: mesh.name || "(unnamed)",
            verts,
            box,
            center,
            height: box.max.y - box.min.y,
        };
    });

    const head = detectHeadPart(parts, bounds, size);

    const hasSkeleton = bones.length > 0;
    const hasFacialRig = morphTargets.length > 0;

    return {
        hasSkeleton,
        boneCount: bones.length,
        boneNames: bones.map((b) => b.name),
        jointNames: bones.filter((b) => /jaw|mouth|eye|head|neck/i.test(b.name)).map((b) => b.name),
        hasFacialRig,
        morphTargets,
        clips: clips.map((c) => c.name),
        clipCount: clips.length,
        meshes: parts,
        meshCount: parts.length,
        bounds,
        size,
        head,
        /** Human-readable one-liner used by the HUD capability read-out. */
        summary() {
            const bits = [];
            bits.push(hasSkeleton ? `${bones.length} bones` : "no skeleton");
            bits.push(hasFacialRig ? `${morphTargets.length} morphs` : "no blendshapes");
            bits.push(clips.length ? `${clips.length} clips` : "no clips");
            if (head) bits.push(`head-part pivot (${head.name})`);
            return bits.join(" · ");
        },
    };
}

/**
 * Find the piece of geometry that behaves like a head.
 *
 * The head must be a substantial mesh occupying the top of the silhouette,
 * horizontally near the model's centre axis, with its lower edge above the
 * shoulders (so arms and torso plates are rejected).
 */
function detectHeadPart(parts, bounds, size) {
    if (!parts.length || size.y <= 0) return null;

    const centreX = (bounds.min.x + bounds.max.x) / 2;
    const maxOffset = size.x * 0.35;
    const minTop = bounds.min.y + size.y * 0.86;
    const minBottom = bounds.min.y + size.y * 0.55;

    const candidates = parts.filter((p) => {
        if (p.verts < MIN_HEAD_VERTS) return false;
        if (p.box.max.y < minTop) return false;
        if (p.box.min.y < minBottom) return false;
        if (Math.abs(p.center.x - centreX) > maxOffset) return false;
        return true;
    });

    if (!candidates.length) return null;

    // If several pieces qualify, the head is the tallest of them.
    candidates.sort((a, b) => b.height - a.height);
    const best = candidates[0];

    // Neck pivot: bottom of the head piece, pulled slightly inside the mesh so
    // a few degrees of rotation does not open a visible seam.
    const pivot = new THREE.Vector3(
        best.center.x,
        best.box.min.y + best.height * 0.12,
        best.center.z
    );

    return {
        mesh: best.mesh,
        name: best.name,
        box: best.box,
        pivot,
        confidence: candidates.length === 1 ? "high" : "medium",
        candidateCount: candidates.length,
    };
}

/** Dispose geometries, materials and textures owned by a subtree. */
export function disposeSubtree(root) {
    const textures = new Set();
    root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const mat of mats) {
            for (const key of Object.keys(mat)) {
                const value = mat[key];
                if (value && value.isTexture) textures.add(value);
            }
            mat.dispose();
        }
    });
    for (const tex of textures) tex.dispose();
}
