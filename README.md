# Restore

A private Three.js / WebXR playground for collecting, breaking, and restoring objects. The original bright-room demo is preserved at Git tag **restore-demo-v1** and on `main`. The **warehouse** branch extends it into an enclosed artifact storehouse.

Repository: https://github.com/smithmw7/restore (private).

## Warehouse

A 96 × 180 × 28 metre enclosed archive with towering steel trusses, long storage aisles, cool clerestory light and warm pendants over the working collection. Fifteen volumetric light shafts, eight shallow mist banks and 900 drifting dust motes add depth. The rough concrete floor retains its normal map and real planar reflection. There is no visible text, tutorial copy, score, or magnetic-range sphere. The small headset, reset, and sound icons retain accessible names.

- All 176 wooden crates can be lifted, moved, dropped, and broken into six physical panels, including every side, back, and upper tier of the original collection. Removing a supporting box lets its stack fall.
- Another 1,103 sealed metal cases form 244 fixed stacks around and beyond the collection. These are unbreakable, stationary storage, rendered in three instanced batches with one collision shape per stack. The new storage leaves a central aisle and cross aisles; metal stacks and structural columns block movement and teleport destinations.
- Each crate contains one artifact. Its contents remain hidden and cannot be selected through a closed crate. Opening a moved crate reveals the artifact at that crate's current position.
- 176 artifacts across 15 forms. Eight alien designs include a thruster bell, reactor spindle, crescent hull section, gyroscopic coupler, sensor fin, navigation prism, flux key, and fossil sigil. Seven relic designs include amphorae, obelisks, a chalice, a stela, a fluted urn, and meteor shards. Larger shipping crates contain larger variants. Alien components use subtle luminous circuit inlays over the textured surfaces.
- Whole artifacts can be moved, fractured with Three Pinata, and repaired by drawing their matching fragments together. Partial repairs survive drops. Material variation keeps the recorded impact and repair sounds appropriate to each object.
- Closed wooden crates use one instanced render batch; loose boards use three more. Every wooden box has its own physics and selection proxy, and navigation follows the remaining boxes instead of permanent stack barriers. Repeated artifact forms reuse fracture templates at startup while keeping their repair state independent.
- Eight 512px Sanctus texture sets: wood, concrete, ceramic, bronze, copper, gold, marble and stone. Lossless WebP conversion preserves the baked source pixels. Material provenance and limitations are in `docs/warehouse-materials.json`.

## Controls

The experience itself displays no instructions. These controls are documented here for development and testing.

Distant held objects gradually reel toward you after a short pause, speeding up gently and easing to a stop with room for the object's size. Manual depth adjustments restart the gentle ramp. Objects picked up by direct hand contact continue to follow your hand.

**Quest controllers**

- Tap trigger to break a crate or artifact.
- Hold trigger to grab. Grip grabs immediately. Release the same button to drop.
- While holding with grip, tap trigger to break the held object.
- Broken fragments and wooden panels grab immediately when selected.
- While holding, move the thumbstick forward/back to adjust reach.
- With a free controller, push its thumbstick forward to aim the teleport arc; release to neutral to teleport. Click the stick or pull it back to cancel.
- Flick a free thumbstick left/right for a 30° snap turn. Return it to neutral for another turn.

**Hands**

- Short pinch to break; held pinch to grab. Move your pinched hand toward your body to bring a distant object closer, or extend it to push it away.
- Pinch empty floor to aim a teleport; release to travel to the valid ring.
- Turn your left palm upward to reveal two small turn chevrons. Select one with your other hand to snap turn.
- Deliberate fingertip taps also break objects; gentle contact does not instantly break them while preparing a pinch.

Movement releases held objects before relocating the player. Teleport destinations reserve standing clearance and respect walls and crate piles. Turning preserves the actual tracked head position. Movement input is suppressed while the system menu obscures the experience.

**Desktop**

