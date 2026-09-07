import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_PRESENTATION_LIMITS = Object.freeze({ maximumSeconds: 180, maximumInputPixels: 3840 * 2160, maximumOutputBytes: 100 * 1024 * 1024, maximumProcessMilliseconds: 180_000 });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const run = (executable, args, timeout = 180_000) => new Promise((resolve, reject) => {
  execFile(executable, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true, env: { LANG: 'C', LC_ALL: 'C' } }, (error, stdout) => {
    if (error) {
      try { const result = JSON.parse(stdout); if (result.error) return reject(Object.assign(new Error(result.message), { code: result.error })); } catch { /* No source data is included in the error. */ }
      return reject(Object.assign(new Error('Le traitement de présentation a dépassé ses limites ou a échoué.'), { code: error.killed ? 'processing_timeout' : 'presentation_processing_failed' }));
    }
    resolve(stdout);
  });
});
const finish = async (path, details) => { const bytes = await readFile(path); return { ...details, bytes, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length }; };

export async function createPdfPresentation({ path, workingDirectory }) {
  const outputPath = join(workingDirectory, 'presentation.pdf');
  const stdout = await run(process.execPath, ['--max-old-space-size=512', fileURLToPath(new URL('./pdf-presentation-worker.mjs', import.meta.url)), path, outputPath], 120_000);
  const result = JSON.parse(stdout);
  return finish(outputPath, result);
}

export function assertSupportedFfmpegVersion(output) {
  const version = /(?:ffmpeg|ffprobe) version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!version) fail('video_runtime_unsupported', 'Version FFmpeg non vérifiable.');
  const [major, minor, patch] = version.slice(1).map(Number);
  // Security-maintained patch floors verified against ffmpeg.org, 2026-09-06.
  const maintained = major >= 9 ? (major > 9 || minor > 0 || patch >= 1)
    : major === 8 ? (minor > 1 || (minor === 1 && patch >= 2) || (minor === 0 && patch >= 3))
    : major === 7 && (minor > 1 || (minor === 1 && patch >= 5));
  if (!maintained) fail('video_runtime_unsupported', 'Le transcodeur vidéo doit être mis à jour avant de traiter ce fichier.');
}

export function validateVideoProbe(data, output = false) {
  const videos = (data.streams || []).filter((stream) => stream.codec_type === 'video');
  const duration = Number(data.format?.duration);
  const video = videos[0];
  if (videos.length !== 1 || !Number.isFinite(duration) || duration <= 0 || duration > VIDEO_PRESENTATION_LIMITS.maximumSeconds
    || !Number.isInteger(video?.width) || !Number.isInteger(video?.height) || video.width <= 0 || video.height <= 0 || video.width * video.height > VIDEO_PRESENTATION_LIMITS.maximumInputPixels) fail('video_limits', 'Une seule piste vidéo de 3 minutes et de résolution 4K au maximum est admise.');
  if (output && (video.codec_name !== 'h264' || (data.streams || []).some((stream) => stream.codec_type !== 'video' && (stream.codec_type !== 'audio' || stream.codec_name !== 'aac')))) fail('unsafe_video_derivative', 'Les pistes de la copie vidéo ne sont pas conformes.');
  if (output) {
    const tags = [data.format?.tags, ...(data.streams || []).map((stream) => stream.tags)];
    const allowedTags = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder', 'language', 'handler_name', 'vendor_id']);
    if (tags.some((tag) => Object.keys(tag || {}).some((key) => !allowedTags.has(key)))) fail('video_metadata_remaining', 'Des métadonnées inattendues subsistent dans la copie vidéo.');
  }
  return { width: video.width, height: video.height, duration };
}

export async function createVideoPresentation({ path, workingDirectory, ffmpegPath = process.env.FFMPEG_PATH, ffprobePath = process.env.FFPROBE_PATH }) {
  if (!ffmpegPath || !ffprobePath || !isAbsolute(ffmpegPath) || !isAbsolute(ffprobePath)) fail('video_runtime_unavailable', 'Transcodeur vidéo sécurisé non configuré : le fichier reste privé.');
  assertSupportedFfmpegVersion(await run(ffmpegPath, ['-version'], 10_000));
  assertSupportedFfmpegVersion(await run(ffprobePath, ['-version'], 10_000));
  const probeArgs = ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2', '-show_streams', '-show_format', '-of', 'json'];
  const source = JSON.parse(await run(ffprobePath, [...probeArgs, path], 20_000));
  const original = validateVideoProbe(source);
  const outputPath = join(workingDirectory, 'presentation.mp4');
  await run(ffmpegPath, ['-nostdin', '-v', 'error', '-xerror', '-max_alloc', '134217728', '-threads', '2', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2', '-i', path,
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1',
    '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-metadata', 'encoder=', '-fs', String(VIDEO_PRESENTATION_LIMITS.maximumOutputBytes), '-y', outputPath], VIDEO_PRESENTATION_LIMITS.maximumProcessMilliseconds);
  if ((await stat(outputPath)).size >= VIDEO_PRESENTATION_LIMITS.maximumOutputBytes) fail('derivative_too_large', 'La copie vidéo dépasse 100 Mio.');
  const result = validateVideoProbe(JSON.parse(await run(ffprobePath, [...probeArgs, outputPath], 20_000)), true);
  if (Math.abs(result.duration - original.duration) > 1) fail('video_incomplete', 'La copie vidéo est incomplète.');
  // Decode every output frame: probing alone is not a decoding check.
  await run(ffmpegPath, ['-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-protocol_whitelist', 'file', '-i', outputPath, '-f', 'null', '-'], 120_000);
  return finish(outputPath, { ...result, mimeType: 'video/mp4', kind: 'video', metadataStripped: true, processingMethod: 'video_transcoded_v1' });
}
