# Briefcase texture refinement

The built-in image-generation tool edited Blender's exported four-quadrant placeholder atlas. The selected result was inspected and copied into the project as `art/briefcase/textures/briefcase-basecolor-final.png`. It preserves the normalized quadrant layout. The requested resolution was 2048 square; the tool delivered 1254 square, which is kept at its native resolution. Blender-authored surface maps supply roughness, metallic response and tangent-space normals separately.

Source: `art/briefcase/textures/briefcase-basecolor-placeholder.png`

First generated source: `exec-ee0ddcb7-d584-4163-bb36-4abfe50af5d2.png`

Final refinement source: `exec-6ab34c4f-2ee8-423f-8a4b-ee0466b06da6.png`. The open-case review revealed coarse fabric grain, so a second built-in edit reduced the lining weave scale. The final selected image remains 1254 square and is saved at the same project final-atlas path; the intermediate is retained in ignored review output.

## Final lining refinement prompt

Refine ONLY the BOTTOM RIGHT quadrant of this square four-quadrant Blender UV albedo atlas. Keep the other three quadrants visually unchanged, preserve their exact positions, quadrant boundaries, colors and textures. Keep the same square 2x2 layout and full-canvas coverage. In the bottom-right quadrant replace the very coarse burlap/upholstery weave with a MUCH FINER archival briefcase lining: dark olive-charcoal tightly woven cotton twill with a soft felted finish, extremely fine low-contrast fibers, gentle dust and subtle age variation. The current weave looks like centimetre-sized pebbles on a 90cm-wide case; the replacement must look like submillimetre threads, at least eight times finer, almost a smooth matte charcoal-olive surface at this atlas resolution. NO coarse visible loops, bumps, braided threads, pebbles, folds, holes, lighting, gradients, borders, symbols or objects. This is flat physically based albedo under uniform diffuse illumination. Do not change the top-left worn olive paint, top-right aged champagne metal, or bottom-left oxblood leather. Preserve the original 1254x1254 dimensions if possible.

## Exact prompt

Edit the supplied Blender-exported 2048 x 2048 base-color texture atlas into a high-fidelity physically based game asset albedo for a 1950s archival metal briefcase. Preserve the EXACT square 2-by-2 layout, sharp quadrant boundaries at x=1024 and y=1024, original quadrant positions, flat orthographic texture mapping and overall palette. Output 2048 x 2048. This is a FLAT UV MATERIAL ATLAS, not a picture of a case. No objects, perspective, directional lighting, highlights, drop shadows, frames, labels, text, symbols, geometry, bolts, or seams crossing quadrant boundaries. Uniform diffuse/albedo illumination only. Fill the full canvas edge to edge.
TOP LEFT: weathered olive-gray painted metal, the original restrained green-gray average color. Rich subtle irregular enamel grain, fine scratches in several directions, tiny scattered paint chips showing dull gray metal, sparse abrasion, old handling smudges and gentle localized oxidation. Keep 85 percent intact paint so it reads as maintained vintage equipment, not wreckage. Small-scale details with no large focal scratch and no vignette.
TOP RIGHT: brushed warm nickel / aged champagne brass, subdued desaturated ochre-gray, extremely fine machining hairlines and scattered micro-scratches, subtle tarnish mottling, faint mineral spotting and handling rubs. Albedo only, NO baked specular reflections or lighting gradients, not bright gold.
BOTTOM LEFT: deep oxblood-brown leather, fine natural pore grain, understated creasing, rubbing and small dry age cracks. Slight color variation, quiet aged character, no stitching baked into this patch because stitching is modeled separately. Do not brighten leather to tan.
BOTTOM RIGHT: charcoal-olive woven fabric lining, tiny precise low-contrast weave, subtle textile fuzz, very gentle worn variations, tiny specks of archival dust, without holes, strong folds, borders or symbols.
The four materials should feel tactile and realistic in a moody warm archive office, with convincing close-up surface detail. Preserve each material identity, exact layout and usable edge continuity. Avoid artistic rendering, exaggerated rust, noisy high contrast and visible scene lighting.
