import { DataError } from '../../../lib/data/index.js';
import { failed, json } from '../../../lib/plan/reply.js';

/**
 * How the inspiration addresses answer a refusal: with the field it is about
 * when it names one (`{ problem, field }`, 400), so the page shows it under
 * that field; else as every address does (`failed`).
 *
 * @param {unknown} error
 */
export function noteRefusal(error) {
  if (error instanceof DataError && typeof error.field === 'string') return json({ problem: error.messageKey, field: error.field }, 400);
  return failed(error);
}
