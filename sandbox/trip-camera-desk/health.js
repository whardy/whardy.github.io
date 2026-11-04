// California checks describe a dated endpoint audit. Browser playback is a
// separate, session-only observation shared by views of the same media URL.
const session = new Map();
const defaultLifetime = status => status === 'unavailable' ? 2 * 86400_000 : 7 * 86400_000;
const key = (camera, kind) => `${kind}:${kind === 'video' ? camera.videoUrl : camera.imageUrl}`;
const timestamp = value => { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; };

export function mediaCheck(camera, kind, now = Date.now()) {
  const url = kind === 'video' ? camera.videoUrl : camera.imageUrl;
  if (!url) return {status:'absent', verificationMethod:null, checkedAt:null, expiresAt:null, reason:''};
  const recent = session.get(key(camera, kind));
  if (recent) {
    if(now < timestamp(recent.expiresAt))return {...recent, session:true};
    session.delete(key(camera, kind));
  }
  const audit = camera.state === 'CA' ? camera.mediaHealth?.[kind === 'video' ? 'video' : 'snapshot'] : null;
  if (!audit) return {status:'unchecked', verificationMethod:null, checkedAt:null, expiresAt:null, reason:'This media has no complete recent check.'};
  const checkedAt = timestamp(audit.checkedAt);
  const expiresAt = timestamp(audit.expiresAt) || (checkedAt ? checkedAt + defaultLifetime(audit.status) : 0);
  if (!checkedAt || now >= expiresAt) return {...audit, status:'expired', expiresAt:expiresAt ? new Date(expiresAt).toISOString() : null};
  return audit;
}

export function recordMediaResult(camera, kind, status, detail = '', extra = {}) {
  if (camera.state !== 'CA' || !(kind === 'video' ? camera.videoUrl : camera.imageUrl)) return;
  // Policy blocks and deliberate stops are playback states, not source failures.
  if (!['available','unavailable'].includes(status)) return;
  const checkedAt = new Date().toISOString();
  const previous=session.get(key(camera,kind));
  session.set(key(camera, kind), {
    status, verificationMethod:extra.verificationMethod || (kind === 'video' ? status==='available'?'browser-playback':'browser-playback-attempt' : status==='available'?'browser-image-decoded':'browser-image-attempt'),
    checkedAt, expiresAt:new Date(Date.now() + (status==='unavailable'?10:30)*60_000).toISOString(),
    lastSuccessAt:status==='available'?checkedAt:previous?.lastSuccessAt||null,
    lastFailureAt:status==='unavailable'?checkedAt:previous?.lastFailureAt||null,
    reason:detail, failureCategory:status === 'unavailable' ? extra.failureCategory || detail || 'browser-playback' : null,
    verifiedNonPlaceholder:extra.verifiedNonPlaceholder ?? null,
  });
}

export function californiaHealth(camera, now = Date.now()) {
  const video = mediaCheck(camera, 'video', now), snapshot = mediaCheck(camera, 'snapshot', now);
  const videoReady = video.status === 'available' && ['ffmpeg-decoded-segment','browser-playback'].includes(video.verificationMethod);
  const videoHere = video.status === 'available' && video.verificationMethod === 'browser-playback';
  const snapshotHere = snapshot.status === 'available' && ['image-decoded','browser-image-decoded'].includes(snapshot.verificationMethod);
  const embedded = !!(camera.videoUrl || camera.imageUrl);
  const allFailed = embedded && [camera.videoUrl ? video : null,camera.imageUrl ? snapshot : null].filter(Boolean).every(check => check.status === 'unavailable');
  // A provider outage flag or a verified maintenance image remains visible in
  // Unavailable unless another embedded method has actually decoded.
  const unavailable = embedded && !videoReady && !snapshotHere &&
    (allFailed || camera.sourceDisabled === true || camera.disabled === true ||
      snapshot.status === 'unavailable' && snapshot.failureCategory === 'placeholder');
  return {
    video, snapshot, working:videoHere || snapshotHere, checkedVideo:videoReady,
    workingSnapshot:snapshotHere, official:!embedded,
    unchecked:embedded && !videoReady && !snapshotHere && !unavailable,
    unavailable,
  };
}

export function matchesCaliforniaHealth(camera, value, now = Date.now()) {
  if (camera.state !== 'CA' || !value || value === 'all') return true;
  const health = californiaHealth(camera, now);
  return ({working:health.working,video:health.checkedVideo,snapshot:health.workingSnapshot,
    unchecked:health.unchecked,unavailable:health.unavailable,official:health.official})[value] ?? true;
}

export function healthDescription(camera, now = Date.now()) {
  const health = californiaHealth(camera, now);
  const describe = (check, kind) => {
    if (check.status === 'absent') return null;
    if (check.status === 'expired') return `${kind}: not recently checked (last ${check.checkedAt || 'unknown'})`;
    if (check.status === 'unchecked') return `${kind}: not recently checked`;
    const method = ({'image-decoded':'decoded image','browser-image-decoded':'decoded in this browser',
      'ffmpeg-decoded-segment':'decoded segment','browser-playback':'advanced in this browser this visit',
      'browser-playback-attempt':'playback attempt in this browser','browser-image-attempt':'image request in this browser',
      'browser-placeholder-probes':'Caltrans maintenance-image pixels',
      'hls-segment-structure':'playlist and segment structure only','image-structure':'image structure only'})[check.verificationMethod] || check.verificationMethod || 'method unreported';
    return `${kind}: ${check.status === 'available' ? 'checked' : 'failed'} (${method})${check.status === 'unavailable' && (check.failureCategory || check.reason) ? ` · ${check.failureCategory || check.reason}` : ''}${check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleString()}` : ''}`;
  };
  return [describe(health.video,'Video'),describe(health.snapshot,'Snapshot')].filter(Boolean).join(' · ') || 'Official viewer only';
}
