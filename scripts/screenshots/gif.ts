import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const FRAMES_PER_SECOND = 15;
const SMALL_PALETTE_FILTER = `fps=${FRAMES_PER_SECOND},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
const THREAD_LIST = { left: 0, top: 120, width: 360, height: 600 };
const FLAT_BLACK_STDEV = 4;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export function recordingToGif(video: string, gif: string, skipSeconds: number) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(skipSeconds), '-i', video, '-vf', SMALL_PALETTE_FILTER, '-loop', '0', gif], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

export async function firstFrameShowsThreads(gif: string) {
  const frame = spawnSync('ffmpeg', ['-v', 'error', '-i', gif, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: MAX_FRAME_BYTES });
  const { channels } = await sharp(frame.stdout).extract(THREAD_LIST).stats();
  return channels.some((channel) => channel.stdev > FLAT_BLACK_STDEV);
}
