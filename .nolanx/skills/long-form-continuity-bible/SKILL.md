---
name: long-form-continuity-bible
description: Use for ongoing multi-shot, episodic, sequel, or continuation work that needs strong character, environment, prop, and tone consistency over time.
tags:
  - continuity
  - consistency
  - world-bible
  - episodic
  - sequel
  - character-bible
agents:
  allow:
    - planner
    - script_writer
    - image_designer
    - image_edit_agent
    - video_designer
    - flf_video_designer
---
# Long-Form Continuity Bible

Use this skill whenever the request continues prior work or depends on strong visual continuity.

## Goals
- Keep identity, world state, and visual language stable across shots and sessions.
- Prevent drift in costume, anatomy, environment layout, prop design, and tone.
- Prefer explicit continuity constraints over implicit memory.

## Continuity Checklist
Track and preserve:
- character identity anchors: face shape, hair, silhouette, costume, damage state, age cues
- prop anchors: weapon form, material language, glow behavior, carried side, scale
- location anchors: layout, atmosphere, palette, weather, time-of-day, destruction state
- motion anchors: direction of travel, body orientation, current action phase
- tone anchors: contrast, saturation, lens language, pacing style

## Working Rules
- If continuing from previous shots, explicitly state what must not change.
- If transformation occurs, describe the before/after state and the irreversible steps between them.
- If a scene changes location or time, mark it as a deliberate transition rather than silent drift.
- Reuse named world assets consistently.
- Preserve battle damage, dirt, blood, cracks, smoke, or energy residue unless story logic clears them.

## Reference Hierarchy
Use references in this order:
1. prior formal shot continuity when directly continuing action
2. world-audition videos for stable character/prop/location identity
3. locked written continuity notes
4. only then fresh generation freedom

## Failure Modes To Block
- same character but different face or costume silhouette
- weapon or prop mutates without story reason
- environment resets between consecutive beats
- palette and lighting jump without narrative cause
