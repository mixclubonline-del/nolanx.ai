---
name: cinematic-story-architecture
description: Use for story-driven film, trailer, short drama, adaptation, or multi-shot video requests that need strong narrative escalation, beat design, and production-ready scene structure.
tags:
  - film
  - narrative
  - screenplay
  - storyboard
  - short-drama
  - adaptation
agents:
  allow:
    - planner
    - script_writer
    - video_designer
    - flf_video_designer
---
# Cinematic Story Architecture

Apply this skill when the request is narrative, dramatic, episodic, trailer-like, or adaptation-driven.

## Goals
- Build a clear dramatic spine before visual generation.
- Turn loose prompts into production-ready scene beats.
- Preserve user-provided IP, names, locations, lore, and emotional intent exactly.
- Prioritize a strong first 3 seconds and meaningful escalation every beat.

## Workflow
1. Identify story mode: short drama, film scene, trailer, ad narrative, adaptation, or action vignette.
2. Lock the narrative engine:
   - protagonist desire
   - obstacle / pressure
   - turning point
   - payoff or cliffhanger
3. Break output into playable beats, not exposition blocks.
4. For each beat, define:
   - action
   - emotional turn
   - visual revelation
   - camera intention
   - dialogue or silence function
5. Ensure each successive beat either raises stakes, reveals new information, or reverses power.

## Structural Rules
- Start from conflict, pressure, mystery, or impact. Do not warm up slowly.
- Prefer 3-7 dense beats for short-form scenes.
- Every beat must justify its screen time visually.
- Dialogue should change the power balance or emotional state, not merely explain background.
- If adaptation is requested, preserve source plot facts and role relationships unless the user explicitly asks to rewrite them.

## Beat Design Heuristics
- Hook: shock, threat, reversal, desire, countdown, or emotional rupture.
- Middle: pursuit, confrontation, discovery, transformation, or worsening trap.
- End: twist, unresolved danger, emotional slam, or irreversible action.

## Output Requirements
When producing script or storyboard-facing planning:
- Name beats clearly.
- Keep recurring world elements stable.
- Specify why each beat exists.
- Carry aspect ratio and format intent across all beats.

## Guardrails
- Do not flatten everything into generic cinematic prose.
- Do not redesign the world every shot.
- Do not rename canon entities.
- Do not rely on narration to do the work of staging.
