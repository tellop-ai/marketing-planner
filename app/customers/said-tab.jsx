'use client';

import { Download, ImagePlus, Pencil, Plus, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { channelLabel } from './choices.js';
import { CommentDialog, screenshotAddress } from './comment-dialog.jsx';
import { ReviewCard } from './review-card.jsx';
import { sendUnconfirmed } from '../send.js';
import { ShowMore, usePages } from './show-more.jsx';

/** How a permission looks as a chip. */
const PERMISSION_LOOK = Object.freeze({ yes: 'default', no: 'destructive', asked: 'secondary', 'not-asked': 'outline' });

/** A new post's name from a comment, cut to the longest name a post takes. */
function postNameOf(comment, locale) {
  const name = String(comment.name ?? '').trim();
  const words = name ? t('comments.postName', locale, { name }) : t('comments.postNameSomeone', locale);
  return Array.from(words).slice(0, LIMITS.name).join('').trim();
}

/**
 * What they said: Ask for a review, the comments as cards (the best line
 * large, the words, who, the stars, where and when, the permission as a chip),
 * Add and edit in a window, and Make a post on a comment the customer said Yes
 * to: a new post with the comment's card as its picture, opened in the maker.
 * The comments come in pages: the first, then Show more.
 *
 * @param {{ locale: string, today: string, comments: import('../../lib/data/customers.js').Comment[], next: string | null,
 *   networks: string[], business: string, reviewLink: string }} props
 */
export function SaidTab({ locale, today, comments, next, networks, business, reviewLink }) {
  const router = useRouter();
  const pages = usePages({ first: comments, next, path: '/api/comments' });
  const [editing, setEditing] = useState(/** @type {object | null} */ (null));
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [making, setMaking] = useState(/** @type {number | null} */ (null));

  function startAdd() {
    setNotice(null);
    setProblem(null);
    setEditing(null);
    setOpen(true);
  }

  function startEdit(comment) {
    setNotice(null);
    setProblem(null);
    setEditing(comment);
    setOpen(true);
  }

  /** @param {string} key what the dialog confirmed */
  function done(key) {
    setOpen(false);
    setEditing(null);
    setNotice(key);
    router.refresh();
  }

  async function makePost(comment) {
    setNotice(null);
    setProblem(null);
    setMaking(comment.id);
    const made = await sendUnconfirmed('/api/posts', 'POST', { name: postNameOf(comment, locale) });
    const postId = made.ok ? made.value?.post?.id : undefined;
    if (typeof postId !== 'number') {
      setMaking(null);
      setProblem(made.ok ? 'error.saveUnconfirmed' : made.problem);
      return;
    }
    const picture = await sendUnconfirmed(`/api/posts/${postId}/pictures`, 'POST', { source: 'card', commentId: comment.id });
    if (!picture.ok || typeof picture.value?.picture?.id !== 'number') {
      // A post without its card is not what the press asked for: take it away again.
      await sendUnconfirmed(`/api/posts/${postId}`, 'DELETE');
      setMaking(null);
      setProblem(picture.ok ? 'error.saveUnconfirmed' : picture.problem);
      return;
    }
    router.push(`/posts/${postId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" onClick={startAdd}>
            <Plus aria-hidden="true" />
            {t('comments.add', locale)}
          </Button>
        </div>
      </div>

      {notice && <p role="status" className="text-sm text-muted-foreground">{t(notice, locale)}</p>}
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}

      <ReviewCard locale={locale} business={business} reviewLink={reviewLink} />

      {pages.items.length === 0 ? (
        <Empty className="border border-dashed py-10">
          <EmptyHeader>
            <EmptyTitle>{t('comments.empty', locale)}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pages.items.map((comment) => (
            <li key={comment.id} className="min-w-0">
              <CommentCard
                comment={comment}
                locale={locale}
                busy={making !== null}
                making={making === comment.id}
                onEdit={() => startEdit(comment)}
                onMakePost={() => makePost(comment)}
              />
            </li>
          ))}
        </ul>
      )}
      <ShowMore locale={locale} pages={pages} />

      <CommentDialog
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setEditing(null); }}
        comment={editing}
        locale={locale}
        today={today}
        networks={networks}
        onDone={done}
      />
    </div>
  );
}

function CommentCard({ comment, locale, busy, making, onEdit, onMakePost }) {
  const who = comment.name || t('comments.someone', locale);
  return (
    <Card className="h-full gap-3 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        {comment.bestLine && <p className="text-base font-semibold leading-snug">“{comment.bestLine}”</p>}
        <p className="line-clamp-5 whitespace-pre-line text-sm text-muted-foreground">{comment.text}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{who}</span>
          {comment.stars !== null && (
            <span className="flex items-center" role="img" aria-label={t('comments.starsLabel', locale, { count: String(comment.stars) })}>
              {Array.from({ length: comment.stars }, (_, index) => (
                <Star key={index} aria-hidden="true" className="size-3.5 fill-chart-1 text-chart-1" />
              ))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{channelLabel(comment.source, locale)} · {formatDate(comment.receivedOn, locale)}</span>
          <Badge variant={PERMISSION_LOOK[comment.permission] ?? 'outline'}>{t(`comments.chip.${comment.permission}`, locale)}</Badge>
        </div>
        {comment.screenshot && <Screenshot comment={comment} locale={locale} />}
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap items-center gap-2 px-4">
        {comment.permission === 'yes' && (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onMakePost}>
            <ImagePlus aria-hidden="true" />
            {making ? t('comments.making', locale) : t('comments.makePost', locale)}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {t('comments.edit', locale)}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The comment's own screenshot, small; a download where this browser cannot show it (rule 6c). */
function Screenshot({ comment, locale }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <a href={screenshotAddress(comment, true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
        <Download aria-hidden="true" className="size-3.5" />
        {t('comments.screenshotDownload', locale)}
      </a>
    );
  }
  return (
    <img
      src={screenshotAddress(comment)}
      alt={t('comments.field.screenshot', locale)}
      onError={() => setBroken(true)}
      className="size-16 rounded-md object-cover ring-1 ring-foreground/10"
    />
  );
}
