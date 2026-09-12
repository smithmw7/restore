# Opening discovery: playable checkpoint

Current checkpoint 0.8.0, branch `opening-discovery`. This branch starts from the published warehouse code and preserves the earlier uncommitted ceramic experiments in their original checkout. The public site still follows `warehouse` until this work is merged and deployed. The office uses the Blender asset kit documented in [the office quality pass](OFFICE-QUALITY.md).

## Implemented

- Procedural office and workshop within the existing 96 by 180 by 28 metre archive, with desks, books, shelves, glazing, lockers and warm task lights. Doorway approaches are clear; 153 wooden crates remain in this layout. `?sandbox` retains the original 176-crate layout.
- The complete drawer, notebook, sticky-note combination, four-wheel metal case and photograph chain. Correct code entry works before discovering the clue. Photos can be picked up and turned using hand/controller orientation.
- Two gauntlets, nearby physical pickup and wrist donning, desktop equip assistance and hand-specific powered manipulation. Existing locomotion remains available without them.
- Reusable bolt cutters, a distinct cuttable keeper, opening shipping-container doors and a warm interior light. Held tools use the shared Rapier world, have collision-aware teleport relocation and can be released.
- A procedural 24-component anonymous field mechanism, with canonical assembled poses and physical prerequisite rules. A frame and matching strut are available beside the cradle, with fifteen further pieces on the sorting table. Seven larger frame sections become available when the container opens. Their geometry is procedural and built at initialization; their physical bodies are created on opening. Actual-body alignment, clear socket paths, local inlays, assisted seating, latches and quiet resonance connect the physical fit to feedback. Four persistent stages culminate in a contained field and a repeatable physical levitation experiment. See [First contact](FIRST-CONTACT.md).
- Persistent opening equipment/access, clue knowledge and installed mechanism state. Ordinary reset preserves earned access and assembly, while recovering loose objects. Unreachable essential props have recovery paths.
- Eight normalized local Foley recordings added to the existing shared audio system. The 48 recordings retain bounded voices, mute, fades and positional playback. New mechanism parts use existing pickup, quiet dragging and Heavy Kick drop feedback.

The photograph atlas was generated with the built-in image tool. It shows component details rather than a complete ship. Its [generation record](concepts/restore-opening-photographs-prompt.md) includes the exact prompt; source Foley recordings and measured levels are in [the audio record](opening-audio-normalization.json).

## Deliberately still a prototype

The full saucer, 240-component blueprint, broader records-room content, multiple container puzzles, deliberate removal of installed mechanism parts and a separate new-game interface are not implemented. The first mechanism establishes the assembly system; it is not presented as a finished ship module model. Gauntlets, cutters and the remaining room dressing still use procedural prototype geometry; the desk, chair, lockers, books, writing tools and case have Blender quality passes.

Photographs and sound are authored assets; ordinary room geometry, tool models, mechanism pieces and basic surface variations are procedural. The saved world currently restores exact mechanism installation and opening progress, rather than every loose legacy warehouse artifact.

## Running and checking

Use `npm run dev` on port 5211, or `npm run build` followed by `npm run preview` on port 5212. The USB launcher uses 5212 and checks the edition and version before reusing a server. There was no attached Quest during this implementation pass, so physical VR comfort, hand fit and listening remain unverified.

Run `npm run test:opening` for progression and physics, `npm run test:opening-browser` against the development server for real pointer interactions and reloads, and `npm run test:opening-audio` for real browser decoding and bounded sound playback. `npm run test:asset-paths` builds and serves both `/` and `/restore/` without SPA fallbacks, checking the opening, photo atlas, all audio and material textures.

Native checks include all 24 components taken from their actual packing positions through the real room/container colliders into a complete mechanism, plus interrupted or invalid saves, hand ownership, tool reach, correct solutions before clues, dropped gloves, tracking loss and tool relocation. Browser pointer checks cover the full office/tool chain. These are automated checks, not claims of headset validation or player discovery testing.

The design remains guided exploration. Opening the case is useful without being a software prerequisite for tools. Larger pieces and smaller mechanisms converge through their geometry. The initial play space contains no completed-ship image, global assembly ghost or instructional headline.
