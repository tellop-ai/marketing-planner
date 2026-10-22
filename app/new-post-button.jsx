'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { t } from '../lib/i18n/index.js';

import { send } from './send.js';

/**
 * Makes a new post (on `day` when one is given) and opens it in the post
 * maker. Nothing is made until the press; a refusal shows its words beside the
 * button and the person can press again.
 *
 * @param {{ locale: string, day?: string, label?: string, className?: string, variant?: string }} props
 */
export function NewPostButton({ locale, day, label, className, variant = 'default' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function make() {
    setPending(true);
    setProblem(null);
    try {
      const sent = await send('/api/posts', 'POST', day ? { day } : {});
      if (!sent.ok || typeof sent.value?.post?.id !== 'number') {
        setProblem(sent.ok ? 'error.saveFailed' : sent.problem);
        return;
      }
      router.push(`/posts/${sent.value.post.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant={variant} className={className} disabled={pending} onClick={make}>
        <Plus aria-hidden="true" />
        {label ?? t('shell.newPost', locale)}
      </Button>
      {problem && <p role="alert" className="text-xs text-destructive">{t(problem, locale)}</p>}
    </div>
  );
}
