export function sourceRegionToTrackTime(track, region) {
  const rate = 2 ** (Number(track?.effects?.pitchSemitones || 0) / 12);
  const trimStart = Math.max(0, Number(track?.trimStart || 0));
  const start = Math.max(0, Number(region?.startSeconds || 0) - trimStart) / rate;
  const end = Math.max(0, Number(region?.endSeconds || 0) - trimStart) / rate;
  return { start, end: Math.max(start, end) };
}

export function sourceRegionToTimeline(track, region) {
  const local = sourceRegionToTrackTime(track, region);
  const offset = Math.max(0, Number(track?.offset || 0));
  return { start: offset + local.start, end: offset + local.end };
}

export function sourceRegionsToTrackTime(track, events = []) {
  return (Array.isArray(events) ? events : []).map((event) => {
    const local = sourceRegionToTrackTime(track, event);
    return { ...event, startSeconds: local.start, endSeconds: local.end };
  });
}
