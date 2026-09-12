# First contact: priority and playable loop

The next priority after the office quality pass is a satisfying first act of restoration. Previously, every exposed mechanism piece required a frame that was still locked in the container. A player who found a gauntlet first could manipulate props but could not make even one useful connection. More furniture would not resolve that break in the discovery loop.

## Player experience

1. Explore the office and equip either gauntlet. The notebook, 1942 case and cutters remain independent leads.
2. Approach the workshop cradle. The first frame and matching strut sit safely apart on the nearby bench. A faint local response connects the initial piece and reconstruction surface when an equipped player approaches.
3. Pull the frame toward the cradle. Matching inlays and a very quiet glass tone respond to the actual body approaching a clear socket. Seating ends the drag sound. Add the strut for the first small, positive response.
4. Explore for the remaining supports. The container holds seven frames; fifteen other components are on the sorting table. A lower ring, emitter/core assembly and final lens each advance the mechanism's behavior.
5. Place the final lens. A contained four-second awakening settles into a quiet field. The nearby specimen rises on its test stand. It can be pulled away, dropped under normal gravity and brought back into the field repeatedly.

No objective text, complete ship silhouette, full assembly ghost or distant flashing marker is introduced. The object should suggest that something has started working without explaining its eventual role in a craft.

## Physical and presentation contracts

- 24 canonical parts retain their original assembled geometry and dependency graph. The first frame moves out of the container's locked set. Eighteen initial selectable assembly objects comprise seventeen parts plus one test specimen; after opening the container there are twenty-five, before installed parts leave selection.
- Resonance uses real mesh/body separation, not the desired hand target. Guidance is local within 1.2 m and requires a clear path. Assisted seating begins only with both the physical body and hand goal near the socket; the final pose requires close translation, aligned rotation and a clear shape sweep.
- Pulling uses finite force, real mass and the existing collision solver. A dropped specimen outside the field regains gravity. The mechanism supports its own test specimen within 0.75 m of the stand; this is a repeatable experiment, not a global levitation power.
- Stages are derived from installed supports: silent, first contact, lower ring, field core, awake. Saves restore the corresponding quiet state; milestone effects occur on new transitions. Ordinary recovery preserves construction and returns loose pieces home.
- Machined collars, fasteners, coils, keyed panels and etched edges add 16,224 decorative triangles in twenty-four merged detail meshes. Five pooled effect draws and ninety-six motes reuse resources. No texture downloads or shadow maps are added. The existing core light is replaced by a restrained local field light.
- One quiet continuous sound follows valid alignment. Four cached synthesized cues share the existing Web Audio context, mute control and twelve-voice limit. The forty-eight recorded assets remain unchanged. Release, seating, tracking loss and navigation stop alignment feedback; the final milestone replaces the former generic completion cue.

## Validation and next priority

`npm run test:field` covers physical prerequisites, actual body versus hand goal, blocked paths, cancellation, saved stages, levitation, presentation resources and audio lifecycle. `npm run test:opening` includes all twenty-four pieces traveling from their real packing positions through the room. `npm run test:field-browser` performs a fresh glove-first connection using pointer input with the container closed, followed by signal/drop/reload checks. A separate, explicitly seeded twenty-three-part state checks the real last-lens gesture and specimen handling; that fixture is not evidence of a full unaided player playthrough.

The next gate is an unprompted Quest playtest: whether the player notices the matching pair, understands fit from the gauntlet response, feels comfortable seating it, and discovers the specimen behavior. Evaluate stereo readability, reach, frame time and sound on the headset before expanding to another mechanism or the larger saucer blueprint. Desktop automation cannot establish those results.
