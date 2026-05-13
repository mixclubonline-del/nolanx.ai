import type { LLMConfig } from '@/lib/nolanx/types/types'

export const PROVIDER_NAME_MAPPING: {
  [key: string]: { name: string; icon: string }
} = {
  jaaz: {
    name: 'Jaaz',
    icon: 'https://raw.githubusercontent.com/11cafe/jaaz/refs/heads/main/assets/icons/jaaz.png',
  },
  anthropic: {
    name: 'Claude',
    icon: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/claude-color.png',
  },
  openai: { name: 'OpenAI', icon: 'https://openai.com/favicon.ico' },
  replicate: {
    name: 'Replicate',
    icon: 'https://images.seeklogo.com/logo-png/61/1/replicate-icon-logo-png_seeklogo-611690.png',
  },
  ollama: {
    name: 'Ollama',
    icon: 'https://images.seeklogo.com/logo-png/59/1/ollama-logo-png_seeklogo-593420.png',
  },
  huggingface: {
    name: 'Hugging Face',
    icon: 'https://huggingface.co/favicon.ico',
  },
  wavespeed: {
    name: 'WaveSpeedAi',
    icon: 'https://www.wavespeed.ai/favicon.ico',
  },
  volces: {
    name: 'Volces',
    icon: 'https://portal.volccdn.com/obj/volcfe/misc/favicon.png',
  },
  comfyui: {
    name: 'ComfyUI',
    icon: 'https://framerusercontent.com/images/3cNQMWKzIhIrQ5KErBm7dSmbd2w.png',
  },
}
export const DEFAULT_PROVIDERS_CONFIG: { [key: string]: LLMConfig } = {
  openai: {
    models: {
      'gpt-4o': { type: 'text' },
      'gpt-4o-mini': { type: 'text' },
      'gpt-image-1': { type: 'image' },
    },
    url: 'https://api.openai.com/v1/',
    api_key: '',
    max_tokens: 8192,
  },
  replicate: {
    models: {
      'google/imagen-4': { type: 'image' },
      'black-forest-labs/flux-1.1-pro': { type: 'image' },
      'black-forest-labs/flux-kontext-pro': { type: 'image' },
      'black-forest-labs/flux-kontext-max': { type: 'image' },
      'recraft-ai/recraft-v3': { type: 'image' },
      'stability-ai/sdxl': { type: 'image' },
    },
    url: 'https://api.replicate.com/v1/',
    api_key: '',
    max_tokens: 8192,
  },
  wavespeed: {
    models: {
      'wavespeed-ai/flux-dev': { type: 'image' },
    },
    url: 'https://api.wavespeed.ai/api/v3/',
    api_key: '',
  },
  comfyui: {
    models: {
      'flux-dev': { type: 'image' },
      'flux-schnell': { type: 'image' },
      sdxl: { type: 'image' },
    },
    url: 'http://127.0.0.1:8188',
    api_key: '',
  },
  ollama: {
    models: {},
    url: 'http://localhost:11434',
    api_key: '',
    max_tokens: 8192,
  },
}

export const DEFAULT_MODEL_LIST = Object.keys(DEFAULT_PROVIDERS_CONFIG).flatMap(
  (provider) =>
    Object.keys(DEFAULT_PROVIDERS_CONFIG[provider].models).map((model) => ({
      provider,
      model,
      type: DEFAULT_PROVIDERS_CONFIG[provider].models[model].type ?? 'text',
      url: DEFAULT_PROVIDERS_CONFIG[provider].url,
    }))
)

// Tool call name mapping
export const TOOL_CALL_NAME_MAPPING: Record<string, string> = {
  generate_image: 'Image Generator',
  edit_image: 'Image Editor',
  generate_audio: 'Generate Audio',
  generate_video: 'Video',
  generate_video_first_last_frame: 'FLF Video',
  generate_tts_audio: 'Generate TTS Audio',
  generate_music: 'Generate Music',
  generate_structured_output: 'Generate Structured Output',
  execute_storyboard: 'Execute Storyboard',
  analyze_timeline_state: 'Analyze Timeline',
  recommend_generation_strategy: 'Recommend Strategy',
  execute_code: 'Execute Code',
  analyze_documents: 'Analyze Documents',
  analyze_media: 'Analyze Media',
  execute_function_call: 'Execute Function Call',
  analyze_web_context: 'Analyze Web Context',
  search_and_generate: 'Search & Generate',
  prompt_user_multi_choice: 'Prompt Multi-Choice',
  prompt_user_single_choice: 'Prompt Single-Choice',
  write_plan: 'Write Plan',
  finish: 'Finish',
}

export const LOGO_URL = 'https://jaaz.app/favicon.ico'

export const DEFAULT_SYSTEM_PROMPT = `You are Nolan, a professional AI cinematographer and visual storytelling agent. You can craft cinematic visual narratives and write professional image prompts to generate compelling storyboard frames that bring stories to life.
Step 1. write a cinematic vision plan. Write in the same language as the user's initial story prompt.

Example Cinematic Vision Doc:
Design Proposal for “MUSE MODULAR – Future of Identity” Cover
• Recommended resolution: 1024 × 1536 px (portrait) – optimal for a standard magazine trim while preserving detail for holographic accents.

• Style & Mood
– High-contrast grayscale base evoking timeless editorial sophistication.
– Holographic iridescence selectively applied (cyan → violet → lime) for mask edges, title glyphs and micro-glitches, signalling futurism and fluid identity.
– Atmosphere: enigmatic, cerebral, slightly unsettling yet glamorous.

• Key Visual Element
– Central androgynous model, shoulders-up, lit with soft frontal key and twin rim lights.
– A translucent polygonal AR mask overlays the face; within it, three offset “ghost” facial layers (different eyes, nose, mouth) hint at multiple personas.
– Subtle pixel sorting/glitch streaks emanate from mask edges, blending into background grid.

• Composition & Layout

Masthead “MUSE MODULAR” across the top, extra-condensed modular sans serif; characters constructed from repeating geometric units. Spot UV + holo foil.
Tagline “Who are you today?” centered beneath masthead in ultra-light italic.
Subject’s gaze directly engages reader; head breaks the baseline of the masthead for depth.
Bottom left kicker “Future of Identity Issue” in tiny monospaced capitals.
Discreet modular grid lines and data glyphs fade into matte charcoal background, preserving negative space.
• Color Palette
#000000, #1a1a1a, #4d4d4d, #d9d9d9 + holographic gradient (#00eaff, #c400ff, #38ffab).

• Typography
– Masthead: custom variable sans with removable modules.
– Tagline: thin italic grotesque.
– Secondary copy: 10 pt monospaced to reference code.

• Print Finishing
– Soft-touch matte laminate overall.
– Spot UV + holographic foil on masthead, mask outline and glitch shards.

Step 2. Call generate_image tool to generate the storyboard frame based on the cinematic vision immediately, use a detailed and professional image prompt according to your vision plan, no need to ask for user's approval.
`
