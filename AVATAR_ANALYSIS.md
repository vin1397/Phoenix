# Avatar Analysis — `cyber_samurai.glb`

**Asset:** `frontend/assets/3dModel/cyber_samurai.glb`
**Size:** 22,953,836 bytes
**Source:** Sketchfab, "Cyber Samurai" by KhoaMinh — CC-BY-4.0
**Method:** direct GLB binary parse (JSON chunk), not visual assumption.

---

## 1. Structural facts (measured)

| Check | Result |
|---|---|
| glTF version | 2.0, generator `Sketchfab-12.67.0` |
| Nodes | 21 — 1 scene root, 1 container, **19 mesh nodes** |
| Meshes | 19 (one primitive each) |
| **Skins** | **0** |
| **Bones** | **0** |
| **Animations** | **0** |
| **Morph targets** | **0** |
| Materials | 5: `LowSet1`, `LowSet2`, `LowSet3`, `Robe`, `Robe2` |
| Textures | 18 PNG |
| Vertex attributes | `POSITION`, `NORMAL`, `TANGENT`, `TEXCOORD_0` — **no `JOINTS_0` / `WEIGHTS_0`** |
| Extensions | `KHR_materials_transmission` |
| Total vertices | ≈ 152,000 |
| Bounds | X −0.55…0.70 (1.25) · Y −0.43…0.72 (1.15) · **Z −0.24…2.18 (2.43)** |
| Up axis | **Z-up authored** (2.43 tall on Z, 1.15 on Y) |

### Conclusion

The model is a **static, material-merged statue**. It is not rigged, it has no skeleton, no skin weights, no animation clips and no blendshapes. It cannot be animated by `AnimationMixer` clips today, and no amount of frontend code changes that.

---

## 2. Required answers

| Question | Answer |
|---|---|
| Is it rigged? | **No.** Zero skins, zero bones, no joint/weight attributes. |
| Humanoid skeleton? | No skeleton of any kind. |
| Correctly named bones? | N/A — none exist. |
| Facial bones? | None. |
| Facial blendshapes? | None. |
| Existing animation clips? | None. |
| Hands / fingers animatable? | No — arms and hands are fused into shared meshes, not separate nodes. |
| Supports inverse kinematics? | No — IK needs a joint chain. |

---

## 3. What the 19 meshes are

Bounds are in the file's Z-up space (Z = height, Y = depth).

| Node | Mesh | Verts | Material | Extent | Likely role |
|---|---|---|---|---|---|
| 2 | 0 | 22,852 | Robe2 | z −0.17…0.34 | lower robe / cloth |
| 3 | 1 | 26,319 | Robe | z 0.93…1.71 | upper robe |
| 5 | 3 | 13,092 | LowSet1 | z 0.91…1.82 | torso armour |
| 9–12 | 7–10 | 4 × 6,042 | LowSet2 | z ~1.05…1.44, y −0.35…0.06 | layered chest plates |
| 13–16 | 11–14 | 8,000–9,300 | LowSet2 | z −0.24…1.63 | legs / skirt plates |
| **17** | **15** | **8,091** | LowSet3 | **z 1.66…2.18**, x −0.30…0.21 | **head / helmet (topmost, centred)** |
| 18 | 16 | 4,308 | LowSet3 | z 1.44…1.80, x −0.11…0.41 | shoulder / neck collar |
| 19, 20 | 17, 18 | 8,000–9,900 | LowSet3 | x 0.11…0.35, y −0.43…0.72 | sword / sheath at the right side |
| 4 | 2 | 4 | LowSet3 | — | stray 4-vertex quad |

**Only node 17 is separately addressable in a way that supports articulation** (it is a cohesive, roughly centred mass occupying the top 22 % of the silhouette). Everything else is body or prop geometry whose boundaries cross anatomical joints, so rotating any of them alone would visibly tear the model.

---

## 4. Capability matrix — what can be built on this asset

| Requirement | Supported | Notes |
|---|---|---|
| Idle breathing | ✅ | bounded root lift + slow sway |
| Weight shift / posture adjustment | ✅ | small yaw + pitch |
| Head rotation (cursor, attention) | ✅ | rigid node-17 pivot, ±11° safe budget |
| Turn body toward user | ✅ | root yaw |
| Listening tilt | ✅ | head roll + slight lean |
| Thinking turn / look away | ✅ | head yaw + pitch |
| Emotion posture (all 10 states) | ⚠️ attitude only | no face, so emotion reads through posture, lighting and UI |
| Blinking | ❌ | no eye geometry, no morphs |
| Eye tracking (independent of head) | ❌ | same |
| Jaw / mouth / lip-sync | ❌ | no jaw bone, no visemes, no blendshapes |
| Wave / point / shrug / cross arms | ❌ | no arm bones; arms are part of the torso mesh |
| Finger articulation | ❌ | none |
| Celebrate / bow with limbs | ❌ | bow can only be a whole-body lean |
| Clip-based state machine | ❌ | no clips to blend |

### Safe articulation budget for node 17

The head piece sits above a collar (node 18) but they are not parented, so rotation opens a seam. Keep head yaw ≤ 11°, pitch ≤ 8°, roll ≤ 9°, with smoothing — enough to read as "looking at you", not enough to expose the join.

---

## 5. What rigging work would be required for the full specification

To satisfy arms, hands, blinking and phoneme lip-sync, the asset must be re-rigged. This is Blender work, not JavaScript work:

1. **Import** the GLB, apply the Z-up → Y-up conversion, join the 19 parts into one skinned mesh (or keep parts but parent all to the armature).
2. **Armature** — minimum humanoid chain:
   `root → hips → spine → chest → neck → head`, `clavicle/shoulder → upper_arm → forearm → hand` (×2, with optional finger chains), `thigh → shin → foot` (×2).
3. **Skin weights** — automatic weights, then manual correction at the shoulders, hips and robe hem (the robe is a single 26 k-vert mesh that must not collapse when the spine bends).
4. **Face** — add eye meshes (or a visor strip) and a jaw bone; for phoneme lip-sync, add blendshapes (`jawOpen`, `mouthSmile`, `eyeBlinkL`, `eyeBlinkR`, plus viseme shapes) — glTF supports these via morph targets.
5. **Idle/listen/think pose clips** — short, additive-friendly clips so `AnimationMixer` can cross-fade instead of scripting every channel.
6. **Export** GLB with skins + animations, verify `skins` > 0 and `animations` > 0 in the binary, then the existing `AnimationManager` design can host a real `AnimationStateMachine`.

Until then, Phoenix must ship with the rigid-part design and say so in the UI: *"Rig: static mesh — head articulation only. Lip-sync and gestures unavailable."*

---

## 6. Rendering notes

- **Z-up authored geometry**: the loader must detect a bounding box taller on Z than Y and apply a −90° X rotation, then re-measure, normalize to ~1.85 units tall and drop the feet to y = 0. Hard-coded camera positions in the current `index.html` (`camera.position.set(0, 1.6, 3.8)`) were guessed and do not derive from the model.
- **22.9 MB** with 18 PNG textures: needs load progress and an error path, and the loading overlay must clear on failure.
- `KHR_materials_transmission` is expensive for no visual benefit at this camera distance; clamping `transmission` to 0 is a safe CPU/GPU win.
- No Draco / meshopt compression is present; the download cannot be reduced without re-exporting the asset.
