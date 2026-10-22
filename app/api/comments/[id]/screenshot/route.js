import { fileResponse } from '../../../../../lib/data/files.js';
import { recordId, screenshotFileFor } from '../../../../../lib/data/customers.js';
import { OWNER } from '../../../../../lib/plan/owner.js';

/**
 * A comment's screenshot, read from this owner's comment (AGENTS.md rule 6c):
 * shown in place, or with `?download=1` the original as a file to save (for a
 * browser that cannot show it). Not found when the comment has none.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(request, context) {
  const { id } = await context.params;
  const commentId = recordId(id);
  let file = null;
  try {
    file = commentId === null ? null : await screenshotFileFor(OWNER, commentId);
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const download = new URL(request.url).searchParams.get('download') === '1';
  return fileResponse(file, request, download ? { use: 'download' } : {});
}
