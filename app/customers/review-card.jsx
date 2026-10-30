'use client';

import { Copy, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { t } from '../../lib/i18n/index.js';
import { useRights } from '../rights.jsx';

/**
 * Ask for a review: the ready message with the review address from My plan,
 * and two presses: Copy, and Copy and open WhatsApp. The second is a link to
 * WhatsApp's own share address carrying the message; its press starts the
 * copy first, then the link opens in the person's browser. Nothing is sent by
 * the app. With no review address, one line says where to add it.
 *
 * @param {{ locale: string, business: string, reviewLink: string }} props
 */
export function ReviewCard({ locale, business, reviewLink }) {
  // My plan holds the review address: the way there is only for a person who may change it.
  const { change: canChange } = useRights();
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState(false);
  const message = t('comments.ask.message', locale, { link: reviewLink, business: String(business ?? '').trim() }).trim();

  function copy() {
    setCopied(false);
    setProblem(false);
    // Started inside the press, before the link (if any) opens, so the browser allows it.
    const writing = navigator.clipboard?.writeText(message);
    if (!writing) {
      setProblem(true);
      return;
    }
    writing.then(() => setCopied(true), () => setProblem(true));
  }

  return (
    <Card className="py-3">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t('comments.ask.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {reviewLink ? (
          <>
            <p className="max-w-prose whitespace-pre-line text-sm text-muted-foreground">{message}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={copy}>
                <Copy aria-hidden="true" />
                {t('comments.ask.copy', locale)}
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener"
                onClick={copy}
                className={buttonVariants({ variant: 'outline' })}
              >
                <MessageCircle aria-hidden="true" />
                {t('comments.ask.whatsapp', locale)}
              </a>
              {copied && <span role="status" className="text-sm text-muted-foreground">{t('comments.ask.copied', locale)}</span>}
              {problem && <span role="alert" className="text-sm text-destructive">{t('comments.ask.copyFailed', locale)}</span>}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('comments.ask.noLink', locale)}
            {canChange && (
              <>
                {' '}
                <Link href="/plan" className="font-medium text-primary underline-offset-4 hover:underline">{t('comments.ask.toPlan', locale)}</Link>
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
