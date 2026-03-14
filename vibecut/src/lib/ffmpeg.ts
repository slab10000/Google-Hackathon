import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await instance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
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
