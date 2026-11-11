// Fixed browse diagnostics only: never copy browser text or exception
// messages to logs. Shared vocabulary between the log/telemetry layer and
// any plugin that rejects a browse decision.
export const browseRejectionReasons = new Set(['task_time_limit', 'session_stopped', 'observation_invalid', 'archive_required', 'stop_not_allowed', 'page_blocked', 'social_panel_open', 'video_missing', 'video_changed', 'share_not_allowed']);

export function rejectBrowseDecision(reason, error) {
  if (!browseRejectionReasons.has(reason)) throw Error('Unknown browse rejection');
  return { result: { ok: false, rejected: true, reason, error } };
}
