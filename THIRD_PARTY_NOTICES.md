# Third-party software

The breaking recordings in `public/audio/breaks/` are derived from the user's local Ultimate SFX Bundle - HD Remaster2, specifically Real Recorded Guns impact folders and Pirate Sounds Pro / Break bottle. These audio assets are separate from the open-source software licenses below. See `docs/audio-normalization.json` for provenance.

The repair recordings in `public/audio/repair/` are derived from the same local bundle: Fighting Sounds Pro / Heavy Kicks, Survival Sound Kit - HD Remake / Dragging Stone, Sci FI Sounds Pro / Armor On, and Ultimate Footstep Sounds. See `docs/repair-audio-normalization.json` for exact source files and measurements.

The contextual action recordings in `public/audio/actions/` are also derived from this user-owned bundle, including Survival Sound Kit / Wood Break, Dragging Stone, Sawing Wood, Door Creak and Sawing Metal, and Pirate Sounds Pro / Chest moving and Rudder Movement. Their game-action names describe designed Foley: wood-on-concrete and wood-on-wood sliding are blends, while lamp strain combines a generic door creak with a faint metal texture. The source filenames do not establish the original contact surfaces or door material. `docs/action-audio-normalization.json` records every layer, source/output hash, excerpt, blend, filter, loudness and loop seam measurement; `scripts/prepare-action-audio.py` reproduces the assets without changing the originals. These game assets remain separate from the software licenses below; public source availability does not grant a standalone asset license.

The opening recordings in `public/audio/opening/` derive from this same bundle's Survival Sound Kit and Ui & Item Sounds: drawer, book page, click, metal trap mechanism, locker, metal tools and door creak recordings. A trap mechanism stands in for the case latch and fastener cut; the hinge recording does not identify a shipping container. These are designed Foley uses, not claims about the recorded objects. `docs/opening-audio-normalization.json` identifies excerpts, processing, original/output hashes and measured loudness; `scripts/prepare-opening-audio.py` reproduces the clips without modifying originals. The existing Armor On and metal contact recordings cover equipment and alignment. Public availability of the source project does not grant a standalone license to these sound assets.

Restore uses these packages without modifying their source. Their license notices are retained in the installed packages.

- [three-pinata](https://github.com/dgreenheck/three-pinata), Daniel Greenheck, MIT. Powers the actual fracture geometry.
- [Three.js](https://github.com/mrdoob/three.js), Three.js authors, MIT. Rendering, WebXR, and input helpers.
- [Rapier](https://github.com/dimforge/rapier.js), Dimforge, Apache-2.0. Rigid-body physics.
- [Vite](https://github.com/vitejs/vite), Vite contributors, MIT. Development and production bundling.
- [Playwright](https://github.com/microsoft/playwright), Microsoft, Apache-2.0. Local browser verification.

The texture maps in `public/materials/` are copied from the user's local Sanctus Library 3.4.20 bake deliveries in MaterialsSandbox. Source and output hashes, original material names, and known surface-sample limitations are recorded in `docs/warehouse-materials.json`. These owned material assets are separate from the open-source software licenses above. Public source availability does not grant a standalone asset license.
