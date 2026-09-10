# Restore

A private Three.js / WebXR playground for collecting, breaking, and restoring objects. The original bright-room demo is preserved at Git tag **restore-demo-v1** and on `main`. The **warehouse** branch extends it into an enclosed artifact storehouse.

Repository: https://github.com/smithmw7/restore (private).

## Warehouse

A 24 × 34 × 9 metre room with clear central aisles, steel roof trusses, cool clerestory lighting, warm practicals, and a textured concrete floor with real planar reflection. There is no visible text, tutorial copy, score, or magnetic-range sphere. The small headset, reset, and sound icons retain accessible names.

- 24 seeded crates of several sizes, including two stacked pairs. They can be lifted, moved, dropped, and broken into six physical wooden panels.
- Each crate contains one artifact. Its contents remain hidden and cannot be selected through a closed crate. Opening a moved crate reveals the artifact at that crate's current position.
- 24 artifacts across eight forms, including obelisks, ceremonial chalices, vases, and arched stelae, with material variations across the collection. Whole artifacts can be moved, fractured with Three Pinata, and repaired by drawing their matching fragments together. Partial repairs survive drops.
- 152 additional instanced crates build the distant storage stacks. These are static scenery, with collision bounds; the 24 central crates are the interactive collection in this version.
- Eight 512px Sanctus texture sets: wood, concrete, ceramic, bronze, copper, gold, marble and stone. Lossless WebP conversion preserves the baked source pixels. Material provenance and limitations are in `docs/warehouse-materials.json`.

## Controls

The experience itself displays no instructions. These controls are documented here for development and testing.

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
npm run test:locomotion   # Head pivot, teleport, collision, input latches
npm run test:smoke        # Real desktop pointer crate and artifact loop
npm run test:navigation   # Real keyboard, mouse look and floor teleport
npm run test:audio        # Real WebAudio decodes, fades, routing and voice limits
```

Browser tests require installed Google Chrome and a running Restore server. Use `RESTORE_URL=http://127.0.0.1:5208` for gameplay/navigation tests on another owned port. The audio harness uses `RESTORE_TEST_URL`; set `RESTORE_TEST_AUDIO_SOURCE=server` to check built WAV copies.

Desktop and synthetic XR-pose checks establish behavior but do not replace physical Quest controller/hand tests. Planar reflection uses a modest256px target and instancing keeps background draw calls low; physical stereo performance and hand gesture feel must be assessed on the headset.

## References

- [Meta locomotion input mappings](https://developers.meta.com/horizon/design/locomotion-input-maps/)
- [Three.js WebXR basics](https://threejs.org/manual/en/webxr-basics.html)
- [Three Pinata](https://github.com/dgreenheck/three-pinata)
- [Meta browser remote debugging](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)
