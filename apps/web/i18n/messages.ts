import type { AppLocale } from './routing';
import { cache } from 'react';

import en from '../messages/en.json';
import zhCN from '../messages/zh-CN.json';

import jazzCommonEn from '../lib/nolanx/i18n/locales/en/common.json';
import jazzHomeEn from '../lib/nolanx/i18n/locales/en/home.json';
import jazzCanvasEn from '../lib/nolanx/i18n/locales/en/canvas.json';
import jazzChatEn from '../lib/nolanx/i18n/locales/en/chat.json';
import jazzSettingsEn from '../lib/nolanx/i18n/locales/en/settings.json';

import jazzCommonZh from '../lib/nolanx/i18n/locales/zh-CN/common.json';
import jazzHomeZh from '../lib/nolanx/i18n/locales/zh-CN/home.json';
import jazzCanvasZh from '../lib/nolanx/i18n/locales/zh-CN/canvas.json';
import jazzChatZh from '../lib/nolanx/i18n/locales/zh-CN/chat.json';
import jazzSettingsZh from '../lib/nolanx/i18n/locales/zh-CN/settings.json';

function convertI18nextPlaceholders(input: unknown): unknown {
  if (typeof input === 'string') {
    // Convert i18next interpolation {{var}} → ICU {var}
    return input.replace(/{{\s*([^{}]+?)\s*}}/g, '{$1}');
  }
  if (Array.isArray(input)) return input.map(convertI18nextPlaceholders);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, convertI18nextPlaceholders(v)])
    );
  }
  return input;
}

type NolanxNamespace = 'common' | 'home' | 'canvas' | 'chat' | 'settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const result: Record<string, unknown> = {...base};
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown) {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    const next = cursor[segment];
    if (!isPlainObject(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  const leaf = path[path.length - 1]!;
  const existing = cursor[leaf];
  cursor[leaf] = existing === undefined ? value : deepMerge(existing, value);
}

function expandDotKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(expandDotKeys);
  if (!isPlainObject(input)) return input;

  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const value = expandDotKeys(rawValue);

    if (!rawKey.includes('.')) {
      const existing = result[rawKey];
      result[rawKey] = existing === undefined ? value : deepMerge(existing, value);
      continue;
    }

    const parts = rawKey.split('.').filter(Boolean);
    if (parts.length === 0) continue;
    setNestedValue(result, parts, value);
  }
  return result;
}

async function loadNolanxNamespace(locale: AppLocale, ns: NolanxNamespace): Promise<Record<string, unknown> | null> {
  if (locale === 'en') {
    switch (ns) {
      case 'common':
        return jazzCommonEn as unknown as Record<string, unknown>;
      case 'home':
        return jazzHomeEn as unknown as Record<string, unknown>;
      case 'canvas':
        return jazzCanvasEn as unknown as Record<string, unknown>;
      case 'chat':
        return jazzChatEn as unknown as Record<string, unknown>;
      case 'settings':
        return jazzSettingsEn as unknown as Record<string, unknown>;
    }
  }

  if (locale === 'zh-CN') {
    switch (ns) {
      case 'common':
        return jazzCommonZh as unknown as Record<string, unknown>;
      case 'home':
        return jazzHomeZh as unknown as Record<string, unknown>;
      case 'canvas':
        return jazzCanvasZh as unknown as Record<string, unknown>;
      case 'chat':
        return jazzChatZh as unknown as Record<string, unknown>;
      case 'settings':
        return jazzSettingsZh as unknown as Record<string, unknown>;
    }
  }

  try {
    const mod = (await import(`../lib/nolanx/i18n/locales/${locale}/${ns}.json`)) as {
      default: Record<string, unknown>;
    };
    return mod.default;
  } catch {
    return null;
  }
}

async function loadNolanxBundle(locale: AppLocale) {
  const baseLocale: AppLocale = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const [common, home, canvas, chat, settings] = await Promise.all([
    loadNolanxNamespace(locale, 'common'),
    loadNolanxNamespace(locale, 'home'),
    loadNolanxNamespace(locale, 'canvas'),
    loadNolanxNamespace(locale, 'chat'),
    loadNolanxNamespace(locale, 'settings'),
  ]);

  return {
    common: expandDotKeys(
      convertI18nextPlaceholders((common ?? (await loadNolanxNamespace(baseLocale, 'common'))) ?? {})
    ),
    home: expandDotKeys(convertI18nextPlaceholders((home ?? (await loadNolanxNamespace(baseLocale, 'home'))) ?? {})),
    canvas: expandDotKeys(
      convertI18nextPlaceholders((canvas ?? (await loadNolanxNamespace(baseLocale, 'canvas'))) ?? {})
    ),
    chat: expandDotKeys(convertI18nextPlaceholders((chat ?? (await loadNolanxNamespace(baseLocale, 'chat'))) ?? {})),
    settings: expandDotKeys(
      convertI18nextPlaceholders((settings ?? (await loadNolanxNamespace(baseLocale, 'settings'))) ?? {})
    ),
  };
}

async function loadLocaleMessages(locale: AppLocale): Promise<Record<string, unknown> | null> {
  // Keep static imports for the primary locales to avoid bundler edge cases.
  if (locale === 'en') return en as unknown as Record<string, unknown>;
  if (locale === 'zh-CN') return zhCN as unknown as Record<string, unknown>;

  try {
    const mod = (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> };
    return mod.default;
  } catch {
    return null;
  }
}

export const getAppMessages = cache(async (locale: AppLocale, includeNolanx: boolean = false) => {
  const base = (locale === 'zh-CN' ? zhCN : en) as unknown as Record<string, unknown>;
  const override = await loadLocaleMessages(locale);
  const merged = expandDotKeys(deepMerge(base, override ?? {})) as Record<string, unknown>;
  if (!includeNolanx) {
    return merged;
  }

  const nolanxBundle = await loadNolanxBundle(locale);

  return {
    ...merged,
    Nolanx: nolanxBundle,
  };
});
