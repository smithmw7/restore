# Restore

## Interactive case study (0.6.3)

The office case now has a clean handle-free silhouette and four real combination drums. Each drum carries ten evenly spaced, black inlaid 3D numerals with a separator groove between digits. The numerals turn with the metal wheel, including a smooth 9-to-0 transition. Aged PBR surfaces, hollow shells, lining, hinges, twin clasps and the photograph puzzle remain. See the [quality pass, source model and render sheets](docs/BRIEFCASE-QUALITY.md). Open `/briefcase-review.html` to drag the actual wheels and release them into their nearest numbered detent. In this review, **1942** releases the clasps; tap either moving latch or Open case to lift the lid. Reset lock returns to 0000. Drag the body to orbit, and use Explode assemblies to inspect construction. Mouse and touch share the same input path, with quiet detent and latch sounds.

A Three.js / WebXR playground for collecting, breaking, and restoring objects. The original bright-room demo is preserved at Git tag **restore-demo-v1** and on `main`. The default **warehouse** branch extends it into an enclosed artifact storehouse.

## Opening discovery prototype 0.6.0

The `opening-discovery` branch adds the first playable office and workshop. Start in the office, explore the desk and lockers, and follow any of the three leads: a notebook and locked photograph case, wearable lifting gauntlets, or workshop bolt cutters and a large shipping container. The case contains three grainy component photographs. The handwritten note and physical lock numerals are the only required puzzle text.

The gauntlets enable the existing warehouse pull, break and repair interactions. Sixteen small procedural mechanism parts sit on the workshop sorting table; eight larger frame sections are prepared when the shipping-container doors open. Bring compatible parts to the neutral work cradle to build a 24-part field mechanism. Physical supports determine the construction order, including placing the core before closing its upper lens. Local light and latch sounds acknowledge successful seating. This prototype does not reveal or implement the full 240-part saucer.

Opening access, equipment, clue discoveries and mechanism installation save locally in the browser. The ordinary restore button recovers loose props and resets the sandbox collection while keeping earned opening/assembly progress. `?sandbox` starts the earlier warehouse interaction layout with all 176 crates and unrestricted powers. A separate new-game UI and deliberate disassembly of installed mechanism parts remain later work.

Run this branch with `npm install` and `npm run dev`, then open `http://127.0.0.1:5211/`. For a stable build, use `npm run build` and `npm run preview` at `http://127.0.0.1:5212/`. `npm run quest` serves that same production port over USB and verifies the matching edition/version before reusing a server. The public play link below continues to follow the `warehouse` branch until this branch is merged and deployed.

On desktop, use WASD and right-drag to look, Q/E to turn, and Shift-click clear floor to teleport. Tap reachable puzzle handles or wheels; hold and drag loose objects. Tapping a glove equips it for desktop testing. Tapping the cutters carries them; a short right-click drops them. In VR, bring a glove to its matching wrist and release, or bring the matching wrist into the cuff and select. Controller grip grabs tools; release drops them. A grip press/release also drops tap-equipped cutters. Existing teleport and snap-turn controls are available before equipment is found.

Checks: `npm run test:opening`, `npm run test:opening-browser` (development server on 5211), `npm run test:opening-audio`, and `npm run test:asset-paths`. Native tests cover progression, shared ownership, physics and completion; browser tests exercise the actual clue/tool pointer chain and persistence. Physical Quest reach, stereo comfort, frame time and sound balance require a headset session.

The [opening photograph atlas](public/textures/opening/archive-photos.png) was generated with the built-in image tool; its [exact prompt](docs/concepts/restore-opening-photographs-prompt.md) is saved. Eight new normalized Foley recordings bring the shared audio preload to 48 clips; sources and measured levels are in [the normalization record](docs/opening-audio-normalization.json).