- Click to break; hold and drag to pick up. Scroll while holding to change depth.
- Drag empty space or drag with the right mouse button to look.
- WASD or up/down arrows move; Q/E or left/right arrows snap turn.
- Shift-click empty floor to teleport.
- R or the circular reset icon restores the warehouse. F toggles fullscreen.

## Run locally or on Quest over USB

Requirements: Node.js 20.19+ or 22.12+, Android SDK Platform Tools, and a Quest with Developer Mode enabled and USB debugging authorized.

```sh
npm install
npm run dev
```

For the connected headset:

```sh
npm run quest
```

The launcher builds the project, serves it on **127.0.0.1:5209**, forwards that port over USB, and opens Quest Browser. Choose the **headset icon** to enter VR and accept any system permission prompt. Keep the server and USB connection open. No APK or store submission is required.

Use `npm run quest -- --no-build` to reopen the current build. The launcher verifies server identity before reusing port5209. Numeric loopback is intentional: this headset's launcher rejected `http://localhost:5209`.

For a separate development preview, first confirm the port is free:

```sh
npx vite --host 127.0.0.1 --port 5208 --strictPort
```

## Audio and materials

The 30 predecoded sounds include material breaking recordings, Armor On pickups, Heavy Kick drops, quiet stone-dragging loops, and material-specific footstep contacts/snaps. Idle holds are silent; the loop fades on release and stops within15ms when reconstruction completes. Voices and repeated contact events are capped.

All source recordings remain unchanged. `scripts/prepare-audio.py` and `scripts/prepare-repair-audio.py` reproduce the normalized WAVs. Per-asset measurements and hashes are in `docs/audio-normalization.json` and `docs/repair-audio-normalization.json`.

Sanctus procedural node graphs are represented by locally baked base-color, packed ORM, and tangent normal maps. Normal maps change shading, not geometry. These are reusable surface samples; exact seamless tiling and Blender beauty-render parity are not claimed. Mirrored repetition reduces obvious border discontinuities.

## Verification

```sh
npm run build
npm run test:repair       # Original magnetic repair API regression
npm run test:warehouse    # Crate / artifact / physics integration
npm run test:storage      # All 176 crates, stack collapse, live obstacles and reset
npm run test:artifacts    # Artifact manifold geometry and scaled fracture volume
npm run test:fracture-cache # Shared cut templates, independent state and finish
npm run test:locomotion   # Head pivot, teleport, collision, input latches
npm run test:hold-pull    # Gradual pull, frame-rate consistency, comfort and manual override
npm run test:smoke        # Real desktop pointer crate and artifact loop
npm run test:storage-browser # Side/upper storage selection and alien contents
npm run test:navigation   # Real keyboard, mouse look and floor teleport
npm run test:archive      # New hall clearance, metal collision and resource disposal
npm run test:archive-browser # Real deep-hall navigation, metal exclusion and visual captures
npm run test:audio        # Real WebAudio decodes, fades, routing and voice limits
```

Browser tests require installed Google Chrome and a running Restore server. Use `RESTORE_URL=http://127.0.0.1:5208` for gameplay/navigation tests on another owned port. The audio harness uses `RESTORE_TEST_URL`; set `RESTORE_TEST_AUDIO_SOURCE=server` to check built WAV copies.

Desktop and synthetic XR-pose checks establish behavior but do not replace physical Quest controller/hand tests. Planar reflection uses a modest 256px target and instancing keeps storage draw calls low. The atmosphere integrates short rays inside bounded world-space volumes, with per-eye camera positions, depth testing and distance fading. It adds no scene render or depth prepass; beams do not simulate volumetric shadow scattering. Three nearby spotlights and one bounded shadow map keep the lighting cost controlled. Opening and fracturing many artifacts still increases physics and rendering work; physical stereo performance and hand gesture feel must be assessed on the headset.

## References

- [Meta locomotion input mappings](https://developers.meta.com/horizon/design/locomotion-input-maps/)
- [Three.js WebXR basics](https://threejs.org/manual/en/webxr-basics.html)
- [Three Pinata](https://github.com/dgreenheck/three-pinata)
- [Meta browser remote debugging](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)
