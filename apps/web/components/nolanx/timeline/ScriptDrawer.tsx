"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, Film, Layers, MessageSquare, Search } from "lucide-react";

import type { TimelineAsset, TimelineTrack } from "@/lib/nolanx/types/timeline";
import { cn } from "@/lib/nolanx/utils/utils";
import { useTranslation } from "@/lib/nolanx/i18n/useTranslation";
import { eventBus } from "@/lib/nolanx/utils/event";
import { Button } from "@/components/nolanx/ui/button";
import { Input } from "@/components/nolanx/ui/input";
import { ScrollArea } from "@/components/nolanx/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/nolanx/ui/sheet";

type ScriptDrawerTab = "script" | "elements" | "shots";

export type ScriptDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: ScriptDrawerTab;
  track?: TimelineTrack;
  worldTrack?: TimelineTrack;
  onSeek?: (timeSeconds: number) => void;
};

function getAssetTitle(asset: TimelineAsset): string {
  const raw = asset.content.title?.trim();
  if (raw) return raw;
  const kind = String(asset.metadata?.kind || "").trim();
  if (kind) return kind;
  return "Script";
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ScriptDrawer({ open, onOpenChange, initialTab, track, worldTrack, onSeek }: ScriptDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ScriptDrawerTab>(initialTab ?? "script");
  const [query, setQuery] = useState("");
  const [showFullScript, setShowFullScript] = useState(false);

  const scriptAssets = useMemo(() => {
    const items = [...(track?.assets || [])];
    items.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    return items;
  }, [track?.assets]);

  const worldAssets = useMemo(() => {
    const items = [...(worldTrack?.assets || [])];
    items.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    return items;
  }, [worldTrack?.assets]);

  useEffect(() => {
    if (!open) return;
    if (initialTab) setTab(initialTab);
  }, [open, initialTab]);

  const screenplayAsset = useMemo(() => {
    const candidates = scriptAssets.filter((a) => {
      const kind = String(a.metadata?.kind || "").toLowerCase();
      const title = String(a.content.title || "").toLowerCase();
      return kind === "screenplay" || kind === "script_bible" || title.includes("screenplay") || title.includes("script");
    });
    candidates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return candidates[0];
  }, [scriptAssets]);

  const shotAssets = useMemo(() => {
    return scriptAssets.filter((a) => {
      const kind = String(a.metadata?.kind || "").toLowerCase();
      return kind === "shot" || kind === "shot_script" || typeof a.metadata?.shotIndex === "number";
    });
  }, [scriptAssets]);

  const screenplayShotList = useMemo(() => {
    const list = screenplayAsset?.metadata?.shots;
    return Array.isArray(list) ? list : [];
  }, [screenplayAsset?.metadata?.shots]);

  const elementAssets = useMemo(() => {
    const fromWorldTrack = worldAssets.filter((a) => {
      const kind = String(a.metadata?.kind || "").toLowerCase();
      return a.type === "world" || kind === "world_element_image" || Boolean(a.metadata?.worldElement);
    });

    const legacyFromScriptTrack = scriptAssets.filter((a) => {
      const kind = String(a.metadata?.kind || "").toLowerCase();
      return kind === "bible_element_image" || kind === "bible_element" || Boolean(a.metadata?.bibleElement);
    });

    const merged = [...fromWorldTrack, ...legacyFromScriptTrack];
    const unique = new Map<string, TimelineAsset>();
    merged.forEach((a) => unique.set(a.id, a));
    return Array.from(unique.values());
  }, [scriptAssets, worldAssets]);

  const filteredShotAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shotAssets;
    return shotAssets.filter((a) => {
      const title = getAssetTitle(a).toLowerCase();
      const text = String(a.content.text || "").toLowerCase();
      return title.includes(q) || text.includes(q);
    });
  }, [query, shotAssets]);

  const filteredShotList = useMemo(() => {
    if (filteredShotAssets.length > 0) return [];
    const q = query.trim().toLowerCase();
    if (!q) return screenplayShotList;
    return screenplayShotList.filter((s: any) => {
      const idx = String(s?.index ?? "").toLowerCase();
      const notes = String(s?.keyframe_notes ?? "").toLowerCase();
      return idx.includes(q) || notes.includes(q);
    });
  }, [filteredShotAssets.length, query, screenplayShotList]);

  const filteredElementAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return elementAssets;
    return elementAssets.filter((a) => {
      const title = getAssetTitle(a).toLowerCase();
      const kind = String(a.metadata?.elementKind || a.metadata?.kind || "").toLowerCase();
      const text = String(a.content.text || a.content.description || "").toLowerCase();
      return title.includes(q) || kind.includes(q) || text.includes(q);
    });
  }, [elementAssets, query]);

  const screenplayText = useMemo(() => {
    if (!screenplayAsset) return "";
    const metaText =
      screenplayAsset.metadata?.screenplayText ?? screenplayAsset.metadata?.screenplay ?? screenplayAsset.metadata?.script;
    return normalizeText(screenplayAsset.content.text ?? metaText);
  }, [screenplayAsset]);

  const screenplaySummary = useMemo(() => {
    if (!screenplayAsset) return "";
    const summary = screenplayAsset.metadata?.summary ?? screenplayAsset.metadata?.screenplaySummary;
    return normalizeText(summary);
  }, [screenplayAsset]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const addElementToChat = (asset: TimelineAsset) => {
    const imageUrl = asset.content.thumbnailUrl || asset.content.imageUrl;
    if (!imageUrl) return;

    const originalSize = asset.metadata?.originalSize;
    const width =
      typeof originalSize?.width === "number" ? originalSize.width : typeof (asset as any).content?.width === "number" ? (asset as any).content.width : 1024;
    const height =
      typeof originalSize?.height === "number" ? originalSize.height : typeof (asset as any).content?.height === "number" ? (asset as any).content.height : 1024;

    eventBus.emit("Canvas::AddImagesToChat", [
      {
        fileId: asset.id,
        url: imageUrl,
        width,
        height,
      },
    ]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[92vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl border-l border-black/10 dark:border-white/10"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 dark:border-white/10 bg-[linear-gradient(90deg,rgb(255,90,0),rgb(255,154,31))]">
              <BookOpen className="h-4 w-4 text-white" />
            </span>
            <span>{t("canvas:timeline.scriptDrawer.title")}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("canvas:timeline.scriptDrawer.searchPlaceholder")}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-zinc-950/40 p-1">
            <button
              type="button"
              onClick={() => setTab("script")}
              className={cn(
                "h-8 px-3 rounded-lg text-sm font-medium transition-colors",
                tab === "script"
                  ? "bg-black/90 text-white dark:bg-white/90 dark:text-black"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("canvas:timeline.scriptDrawer.tabs.script")}
            </button>
            <button
              type="button"
              onClick={() => setTab("elements")}
              className={cn(
                "h-8 px-3 rounded-lg text-sm font-medium transition-colors",
                tab === "elements"
                  ? "bg-black/90 text-white dark:bg-white/90 dark:text-black"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("canvas:timeline.scriptDrawer.tabs.elements")}
            </button>
            <button
              type="button"
              onClick={() => setTab("shots")}
              className={cn(
                "h-8 px-3 rounded-lg text-sm font-medium transition-colors",
                tab === "shots"
                  ? "bg-black/90 text-white dark:bg-white/90 dark:text-black"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("canvas:timeline.scriptDrawer.tabs.shots")}
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-4 flex-1 min-h-0">
          <ScrollArea className="h-full rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-zinc-950/40">
            <div className="p-4">
              {tab === "script" && (
                <div className="space-y-4">
                  {screenplayAsset ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">
                            {getAssetTitle(screenplayAsset)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {t("canvas:timeline.scriptDrawer.scriptMeta", {
                              assetCount: scriptAssets.length,
                              shotCount: shotAssets.length,
                              elementCount: elementAssets.length,
                            })}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(screenplayText)}
                          className="flex-shrink-0"
                        >
                          <Copy className="h-4 w-4" />
                          {t("canvas:timeline.scriptDrawer.copy")}
                        </Button>
                      </div>

                      <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-zinc-950/30 p-3">
                        {screenplaySummary && screenplaySummary !== screenplayText ? (
                          <div className="mb-3 rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-3">
                            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                              {screenplaySummary}
                            </div>
                          </div>
                        ) : null}

                        <div
                          className={cn(
                            "relative whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground",
                            !showFullScript && "max-h-64 overflow-hidden"
                          )}
                        >
                          {screenplayText || t("canvas:timeline.scriptDrawer.emptyScript")}
                          {!showFullScript && screenplayText.length > 1200 ? (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/95 dark:from-zinc-950/90 to-transparent" />
                          ) : null}
                        </div>

                        {screenplayText.length > 1200 ? (
                          <div className="mt-3 flex justify-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setShowFullScript((v) => !v)}
                            >
                              {showFullScript ? t("chat:messages.showLess") : t("chat:messages.showMore")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t("canvas:timeline.scriptDrawer.noScript")}</div>
                  )}
                </div>
              )}

              {tab === "elements" && (
                <div className="space-y-4">
                  {filteredElementAssets.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("canvas:timeline.scriptDrawer.noElements")}</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredElementAssets.map((asset) => {
                        const imageUrl = asset.content.thumbnailUrl || asset.content.imageUrl;
                        const elementKind = String(asset.metadata?.elementKind || asset.metadata?.kind || "");
                        const importance = asset.metadata?.importance;
                        const prompt = String(asset.metadata?.imagePromptEn || asset.metadata?.prompt || "");
                        const addToChatLabel = t("canvas:popbar.addToChat");
                        return (
                          <div
                            key={asset.id}
                            className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-zinc-950/30 overflow-hidden"
                          >
                            {imageUrl ? (
                              <div className="aspect-[16/9] bg-black/5 dark:bg-white/5 overflow-hidden">
                                <img src={imageUrl} alt={getAssetTitle(asset)} className="h-full w-full object-cover" />
                              </div>
                            ) : null}
                            <div className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-foreground truncate">{getAssetTitle(asset)}</div>
                                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 min-w-0">
                                      <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                                      <span className="truncate">
                                        {elementKind || t("canvas:timeline.scriptDrawer.unknownKind")}
                                      </span>
                                    </span>
                                    {typeof importance === "number" ? (
                                      <span className="inline-flex items-center rounded-md border border-black/10 dark:border-white/10 px-1.5 py-0.5 text-[11px]">
                                        {t("canvas:timeline.scriptDrawer.importance", { value: importance })}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {prompt ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => copyToClipboard(prompt)}
                                      title={t("canvas:timeline.scriptDrawer.copyPrompt")}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                  {imageUrl ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => addElementToChat(asset)}
                                      title={addToChatLabel}
                                      aria-label={addToChatLabel}
                                    >
                                      <MessageSquare className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                  {onSeek ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => onSeek(asset.startTime || 0)}
                                      title={t("canvas:timeline.scriptDrawer.goToTime")}
                                    >
                                      <Film className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>

                              {asset.content.text || asset.content.description ? (
                                <div className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                                  {asset.content.text || asset.content.description}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tab === "shots" && (
                <div className="space-y-3">
                  {filteredShotAssets.length === 0 && filteredShotList.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("canvas:timeline.scriptDrawer.noShots")}</div>
                  ) : filteredShotAssets.length > 0 ? (
                    filteredShotAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-zinc-950/30 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">{getAssetTitle(asset)}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {t("canvas:timeline.scriptDrawer.timecode", {
                                seconds: Number(asset.startTime || 0).toFixed(1),
                              })}
                              {" · "}
                              {t("canvas:timeline.scriptDrawer.duration", { seconds: Number(asset.duration || 0).toFixed(1) })}
                            </div>
                          </div>
                          {onSeek ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => onSeek(asset.startTime || 0)}>
                              <Film className="h-4 w-4" />
                              {t("canvas:timeline.scriptDrawer.go")}
                            </Button>
                          ) : null}
                        </div>
                        {asset.content.text ? (
                          <div className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
                            {asset.content.text}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    filteredShotList.map((shot: any, idx: number) => {
                      const startSec = Number(shot?.start_sec ?? 0);
                      const endSec = Number(shot?.end_sec ?? 0);
                      const shotIndex = typeof shot?.index === "number" ? shot.index : idx;
                      const title = `${t("canvas:timeline.scriptDrawer.tabs.shots")} ${shotIndex + 1}`;
                      const notes = String(shot?.keyframe_notes ?? "").trim();
                      return (
                        <div
                          key={`shotlist-${shotIndex}-${startSec}`}
                          className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-zinc-950/30 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground truncate">{title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {t("canvas:timeline.scriptDrawer.timecode", { seconds: startSec.toFixed(1) })}
                                {" · "}
                                {t("canvas:timeline.scriptDrawer.duration", {
                                  seconds: Math.max(0, endSec - startSec).toFixed(1),
                                })}
                              </div>
                            </div>
                            {onSeek ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => onSeek(startSec)}>
                                <Film className="h-4 w-4" />
                                {t("canvas:timeline.scriptDrawer.go")}
                              </Button>
                            ) : null}
                          </div>
                          {notes ? (
                            <div className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
                              {notes}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
