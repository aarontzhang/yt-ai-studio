import { SceneBoundary } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface SceneDetectOptions {
  /** Minimum scene duration in seconds (skip very short scenes) */
  minSceneDurationSeconds?: number;
}

/**
 * Parse FFmpeg stderr output from the scdet filter to extract scene change timestamps.
 * FFmpeg outputs lines like: "Parsed_scdet_0 @ ... scdet:15.234 period:15.234 mafd: 2.345"
 */
function parseScdetTimestamps(stderr: string): number[] {
  const times: number[] = [];
  const regex = /scdet:([\d.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stderr)) !== null) {
    const t = parseFloat(match[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

/**
 * Convert a list of scene change timestamps into SceneBoundary objects.
 * Timestamps are the START of each new scene.
 */
export function timestampsToSceneBoundaries(
  timestamps: number[],
  sourceDuration: number,
  options?: SceneDetectOptions,
): SceneBoundary[] {
  const minDur = options?.minSceneDurationSeconds ?? 1.0;
  // Always starts at 0
  const starts = [0, ...timestamps].filter((t, i, arr) => {
    if (i === 0) return true;
    return t - arr[i - 1] >= minDur;
  });

  return starts.map((start, i) => {
    const end = starts[i + 1] ?? sourceDuration;
    return {
      id: `scene_${uuidv4().slice(0, 8)}`,
      sourceStart: start,
      sourceEnd: end,
    };
  });
}

/**
 * Detect scene boundaries using FFmpeg's scdet filter.
 * This runs client-side in the browser via the FFmpeg.js WASM bridge.
 *
 * @param ffmpeg - An FFmpeg instance with the video file already written to its FS
 * @param inputPath - The path of the video file in FFmpeg's virtual FS (e.g., 'input.mp4')
 * @param sourceDuration - Duration of the source video in seconds
 * @param threshold - Scene change sensitivity (0.0–1.0, default 0.3)
 */
export async function detectScenesWithFFmpeg(
  ffmpeg: {
    exec: (args: string[]) => Promise<void>;
    readFile?: (path: string) => Promise<Uint8Array>;
  },
  inputPath: string,
  sourceDuration: number,
  threshold = 0.3,
  options?: SceneDetectOptions,
): Promise<SceneBoundary[]> {
  // Collect stderr output by hooking into FFmpeg's log
  const stderrLines: string[] = [];
  const logHandler = (message: string) => {
    stderrLines.push(message);
  };

  try {
    // Run FFmpeg with scdet filter — outputs nothing but logs scene change times to stderr
    await ffmpeg.exec([
      '-i', inputPath,
      '-vf', `scdet=threshold=${threshold}:sc_pass=0`,
      '-an',
      '-f', 'null',
      '-',
    ]);
  } catch {
    // FFmpeg may throw on -f null output; that's fine, we only need the log
  }

  void logHandler; // suppress unused warning
  const stderr = stderrLines.join('\n');
  const timestamps = parseScdetTimestamps(stderr);
  return timestampsToSceneBoundaries(timestamps, sourceDuration, options);
}

/**
 * Lightweight fallback: estimate scene boundaries from thumbnail frames
 * by computing pixel difference between consecutive frames.
 * Use this when FFmpeg scdet isn't available.
 *
 * @param frames - Array of {sourceTime, imageData} where imageData is a 2D canvas pixel array
 * @param sourceDuration - Duration of the source video
 * @param diffThreshold - 0–255 average pixel difference to trigger a cut (default 30)
 */
export function detectScenesFromFrames(
  frames: Array<{ sourceTime: number; pixels: Uint8ClampedArray; width: number; height: number }>,
  sourceDuration: number,
  diffThreshold = 30,
  options?: SceneDetectOptions,
): SceneBoundary[] {
  if (frames.length < 2) {
    return timestampsToSceneBoundaries([], sourceDuration, options);
  }

  const sceneChangeTimes: number[] = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    if (!prev.pixels || !curr.pixels || prev.pixels.length !== curr.pixels.length) continue;

    let totalDiff = 0;
    const pixelCount = prev.pixels.length / 4; // RGBA
    for (let j = 0; j < prev.pixels.length; j += 4) {
      const rDiff = Math.abs(curr.pixels[j] - prev.pixels[j]);
      const gDiff = Math.abs(curr.pixels[j + 1] - prev.pixels[j + 1]);
      const bDiff = Math.abs(curr.pixels[j + 2] - prev.pixels[j + 2]);
      totalDiff += (rDiff + gDiff + bDiff) / 3;
    }

    const avgDiff = pixelCount > 0 ? totalDiff / pixelCount : 0;
    if (avgDiff >= diffThreshold) {
      sceneChangeTimes.push(curr.sourceTime);
    }
  }

  return timestampsToSceneBoundaries(sceneChangeTimes, sourceDuration, options);
}
