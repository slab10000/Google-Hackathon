import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
const FFMPEG_BASE_PATH = "/ffmpeg";

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    try {
      await instance.load({
        // Serve ffmpeg core assets from the app so the module worker can import
        // them directly without the blob: URL resolution issue in Next/Turbopack.
        coreURL: `${FFMPEG_BASE_PATH}/ffmpeg-core.js`,
        wasmURL: `${FFMPEG_BASE_PATH}/ffmpeg-core.wasm`,
      });
    } catch (err) {
      // Reset so it can be retried
      loadPromise = null;
      throw new Error(`Failed to load ffmpeg.wasm: ${err instanceof Error ? err.message : err}`);
    }
    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
}

export async function extractAudio(
  videoData: Uint8Array,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg();
  if (onProgress) {
    ff.on("progress", ({ progress }) => onProgress(progress));
  }
  await ff.writeFile("input.mp4", videoData);
  await ff.exec([
    "-i", "input.mp4",
    "-vn",
    "-acodec", "libmp3lame",
    "-ar", "16000",
    "-ac", "1",
    "-b:a", "64k",
    "audio.mp3",
  ]);
  const data = await ff.readFile("audio.mp3");
  await ff.deleteFile("input.mp4");
  await ff.deleteFile("audio.mp3");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Blob([data as any], { type: "audio/mp3" });
}