**[Play Restore](https://smithmw7.github.io/restore/)** · [Public repository](https://github.com/smithmw7/restore)

Open the play link in Quest Browser, wait for the warehouse to load, then select the headset icon and accept the system permission prompt to enter VR. No USB connection, local server, APK or store submission is needed. The same link supports the desktop controls below.

## Publishing

GitHub Pages deploys the `warehouse` branch through `.github/workflows/pages.yml` on each push. The workflow installs the locked dependencies, checks interaction behavior, builds the site, then deploys it over HTTPS. It can also be run manually from the repository's Actions tab.

`npm run build:pages` builds for the `/restore/` site path into `dist-pages/`; ordinary `npm run build` still builds the local USB version into `dist/`. Audio, material, icon and manifest URLs support both locations. To check the Pages build locally:

```sh
npm run build:pages
npx vite preview --host 127.0.0.1 --port 5208 --strictPort --base=/restore/ --outDir=dist-pages
```

Open `http://127.0.0.1:5208/restore/` after confirming port 5208 is free.

## Warehouse

A 96 × 180 × 28 metre enclosed archive with towering steel trusses, long storage aisles, muted clerestory light and warm pendants over the working collection. Lower overall lighting, subtle bloom and warm grading give the room a subdued finish. Fifteen volumetric light shafts, twelve shallow mist banks concentrated in darker storage bays, and 900 drifting dust motes add depth. Dry, mottled concrete uses stronger grain normals, high roughness and a faint, broadly blurred planar reflection. Short-range screen-space ambient occlusion deepens contact under and between nearby items. Global fill is restrained so focused pendant pools and atmospheric beams carry the lighting. There is no tutorial copy, score, or magnetic-range sphere. The opening has a handwritten combination clue and physical lock numerals. The small headset, reset, and sound icons retain accessible names.

- All 176 wooden crates can be lifted, moved, dropped, and broken into six physical panels, including every side, back, and upper tier of the original collection. Removing a supporting box lets its stack fall.
- All 36 pendant fixtures are attached to fixed ceiling anchors. They remain still until tapped or pulled, swing within their wire length, and gradually return to complete rest after release. Nearby real lights and their volumetric beams follow the moving fixtures; the first pendant owns the single 1024px shadow map so its shadows follow its pool. All fixtures share four render batches. Dust becomes more visible inside the actual beam volumes, while low mist stays subdued to preserve dark contacts.
- Another 1,103 sealed metal cases form 244 fixed stacks around and beyond the collection. These are unbreakable, stationary storage, rendered in three instanced batches with one collision shape per stack. The new storage leaves a central aisle and cross aisles; metal stacks and structural columns block movement and teleport destinations.
- Each crate contains one artifact. Its contents remain hidden and cannot be selected through a closed crate. Opening a moved crate reveals the artifact at that crate's current position.
- 176 artifacts across 15 forms. Eight alien designs include a thruster bell, reactor spindle, crescent hull section, gyroscopic coupler, sensor fin, navigation prism, flux key, and fossil sigil. Seven relic designs include amphorae, obelisks, a chalice, a stela, a fluted urn, and meteor shards. Every artifact is uniformly scaled from its measured geometry bounds to occupy 90% of the limiting interior crate dimension, with clearance from the boards. Larger crates contain larger artifacts, and all three dimensions constrain the fit. Alien components use subtle luminous circuit inlays over the textured surfaces.
- Whole artifacts can be moved, fractured with Three Pinata, and repaired by drawing their matching fragments together. Partial repairs survive drops. Adding the final piece triggers a 1.25-second gold surface sweep and soft jade edge glow, then returns to the original material. Only the repaired artifact glows, with no additional mesh or rendering pass. Material variation keeps the recorded impact and repair sounds appropriate to each object.
- Crates, loose boards and artifacts interpolate between physics updates for smooth motion at headset refresh rates. A small contact margin on sharp artifact hulls reduces floor chatter so fragments can sleep naturally. Resting objects wake on impact or when their support is removed; elapsed time never freezes a normally moving fragment.
- Closed wooden crates use one instanced render batch; loose boards use three more. Each sealed wooden box has one solid collision shape with its original wood mass, plus its selection proxy, and navigation follows the remaining boxes instead of permanent stack barriers. All 176 artifact sizes reuse 15 cuts of the original forms; fragment vertices, offsets and mass scale together while repair state stays independent. Large repairs held near the floor ease upward enough to leave room for their remaining pieces, with their collision shapes still active.
- Eight 512px Sanctus texture sets: wood, concrete, ceramic, bronze, copper, gold, marble and stone. Lossless WebP conversion preserves the baked source pixels. Material provenance and limitations are in `docs/warehouse-materials.json`.

## Controls

The experience itself displays no instructions. These controls are documented here for development and testing.

Taps break exposed crates and whole artifacts within **8 feet (2.44m)** of your head, measured to the surface you touch. Farther taps give a physical nudge instead, with inverse-square force falloff: twice the distance means one quarter of the influence. Small upward rocking makes floor contact readable, and material contact sounds and controller feedback become quieter/weaker with range. Far taps never accumulate fracture damage; sealed metal scenery remains fixed.

Distant held objects gradually reel toward you after a short pause, speeding up gently and easing to a stop with room for the object's size. Manual depth adjustments restart the gentle ramp. Objects picked up by direct hand contact continue to follow your hand.

Dragged crates, boards, artifacts and repair pieces remain solid physical objects. They stop against floors and obstacles, slide along surfaces, and gently push movable props according to their mass. A blocked hand target cannot build an artificial throw on release. Raised wooden braces have collision coverage too. A returning artifact only docks when its path and home are clear; an obstructed return drops naturally.

Hanging lights use the same grab controls at any visible distance. The eight-foot break threshold and tap falloff do not weaken a sustained lamp pull. VR hand and thumbstick depth adjustments preserve a distant lamp's actual reach, and aiming at its glowing underside selects the fixture. Holding pulls it toward you as far as its fixed wire allows; release lets it swing and settle. Tapping always gives a distance-sensitive push, even nearby. A lamp cannot break or detach, and releasing one does not play a heavy drop sound.

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

The 48 predecoded sounds include timber breaks, quiet wood strain, wood scraping against concrete or other wood, and metal creaks for pulled lamps. Armor On pickups, Heavy Kick drops, artifact stone-dragging loops, and material-specific footstep contacts/snaps remain. Wooden scraping follows the actual contact surface and relative tangential velocity, including rotation; airborne and stationary wood is silent. Low hand targets can press crates and boards against the solid floor for dragging. Wood strain only triggers on constrained contact with cooldown and hysteresis.

Textures are normalized to -35 LUFS and fade with motion; wood/stone loops stay at or below .12 gain, and distant hanging lights use a .22 cap. Surface changes crossfade after 120 ms of stable contact. At most two loop sources and twelve one-shot voices can coexist. Release fades loops out; reset, mute and complete reconstruction stop them within 15 ms. New timber breaks are matched to -22.39 LUFS and load creaks to -28 LUFS.

A completed artifact plays a separate 1.16-second ascending major bell reveal at its position. The synthesized phrase is peak-normalized, cached and counted as one voice, with room for the final fragment snap. It plays only on complete reconstruction; pickup and docking keep their own sounds. Mute and reset cancel the whole phrase.

All source recordings remain unchanged. `scripts/prepare-audio.py`, `scripts/prepare-repair-audio.py` and `scripts/prepare-action-audio.py` reproduce the normalized WAVs. Measurements and hashes are in `docs/audio-normalization.json`, `docs/repair-audio-normalization.json` and `docs/action-audio-normalization.json`. The new contact textures are designed Foley blends; their game-action names do not claim the original recording surfaces. In particular, lamp strain blends a generic door creak with a faint metal texture. Physical headset listening remains a separate check.

Sanctus procedural node graphs are represented by locally baked base-color, packed ORM, and tangent normal maps. Normal maps change shading, not geometry. These are reusable surface samples; exact seamless tiling and Blender beauty-render parity are not claimed. Mirrored repetition reduces obvious border discontinuities.

## Verification

```sh
npm run build
npm run test:asset-paths  # Production builds at / and /restore/, including every sound and texture
npm run test:repair       # Original magnetic repair API regression
npm run test:completion   # Final-piece onset, isolation, fade and repeat repairs
npm run test:completion-browser # Three artifact forms, actual shader and bloom rendering
npm run test:completion-audio # Reveal waveform, spatial placement, cancellation and voice limits
npm run test:warehouse    # Crate / artifact / physics integration
npm run test:artifact-fit # All 176 crate fits, scaled fracture volume and floor-level repair
npm run test:contact-audio # Physical surfaces, relative rubbing and airborne silence
npm run test:action-audio # New normalized recordings, texture routing, fades and voice limits
npm run test:contact-audio-browser # Real pointer floor/wood scraping, lamp creak and timber break
npm run test:lights       # Fixed wires, pulling, settling and frame-rate consistency
npm run test:scene-interactions # Shared prop/lamp ownership, tap routing and reset
npm run test:lights-browser # Real pointer taps, pulls, release, audio and rest
npm run test:postprocessing # Synthetic stereo bloom, depth, reflection and fallback
npm run test:ambient-occlusion # Contact shading, lifted objects, edges and stereo isolation
npm run test:storage      # All 176 crates, stack collapse, live obstacles and reset
npm run test:drag-collision # Solid grabs, sliding, mass-sensitive pushes and safe release
npm run test:artifact-collision # Solid whole and joined artifacts, magnetic barriers
npm run test:docking      # Physical return, occupied home and blocked path
npm run test:drag-collision-browser # Real pointer floor and crate contact
npm run test:settling     # Disturbed piles, natural rest and smooth display updates
npm run test:tap          # Reach boundary, distance falloff, native nudges and retained grabs
npm run test:tap-browser  # Real pointer distant nudges, approach/break and remote grabbing
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

Browser tests require installed Google Chrome. The asset-path check starts isolated temporary servers itself; the other browser tests require a running Restore server. Use `RESTORE_URL=http://127.0.0.1:5208` for gameplay/navigation tests on another owned port. The postprocessing and ambient-occlusion harnesses require a Vite development server on that URL because they import source modules. The completion shader harness also requires a development server, using `RESTORE_DEV_URL` (default `http://127.0.0.1:5208`). The audio harness uses `RESTORE_TEST_URL`; set `RESTORE_TEST_AUDIO_SOURCE=server` to check built WAV copies.

Desktop and synthetic XR-pose checks establish behavior but do not replace physical Quest controller/hand tests. Planar reflection uses a modest 256px target and instancing keeps storage draw calls low. The atmosphere integrates short rays inside bounded world-space volumes, with per-eye camera positions, depth testing and distance fading. The atmosphere itself adds no scene render or depth prepass; beams do not simulate volumetric shadow scattering. Three nearby spotlights and one bounded shadow map on the nearest pendant keep the lighting cost controlled.

Postprocessing renders each XR eye separately into a reusable HDR target, extracts and blurs highlights at quarter resolution, then composites restrained bloom and warm grading while preserving scene depth. It uses four fullscreen passes per eye, with a byte-buffer fallback when floating-point color targets are unavailable. Short-range contact occlusion reuses the scene depth in the final composition, with eight fixed samples and four normal-reconstruction samples per nearby pixel. It fades with distance, rejects distant depth layers and leaves added bloom untouched. It adds no target or pass. This prevents bloom crossing between eyes but adds GPU work; offscreen scene targets do not inherit the XR layer's fixed foveation. Opening and fracturing many artifacts also increases physics and rendering work; physical stereo performance and hand gesture feel must be assessed on the headset.

## References

- [Meta locomotion input mappings](https://developers.meta.com/horizon/design/locomotion-input-maps/)
- [Three.js WebXR basics](https://threejs.org/manual/en/webxr-basics.html)
- [Three Pinata](https://github.com/dgreenheck/three-pinata)
- [Meta browser remote debugging](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)
