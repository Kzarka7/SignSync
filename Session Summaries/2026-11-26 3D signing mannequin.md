# 3D signing mannequin

**What was asked**
- Plan a light 3D signing avatar for the FSL avatar panel, then focus on a plain, faceless mannequin, connect Claude Code to Blender, and improve the mannequin in Blender.

**What changed**
- Mockups (inline three.js widgets only, no project files): avatar in `AvatarPanel` layout, plain mannequin, construction-study mannequin.
- `Softwares/.mcp.json`: project MCP server `blender`, pointing at the installed Blender Lab extension's `blender-mcp.exe` (the Chat-tab desktop extension doesn't load in Code sessions). Verified: the server starts, lists 24 tools and reaches the running Blender 5.3.
- Blender mannequin (in the `Mannequin` collection):
  - Smooth-by-angle shading on all parts.
  - Hands rebuilt: tapered rounded palm, thumb pad, thumb re-seated about 49° from the fingers, smooth 12-sided tapered finger segments, finger knuckles in body color.
  - Elbow, wrist, knee and ankle cylinders replaced with spheres.
  - Armature `Mannequin_Rig` with 49 bones (hips, spine, chest, neck, head; shoulder, upper_arm, lower_arm, hand, thumb/index/middle/ring/pinky_01-03, upper_leg, lower_leg, foot per side, `_L`/`_R` suffix).
  - All parts merged into one mesh, `Mannequin` (14,172 triangles, 2 materials), rigidly bound with each part 100% on one bone.
- Tested: fist (A), index point, and HELLO (B hand at forehead, placed with a two-bone solve). Then reset to the rest pose.
- Saved `SignSync/Frontend/public/models/mannequin.blend` and `mannequin.glb` (427 KB, 1 skin, 49 joints, no animation), plus `mannequin_backup_before_improve.blend`.

**Decisions and caveats**
- Finger curl toward the palm = negative local X rotation on both hands.
- Bone names use `_L`/`_R`, not `.L`, because three.js strips dots from node names.
- No facial features on the head (see the memory note).
- `.mcp.json` hard-codes the extension's install path; an extension update may change it.

**Update: sculpted body to match the user's reference image (gray, not green)**
- Backup: `public/models/mannequin_backup_v2_blocky.blend`.
- Found 100 split-off old parts (`Mannequin.001`–`.100`) overlapping the body, likely separated in Blender between turns. The 76 hand pieces were merged back. The other 24 old body pieces were moved to an excluded collection, `Old_Mannequin_Parts`, not deleted.
- Rebuilt every non-hand part as a smooth lofted form: egg head, short dark neck, chest plate with pecs, separate abdomen, a pelvis shaped like briefs, deltoid and biceps upper arms, forearms, tapered thighs, calves and rounded boot feet. Joints are dark balls and thin dark waist gaps.
- Same 49-bone rig and rigid binding. Pose test (HELLO, a bent arm, a bent knee) followed correctly, then reset.
- Re-exported `mannequin.glb` (666 KB, 49 joints, 1 mesh, 23,428 triangles) and saved `mannequin.blend`.
- The rest pose stays as an A-pose (the reference image is a T-pose).

**Not done / open**
- three.js test page loading `mannequin.glb` with per-joint sliders.
- Landmark → bone retargeting / bake pipeline. See [[Project Home]].
