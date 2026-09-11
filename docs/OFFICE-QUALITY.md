# Restore office model kit

The front office now has a reusable set of articulated furniture and loose props, authored in Blender at real-world scale. The visual direction follows `docs/concepts/restore-office-gauntlets-concept-01.png`: walnut furniture, worn oxblood leather, dark green steel lockers, paper and warm aged brass.

The desk is fixed furniture. Drawer, notebook cover and locker doors are independent articulated pieces. Chair, fountain pen, pencil and logbook are independent templates suitable for dynamic physics. The locker has a real hollow interior and shelves; its door has actual cut-through louver openings, folded sheet edges, hinges and latch hardware.

## Source and runtime assets

- `art/office/restore-office-kit.blend`: editable construction parts with shared materials and a studio lighting setup. `art/office/renders/office-kit-overview.png` shows the arranged kit.
- `public/models/office/office-kit.glb`: self-contained browser asset with three embedded texture maps.
- `art/office/textures/office-basecolor-placeholder.png`: original Blender-generated shared atlas.
- `art/office/textures/office-basecolor-final.png`: refined atlas used by the exported model.
- `art/office/textures/office-normal.png` and `office-orm.png`: Blender-generated material microstructure and roughness/metalness maps. ORM red is neutral, while the scene supplies contact shadowing.
- `art/office/asset-report.json`: exact measured vertex bounds, geometry/material budget, source-part counts and exported checksum.
- `art/office/roundtrip-qa.json`: checks performed after importing the actual runtime GLB into a new Blender scene.

The nine templates contain 40,170 triangles in 32 render meshes, with six materials and three embedded 1536 by 1024 maps. The GLB is 7,948,844 bytes. Runtime templates preserve identity translation, rotation and scale; mesh geometry carries its physical dimensions. Clones share mesh and material resources in the browser. The editable Blender file arranges the templates as a readable office vignette after export.

## Model construction

| Template | Construction | Local origin |
| --- | --- | --- |
| Desk | Eased walnut top, shaped underframe, apron joinery, drawer guides, brass ferrules and leather blotter | Floor center; main tabletop top at .96m |
| Drawer | Hollow tray, separate bottom and sides, dovetail endgrain, cast cup pull and slotted fasteners | Front face center; interior extends toward negative Z |
| Notebook | Leather boards, rounded spine, paper signatures, ribbon and separately hinged cover | Bottom center; cover pivot at (-.215,.055,0) |
| LockerShell | Hollow folded-steel cabinet, side returns, shelf lips, coat rail and rivets | Floor center, nominal 1.3m wide by 2.2m tall by .65m deep |
| LockerDoor | Cut-through louvers, folded hems, interleaved hinge barrels, latch, key cylinder and empty label holder | Left-bottom hinge; door extends toward positive X |
| Chair | Raked walnut frame, seat/back cushions, welting, tacks, buttons, stretchers and brass floor glides | Floor is localY=-.59m; backrest toward positive Z |
| Pen | Resin body, turned grip rings, clip, collars and split gold fountain nib | Center; .17m long along X, nib toward positive X |
| Pencil | Hexagonal lacquer shaft, sharpened cedar/graphite tip and ribbed ferrule | Center; .18m long along X |
| Logbook | Leather boards, layered signatures, raised spine bands, gilt tooling and woven bookmark | Center; nominal .30 by .055 by .22m, excluding bookmark |

Notebook cover opening is a positive local Z rotation. A locker door opens with negative local Y rotation. For the standard locker, place the hinge at (-.65,0,.345) relative to the shell. Scale both shell and door along X for narrower lockers. No transform controls, labels or instruction text are part of these models.

## Texture workflow

Blender first generated and exported the placeholder base color, normal and ORM atlas alongside the model. The atlas has three columns and two rows: viewed as an image, the upper row is brass, paper and blackened steel; the lower row is walnut, leather and enamel. UV islands remain inside each region, with grain aligned to each component's longer edge and proportional strips for narrow hardware.

The built-in image-generation tool refined the base color using the concept image as a material reference. A second focused refinement reduced the enamel distress after the first render showed excessively large rust patches. The resulting locker material has mostly intact dark green gray paint, sparse pinprick chips and subtle wear. The approved briefcase textures were not changed.

Texture prompt, initial refinement:

> Refine the exact six-region atlas into aged 1950s office materials while preserving region positions. Upper row: brushed antique brass with scratches and restrained oxidation; fibrous aged ivory paper; scratched charcoal blackened steel. Lower row: rich dark horizontal walnut grain; oxblood brown pebbled leather; faded olive industrial enamel. Flat unlit albedo, no directional light, shadows, bevels, labels, lettering or scene elements. Preserve the three-column by two-row layout and 3:2 aspect.

Texture prompt, final enamel correction:

> Change only the lower-right enamel region to dark muted green gray, roughly #3F4B3D, with 97 percent intact paint, gentle local color variation, very small sparse chips and hairline scratches. Remove large chips, cracks, rust patches, camouflage patterns and chalky regions. Keep the other five regions and all atlas boundaries unchanged. Flat albedo with no lighting or text.

The saved selected result is `art/office/textures/office-basecolor-final.png`. Both generated variants remain in the image tool's original output directory; only the selected final atlas is consumed by the project.

## Blender and browser review

Every distinct template has four actual Blender camera renders, saved as `art/office/renders/<name>-four-angles.png`. The notebook has an additional open-cover sheet. After export, the GLB is imported into an empty Blender scene and checked for finite geometry, matching source vertex bounds, complete UVs, positive transforms, identity template roots, embedded images, clear drawer/locker cavities, and valid hinge motion. A second set of four-angle sheets, `glb-<name>-four-angles.png`, shows the actual exported models.

`office-review.html` provides the same kit in Three.js with per-model selection, four review angles, orbit controls and open/close preview for articulated assemblies. For example, `office-review.html?model=Notebook` opens the notebook template. Runtime interaction and physical-device comfort are separate from Blender asset verification.

Rebuild source/export and render all source views:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/office-build.py -- --final
```

Verify and render the actual runtime GLB in Blender:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/office-roundtrip.py
```

A quick export can add `--skip-renders`. The asset validator and browser gallery checks live in `scripts/office-asset-check.mjs` and the office review browser check. See the generated JSON reports for the current checksum and exact counts.
