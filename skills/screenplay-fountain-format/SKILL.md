---
name: screenplay-fountain-format
description: Use for screenplay, scene writing, dialogue formatting, beat outlines, and any request that should produce structured script text compatible with Fountain syntax.
tags:
  - fountain
  - screenplay
  - dialogue
  - scene-heading
  - script-format
agents:
  allow:
    - planner
    - script_writer
---
# Screenplay Fountain Format

Use this skill when writing screenplay-facing text that benefits from clean structure and exportability.

## Source Basis
- Fountain official syntax: scene headings, action, character, dialogue, parentheticals, transitions, sections, notes.

## Rules
- Scene headings follow screenplay convention: `INT.`, `EXT.`, `INT./EXT.`, etc.
- Character cues are uppercase.
- Dialogue follows character cues immediately.
- Parentheticals are sparse and functional.
- Transitions are only used when they add rhythm or meaning.
- Action blocks should describe what is filmable, not internal prose.

## Writing Heuristics
- Use concise action paragraphs.
- Separate beats with whitespace rather than bloated exposition.
- Prefer explicit scene headings when location or time shifts matter.
- For storyboard JSON prep, treat each scene heading or forced heading as a sequence anchor.

## Do Not
- write novelistic internal monologue
- overuse parentheticals
- replace clear scene geography with abstract mood text
