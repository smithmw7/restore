# Third-party software

The breaking recordings in `public/audio/breaks/` are derived from the user's local Ultimate SFX Bundle - HD Remaster2, specifically Real Recorded Guns impact folders and Pirate Sounds Pro / Break bottle. These audio assets are separate from the open-source software licenses below. See `docs/audio-normalization.json` for provenance.

The repair recordings in `public/audio/repair/` are derived from the same local bundle: Fighting Sounds Pro / Heavy Kicks, Survival Sound Kit - HD Remake / Dragging Stone, Sci FI Sounds Pro / Armor On, and Ultimate Footstep Sounds. See `docs/repair-audio-normalization.json` for exact source files and measurements.

Restore uses these packages without modifying their source. Their license notices are retained in the installed packages.

- [three-pinata](https://github.com/dgreenheck/three-pinata), Daniel Greenheck, MIT. Powers the actual fracture geometry.
- [Three.js](https://github.com/mrdoob/three.js), Three.js authors, MIT. Rendering, WebXR, and input helpers.
- [Rapier](https://github.com/dimforge/rapier.js), Dimforge, Apache-2.0. Rigid-body physics.
- [Vite](https://github.com/vitejs/vite), Vite contributors, MIT. Development and production bundling.
- [Playwright](https://github.com/microsoft/playwright), Microsoft, Apache-2.0. Local browser verification.

The texture maps in `public/materials/` are copied from the user's local Sanctus Library 3.4.20 bake deliveries in MaterialsSandbox. Source and output hashes, original material names, and known surface-sample limitations are recorded in `docs/warehouse-materials.json`. These owned material assets are separate from the open-source software licenses above. They are included only in this private project repository.
