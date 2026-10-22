import { fileResponse } from '../../../../../lib/data/files.js';
import { DataError } from '../../../../../lib/data/index.js';
import { idFromPath, pictureFileFor } from '../../../../../lib/data/posts.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { isShapeKey } from '../../../../../lib/plan/shapes.js';

/**
 * A picture's kept file, after reading the owner's picture (`AGENTS.md` rule
 * 6c): `?shape=original` (the default) is the file as it was given (a
 * person's photo is their own file, kept whole and never changed);
 * `?shape=<shape key>` is that shape's kept copy. `&download=1` hands over the
 * file to save instead of showing it. A `v=` value in the address only keeps
 * the browser from showing an older picture. Not found when the picture is
 * another owner's or has no such file.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(request, context) {
  const params = await context?.params;
  const id = idFromPath(params?.id);
  if (id === null) return refused(REFUSED.notFound);
  const query = new URL(request.url).searchParams;
  const shape = query.get('shape') ?? 'original';
  if (shape !== 'original' && !isShapeKey(shape)) return refused(REFUSED.notFound);
  try {
    const digest = await pictureFileFor(OWNER, id, shape);
    if (digest === null) return refused(REFUSED.notFound);
    return await fileResponse(digest, request, query.get('download') === '1' ? { use: 'download' } : {});
  } catch (error) {
    if (!(error instanceof DataError)) return json({ problem: 'error.storageUnreadable' }, 500);
    return failed(error);
  }
}

export const HEAD = GET;
