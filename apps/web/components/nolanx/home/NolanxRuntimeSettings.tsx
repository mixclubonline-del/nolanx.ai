'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, ExternalLink, ImageIcon, KeyRound, Link2, Settings2, Sparkles, Video } from 'lucide-react'
import { Button } from '@/components/nolanx/ui/button'
import { Input } from '@/components/nolanx/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/nolanx/ui/dialog'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { getRuntimeConfig, updateRuntimeConfig, type RuntimeConfigData, type RuntimeConfigStatus } from '@/lib/nolanx/api/runtime-config'
import { eventBus } from '@/lib/nolanx/utils/event'
import { cn } from '@/lib/utils'

const DEFAULTS: RuntimeConfigData = {
  openrouter_model: 'google/gemini-3.5-flash',
  image_model: 'openai/gpt-image-2',
  image_edit_model: 'openai/gpt-image-2',
  video_model: 'dreamina-seedance-2-0-260128',
}

const LINKS = {
  openrouter: 'https://openrouter.ai/workspaces/default/keys',
  image: 'https://fal.ai/dashboard/keys',
  video: 'https://reelmind.ai/platform',
  r2: 'https://dash.cloudflare.com/?to=/:account/r2/overview',
}

const MODE_COPY: Record<RuntimeConfigStatus['mode'], { label: string; hint: string }> = {
  'text-only': {
    label: 'Text',
    hint: 'Chat and script only',
  },
  'script-plus-image': {
    label: 'Text + Image',
    hint: 'Image layer enabled',
  },
  'full-video': {
    label: 'Full Video',
    hint: 'Core media flow enabled',
  },
  'enhanced-r2': {
    label: 'Enhanced R2',
    hint: 'Persistence and continuity boosted',
  },
}

function CapabilityPill({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
        ready ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/8 text-white/40',
      )}
    >
      {label}
    </span>
  )
}

function TinyLinkButton({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-full border-white/10 bg-white/[0.04] px-3 text-[11px] text-white/70 hover:bg-white/[0.08] hover:text-white"
      >
        {icon}
        <span className="ml-2">{label}</span>
        <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0" />
      </Button>
    </a>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">{label}</div>
      {children}
    </div>
  )
}

function CollapsibleSection({
  value,
  title,
  state,
  icon,
  children,
}: {
  value: string
  title: string
  state: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={value} className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.035] px-4 last:border-b">
      <AccordionTrigger className="gap-4 py-4 text-left hover:no-underline">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-white/70">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">{title}</div>
            <div className="text-xs text-white/42">{state}</div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-4 border-t border-white/8 pt-4">{children}</div>
      </AccordionContent>
    </AccordionItem>
  )
}

