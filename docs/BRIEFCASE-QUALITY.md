# Briefcase quality pass

Restore 0.6.1 replaces the opening office case with an articulated Blender asset. The existing four-wheel puzzle and photograph chain remain intact.

## Asset and review files

- Editable source: [restore-retro-briefcase.blend](../art/briefcase/restore-retro-briefcase.blend).
- Shipped self-contained model: [briefcase.glb](../public/models/briefcase/briefcase.glb).
- [Four angles](../art/briefcase/renders/briefcase-four-angles.png), [open interior](../art/briefcase/renders/briefcase-open.png) and [exploded construction](../art/briefcase/renders/briefcase-exploded.png).
- Component sheets in `art/briefcase/renders/`: base shell, lid/liner, hinge, clasp, handle and combination lock. Each sheet contains four actual Blender renders of that assembly.
- [Interactive inspection page](../briefcase-review.html): run the app and open `/briefcase-review.html` for orbit, close-up, open-lid and exploded-assembly inspection. The browser explosion separates runtime articulation groups; Blender's exploded render separates additional construction pieces.

The case has hollow drawn-metal shells, rounded folded rims, formed corner guards, separate rear hinge barrels/leaves, two moving clasp tongues, knurled lock wheels, a stitched leather handle, tabletop feet, slotted fasteners, cloth lining and a leather document organizer. The interactive display numerals stay large enough for the existing VR puzzle target spacing. The source preserves individual construction components; the runtime export merges static surfaces to reduce draw submissions.

## Materials

Blender first writes a placeholder four-quadrant base-color atlas and procedural surface maps. The built-in image-generation tool refines that atlas into worn olive enamel, brushed aged metal, oxblood leather and charcoal-olive cloth. The [exact refinement prompt and generation record](concepts/briefcase-texture-prompt.md) are saved.

The final albedo remains at the tool's native 1254-square resolution. Normal and packed roughness/metallic maps use 1024-square delivery images, with 2048-square editable sources retained. The model embeds all delivery textures, including a default lock numeral, so it loads without external texture URLs. The normal data is tangent-space OpenGL style and surface data is non-color; albedo is sRGB. The atlas's red occlusion channel is neutral. Contact shadows come from geometry and scene lighting, not a claim of baked cavity occlusion.

Planar UV projection uses a shared physical scale on both axes so narrow faces do not stretch a full material patch into a stripe. The high-frequency grain and wear live in textures; silhouette, seams, fasteners and articulation are geometry. The art source and final GLB are compared after export, rather than treating the Blender shader alone as proof of the delivered appearance.

## Interaction integration

The visible Blender meshes replace the procedural case, while invisible touch and collision proxies retain input reach. Both latch targets operate the same lock. The lid, latch tongues and four knurled wheels animate independently. Runtime numeral maps occupy the model's recessed display faces.

The case rests on the desk, and the opened notebook sits beside it with clearance for its cover. Its collision shell is hollow, and the photographs start inside the lining instead of floating above a solid box. The lid collider encloses the exported lid, caps and hinge parts. Loading failure retains the functional procedural fallback. Existing save progress, reset behavior, sound and glove rules remain in place.

## Rebuild and check

From the project root, run:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/briefcase-build.py -- --final
npm run test:briefcase-asset
npm run test:briefcase-browser
node scripts/briefcase-review-check.mjs
npm run test:opening
npm run test:opening-browser
npm run test:asset-paths
npm run build
```

Browser gameplay checks require the development server on port 5211. Production preview uses 5212. Generated browser test output is under ignored `output/briefcase/`.

Final asset version 1.0.4 is 5,761,548 bytes (about 5.49 MiB), with 34,236 triangles and 20 render meshes. Blender source and GLB reimport checks passed, including five lid poses without painted-shell intersections. The focused case, complete opening, asset-path and production browser checks also passed. This is a fidelity step for the first office object, not a completed office-wide art pass. Physical Quest frame time, stereo inspection and hand reach still require headset validation.
