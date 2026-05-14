import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface RenderVideoOptions {
  file: File;
  start: number;
  end: number;
  contrast: number;
  saturation: number;
  addShortsFrame: boolean;
  onProgress?: (progress: number) => void;
}

let ffmpeg: FFmpeg | null = null;
let loadingPromise: Promise<void> | null = null;

async function getFFmpeg(onProgress?: (progress: number) => void) {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
    });
  }

  if (!ffmpeg.loaded) {
    loadingPromise ??= loadFFmpeg(ffmpeg);
    await loadingPromise;
  }

  return ffmpeg;
}

async function loadFFmpeg(instance: FFmpeg) {
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';

  await instance.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
}

function secondsToTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const wholeSeconds = Math.floor(safeSeconds);
  const millis = Math.round((safeSeconds - wholeSeconds) * 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export async function renderEditedVideo(options: RenderVideoOptions) {
  const instance = await getFFmpeg(options.onProgress);
  const inputName = `input-${Date.now()}.mp4`;
  const outputName = `creator-pro-${Date.now()}.mp4`;
  const duration = Math.max(1, options.end - options.start);
  const videoFilters = [
    options.addShortsFrame ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black' : 'scale=1280:-2',
    `eq=contrast=${options.contrast.toFixed(2)}:saturation=${options.saturation.toFixed(2)}`,
    'fps=30',
    'format=yuv420p',
  ];

  await instance.writeFile(inputName, await fetchFile(options.file));

  const exitCode = await instance.exec([
    '-ss',
    secondsToTimestamp(options.start),
    '-t',
    secondsToTimestamp(duration),
    '-i',
    inputName,
    '-vf',
    videoFilters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputName,
  ]);

  if (exitCode !== 0) {
    throw new Error('Video render failed. Try a shorter clip or a smaller file.');
  }

  const data = await instance.readFile(outputName);
  await instance.deleteFile(inputName);
  await instance.deleteFile(outputName);

  return URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
}