export function NolanxRuntimeSettings({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<RuntimeConfigData>(DEFAULTS)
  const [status, setStatus] = useState<RuntimeConfigStatus | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void getRuntimeConfig()
      .then((result) => {
        setConfig({ ...DEFAULTS, ...result.config })
        setStatus(result.status)
      })
      .catch((error) => {
        toast.error('Failed to load runtime settings', { description: error.message })
      })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const openFromEvent = () => setOpen(true)
    eventBus.on('Runtime::OpenSettings', openFromEvent)
    return () => {
      eventBus.off('Runtime::OpenSettings', openFromEvent)
    }
  }, [])

  const textLayerMissing = useMemo(() => {
    return Boolean(status && !status.chatReady)
  }, [status])

  const setField = (key: keyof RuntimeConfigData, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await updateRuntimeConfig(config)
      setConfig({ ...DEFAULTS, ...result.config })
      setStatus(result.status)
      toast.success('Runtime settings saved')
    } catch (error) {
      toast.error('Failed to save runtime settings', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'rounded-full border-white/12 text-white backdrop-blur-2xl hover:bg-white/[0.1] hover:text-white',
            compact
              ? 'h-10 bg-white/[0.04] px-3 text-white/70 shadow-[0_16px_36px_rgba(0,0,0,0.18)]'
              : 'h-11 bg-white/[0.05] px-4 shadow-[0_20px_40px_rgba(0,0,0,0.2)]',
          )}
        >
          <Settings2 className={cn('h-4 w-4 shrink-0', compact ? '' : 'mr-2')} />
          <span className={cn(compact ? 'ml-2 text-[11px] uppercase tracking-[0.18em]' : '')}>
            Runtime Keys
          </span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88svh] max-w-[760px] overflow-y-auto border border-white/10 bg-[radial-gradient(circle_at_top,rgba(210,161,96,0.14),transparent_24%),linear-gradient(180deg,#0d0907,#090604)] p-0 text-white shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
        <div className="relative overflow-hidden rounded-[28px]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent)]" />

          <div className="relative border-b border-white/8 px-6 pb-5 pt-6 md:px-7">
            <DialogHeader className="space-y-2 text-left">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white/58">
                <Sparkles className="h-3.5 w-3.5" />
                NolanX Runtime
              </div>
              <DialogTitle className="text-[1.7rem] font-semibold tracking-[0.02em] text-white">
                Minimal Settings
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-white/52">
                Fill text first. Expand the next layer only when needed.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/42">Current Mode</div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="rounded-full bg-[#f4e6cf] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#16110b]">
                      {status ? MODE_COPY[status.mode].label : 'Loading'}
                    </span>
                    <span className="text-xs text-white/46">
                      {status ? MODE_COPY[status.mode].hint : 'Reading runtime state'}
                    </span>
                  </div>
                </div>
                {status ? (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <CapabilityPill ready={status.textReady} label="Text" />
                    <CapabilityPill ready={status.imageReady} label="Image" />
                    <CapabilityPill ready={status.videoReady} label="Video" />
                    <CapabilityPill ready={status.enhancedStorageReady} label="R2" />
                  </div>
                ) : null}
              </div>
            </div>

            {textLayerMissing ? (
              <div className="mt-4 rounded-[20px] border border-amber-400/18 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.04))] p-3 text-sm text-amber-100">
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircle className="h-4 w-4" />
                  Add your OpenRouter key first
                </div>
                <div className="mt-1 text-amber-100/76">
                  NolanX needs the text layer before chat, planning, or script generation can start.
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 px-6 py-6 md:px-7">
            <div className="rounded-[24px] border border-[#f4e6cf]/22 bg-[linear-gradient(180deg,rgba(244,230,207,0.08),rgba(255,255,255,0.03))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#f4e6cf]/22 bg-[#f4e6cf]/10 text-[#f4e6cf]">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold tracking-[0.04em] text-white">Text Layer</h3>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]',
                        status?.chatReady ? 'bg-emerald-400/12 text-emerald-200' : 'bg-[#f4e6cf]/12 text-[#f4e6cf]',
                      )}>
                        {status?.chatReady ? 'Ready' : 'Required'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/46">
                      Chat, planning, script.
                    </p>
                  </div>
                </div>
                <TinyLinkButton href={LINKS.openrouter} icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} label="Get key on OpenRouter" />
              </div>

              <div className="mt-5 grid gap-4">
                <Field label="API Key">
                  <Input
                    value={config.openrouter_api_key || ''}
                    onChange={(e) => setField('openrouter_api_key', e.target.value)}
                    placeholder="OPENROUTER_API_KEY"
                    className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                  />
                </Field>
                <Field label="Model">
                  <Input
                    value={config.openrouter_model || ''}
                    onChange={(e) => setField('openrouter_model', e.target.value)}
                    placeholder="google/gemini-3.5-flash"
                    className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                  />
                </Field>
              </div>
            </div>

            <Accordion type="multiple" className="space-y-3">
              <CollapsibleSection
                value="image"
                title="Image Layer"
                state={status?.imageReady ? 'Enabled' : 'Collapsed until needed'}
                icon={<ImageIcon className="h-4 w-4" />}
              >
                <div className="flex justify-end">
                  <TinyLinkButton href={LINKS.image} icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} label="Get key on FAL" />
                </div>
                <div className="grid gap-4">
                  <Field label="API Key">
                    <Input
                      value={config.image_api_key || ''}
                      onChange={(e) => setField('image_api_key', e.target.value)}
                      placeholder="IMAGE_API_KEY"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Generate">
                      <Input
                        value={config.image_model || ''}
                        onChange={(e) => setField('image_model', e.target.value)}
                        placeholder="openai/gpt-image-2"
                        className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                      />
                    </Field>
                    <Field label="Edit">
                      <Input
                        value={config.image_edit_model || ''}
                        onChange={(e) => setField('image_edit_model', e.target.value)}
                        placeholder="openai/gpt-image-2"
                        className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                      />
                      </Field>
                    </div>
                  </div>
                </CollapsibleSection>

              <CollapsibleSection
                value="video"
                title="Video Layer"
                state={status?.videoReady ? 'Enabled' : 'Collapsed until needed'}
                icon={<Video className="h-4 w-4" />}
              >
                <div className="flex justify-end">
                  <TinyLinkButton href={LINKS.video} icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} label="Get key on ReelMind" />
                </div>
                <div className="grid gap-4">
                  <Field label="API Key">
                    <Input
                      value={config.video_api_key || ''}
                      onChange={(e) => setField('video_api_key', e.target.value)}
                      placeholder="VIDEO_API_KEY"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                  <Field label="Model">
                    <Input
                      value={config.video_model || ''}
                      onChange={(e) => setField('video_model', e.target.value)}
                      placeholder="dreamina-seedance-2-0-260128"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                value="r2"
                title="Cloudflare R2"
                state={status?.enhancedStorageReady ? 'Enabled' : 'Optional'}
                icon={<Settings2 className="h-4 w-4" />}
              >
                <div className="flex justify-end">
                  <TinyLinkButton href={LINKS.r2} icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} label="Get key on Cloudflare" />
                </div>
                <div className="grid gap-4">
                  <Field label="Account ID">
                    <Input
                      value={config.r2_account_id || ''}
                      onChange={(e) => setField('r2_account_id', e.target.value)}
                      placeholder="R2_ACCOUNT_ID"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Access Key">
                      <Input
                        value={config.r2_access_key_id || ''}
                        onChange={(e) => setField('r2_access_key_id', e.target.value)}
                        placeholder="R2_ACCESS_KEY_ID"
                        className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                      />
                    </Field>
                    <Field label="Bucket">
                      <Input
                        value={config.r2_bucket_name || ''}
                        onChange={(e) => setField('r2_bucket_name', e.target.value)}
                        placeholder="R2_BUCKET_NAME"
                        className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                      />
                    </Field>
                  </div>
                  <Field label="Secret">
                    <Input
                      value={config.r2_secret_access_key || ''}
                      onChange={(e) => setField('r2_secret_access_key', e.target.value)}
                      placeholder="R2_SECRET_ACCESS_KEY"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                  <Field label="Public URL">
                    <Input
                      value={config.r2_public_url || ''}
                      onChange={(e) => setField('r2_public_url', e.target.value)}
                      placeholder="https://your-public-bucket.example.com"
                      className="h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
                    />
                  </Field>
                </div>
              </CollapsibleSection>

            </Accordion>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/8 px-6 py-5 md:flex-row md:items-center md:justify-between md:px-7">
            <div className="text-xs leading-6 text-white/40">
              {loading ? 'Loading current config...' : 'Start with text. Expand only the next layer you need.'}
            </div>
            <div className="flex items-center gap-3">
              <DialogClose asChild>
                <Button type="button" variant="outline" className="rounded-full border-white/12 bg-white/[0.04] px-5 text-white/72 hover:bg-white/[0.08] hover:text-white">
                  Close
                </Button>
              </DialogClose>
              <Button onClick={handleSave} disabled={saving || loading} className="rounded-full bg-[#f4e6cf] px-5 text-[#16110b] hover:bg-[#f0dcc0]">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
