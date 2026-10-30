/**
 * Request Tellop's trusted floating dictation control on a real button press.
 * This helper never records, transcribes, reads a target, or inserts app text.
 * A normal browser answers unavailable. Local mode never falls back to online.
 * Call show({ language: 'auto' | 'en' | 'tr', mode: 'local' | 'online' })
 * or hide() directly from a person’s press. Read availability()/status() to
 * refresh the page, including coarse Accessibility readiness.
 * Call openAccessibilitySettings() directly from a press to open that fixed
 * macOS pane. This never grants access or starts recording. Saving these choices does not grant native permission.
 */
const LANGUAGES = new Set(['auto', 'en', 'tr']);
const MODES = new Set(['local', 'online']);
const STATES = new Set(['hidden', 'ready', 'starting', 'recording', 'transcribing', 'inserted', 'transcript', 'failed']);
const READINESS = new Set(['ready', 'absent', 'downloading', 'no-room', 'failed', 'incompatible']);
const REASONS = new Set(['unavailable', 'unsupported', 'permission', 'not-ready', 'busy', 'failed', 'accessibility']);

function unavailable(reason = 'unavailable') { return { ok: false, reason }; }

async function call(method, input) {
  try {
    const bridge = typeof window === 'undefined' ? undefined : window.tellopDictation;
    if (typeof bridge?.[method] !== 'function') return unavailable();
    const answer = await (input === undefined ? bridge[method]() : bridge[method](input));
    if (answer === null || typeof answer !== 'object' || typeof answer.ok !== 'boolean') return unavailable('failed');
    // Only public status fields cross this helper. No transcript or target data.
    const result = { ok: answer.ok };
    if (REASONS.has(answer.reason)) result.reason = answer.reason;
    if (!answer.ok && !result.reason) result.reason = 'failed';
    if (typeof answer.available === 'boolean') result.available = answer.available;
    if (typeof answer.visible === 'boolean') result.visible = answer.visible;
    if (STATES.has(answer.state)) result.state = answer.state;
    if (['granted', 'denied', 'unavailable'].includes(answer.accessibility)) result.accessibility = answer.accessibility;
    if (READINESS.has(answer.readiness)) result.readiness = answer.readiness;
    if (typeof answer.progress === 'number' && Number.isFinite(answer.progress) && answer.progress >= 0 && answer.progress <= 1)
      result.progress = answer.progress;
    return result;
  } catch { return unavailable('failed'); }
}

export async function availability() { return await call('availability'); }
export async function status() { return await call('status'); }
export async function openAccessibilitySettings() { return await call('openAccessibilitySettings'); }
export async function hide() { return await call('hide'); }
export async function show(options = { language: 'auto', mode: 'local' }) {
  if (options === null || typeof options !== 'object' || Array.isArray(options) ||
    Object.keys(options).length !== 2 || !Object.hasOwn(options, 'language') || !Object.hasOwn(options, 'mode') ||
    !LANGUAGES.has(options.language) || !MODES.has(options.mode)) return unavailable('failed');
  return await call('show', { language: options.language, mode: options.mode });
}
