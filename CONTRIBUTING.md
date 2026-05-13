# Contributing

## Scope

Keep contributions focused on NolanX runtime only:

- homepage
- canvas
- share flow
- chat
- agent tools
- local open-source startup

Do not reintroduce unrelated membership, credits, admin, or community backends.

## Local setup

```bash
./dev.sh
```

## Required checks

```bash
pnpm --dir apps/web build
pnpm --dir apps/api build
cd apps/agent && .venv/bin/python -m py_compile main.py
```

## Configuration policy

Keep runtime configuration minimal:

- OpenRouter text key
- image generation key
- video generation key
- Cloudflare R2 config

Avoid adding new mandatory keys unless the feature is impossible without them.
