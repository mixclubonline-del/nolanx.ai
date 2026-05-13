"use client";

import React from 'react';
import { Check, Save, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';

interface SaveIndicatorProps {
  isSaving: boolean;
  lastSaveTime: Date | null;
  error?: string | null;
}

export function SaveIndicator({ isSaving, lastSaveTime, error }: SaveIndicatorProps) {
  const { t, i18n } = useTranslation();

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat(i18n.language || 'en', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
        <AlertCircle className="w-3 h-3" />
        <span className="text-xs font-medium">{t('canvas:timeline.saveIndicator.saveFailed')}</span>
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400">
        <Save className="w-3 h-3 " />
        <span className="text-xs font-medium">{t('canvas:timeline.saveIndicator.saving')}</span>
      </div>
    );
  }

  if (lastSaveTime) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400">
        <Check className="w-3 h-3" />
        <span className="text-xs font-medium">
          {t('canvas:timeline.saveIndicator.savedAt', { time: formatTime(lastSaveTime) })}
        </span>
      </div>
    );
  }

  return null;
}
