import { spawnSync } from 'node:child_process';

const FRAMES_PER_SECOND = 15;
const SMALL_PALETTE_FILTER = `fps=${FRAMES_PER_SECOND},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;

export function recordingToGif(video: string, gif: string) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', SMALL_PALETTE_FILTER, '-loop', '0', gif], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}
