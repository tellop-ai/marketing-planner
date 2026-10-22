'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { t } from '../../lib/i18n/index.js';

/**
 * Asks once before something is removed for good. `title` is the question,
 * already in the reader's words; `problem` is a refusal to show under it.
 *
 * @param {{ locale: string, open: boolean, title: string, pending?: boolean, problem?: string | null,
 *   onClose: () => void, onConfirm: () => void }} props
 */
export function ConfirmRemove({ locale, open, title, pending = false, problem = null, onClose, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
        </AlertDialogHeader>
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('plan.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>{t('plan.remove', locale)}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
