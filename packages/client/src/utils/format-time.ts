/**
 * Format a duration between two timestamps as a human-readable string.
 * If endMs is null, uses Date.now() as the end time.
 * Returns e.g. "45s", "2m 30s", "2m"
 */
export function formatDuration(startMs: number, endMs: number | null): string {
  const end = endMs ?? Date.now();
  const secs = Math.round((end - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

/**
 * Format raw milliseconds as a human-readable duration with escalating units.
 * Returns e.g. "45s", "5m", "2.0h", "1.5d", or "—" for zero/negative.
 */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return '\u2014';
  const secs = ms / 1000;
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

/**
 * Format elapsed time since a start timestamp as MM:SS.
 * Returns e.g. "2:30", "0:05", "61:01"
 */
export function formatElapsed(startedAt: number): string {
  if (!startedAt) return '0:00';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Format uptime since a start timestamp as human-readable text.
 * Returns e.g. "45s", "5m 30s", "2h 15m"
 */
export function formatUptime(startedAt: number): string {
  if (!startedAt) return '0s';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
