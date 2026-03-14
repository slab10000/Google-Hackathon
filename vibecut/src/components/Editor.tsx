"use client";
import { useState, useCallback, useMemo, useEffect } from "react";
import { TranscriptSegment, EditCommandResponse } from "@/types";
import { rankByRelevance } from "@/lib/embeddings";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import { useTimeline } from "@/hooks/useTimeline";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { useTranscript } from "@/hooks/useTranscript";
import VideoUpload from "./VideoUpload";
import VideoPlayer from "./VideoPlayer";
import TranscriptPanel from "./TranscriptPanel";
import Timeline from "./Timeline";
import CommandInput from "./CommandInput";
import ImageGenPanel from "./ImageGenPanel";
import ExportButton from "./ExportButton";
import { v4 as uuid } from "uuid";

type AppStage = "upload" | "processing" | "editing";

export default function Editor() {
  const [stage, setStage] = useState<AppStage>("upload");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ id: string; score: number }[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditProcessing, setIsEditProcessing] = useState(false);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState("");
  const [embeddingsReady, setEmbeddingsReady] = useState(false);

  const { videoRef, currentTime, duration, isPlaying, seek, togglePlay } = useVideoPlayer();
  const { timeline, dispatch } = useTimeline();
  const { isLoading: ffmpegLoading, progress: ffmpegProgress, extractAudioFromVideo } = useFFmpeg();
  const { segments, isTranscribing, transcribe, updateEmbeddings } = useTranscript();

  // Calculate playhead position mapped to timeline
  const playheadPosition = useMemo(() => {
    if (timeline.clips.length === 0 || duration === 0) return 0;
    // Map current video time to timeline position
    let pos = 0;
    for (const clip of timeline.clips) {
      if (clip.type === "video") {
        if (currentTime >= clip.startTime && currentTime <= clip.endTime) {
          pos += currentTime - clip.startTime;
          break;
        } else if (currentTime > clip.endTime) {
          pos += clip.duration;
        } else {
          break;
        }
      } else {
        pos += clip.duration;
      }
    }
    return pos;
  }, [currentTime, timeline.clips, duration]);

  // Handle video selection
  const handleVideoSelected = useCallback(
    async (file: File, url: string) => {
      setVideoFile(file);
      setVideoUrl(url);
      setStage("processing");

      try {
        // Step 1: Extract audio
        setProcessingStatus("Loading video processor...");
        const audioBlob = await extractAudioFromVideo(file);

        // Step 2: Transcribe
        setProcessingStatus("Transcribing audio...");
        const segs = await transcribe(audioBlob);

        // Step 3: Set up timeline
        // We need to wait for video metadata to get duration
        const tempVideo = document.createElement("video");
        tempVideo.src = url;
        await new Promise<void>((resolve) => {
          tempVideo.onloadedmetadata = () => {
            dispatch({ type: "SET_ORIGINAL", url, duration: tempVideo.duration });
            resolve();
          };
        });

        setStage("editing");

        // Step 4: Compute embeddings (in background)
        setProcessingStatus("Computing semantic embeddings...");
        if (segs && segs.length > 0) {
          try {
            const res = await fetch("/api/embeddings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ texts: segs.map((s: TranscriptSegment) => s.text) }),
            });
            if (res.ok) {
              const { embeddings } = await res.json();
              updateEmbeddings(embeddings);
              setEmbeddingsReady(true);
            }
          } catch {
            // Embeddings are optional, continue without them
          }
        }
        setProcessingStatus("");
      } catch (err) {
        console.error(err);
        setProcessingStatus(`Error: ${err instanceof Error ? err.message : "Processing failed"}`);
      }
    },
    [extractAudioFromVideo, transcribe, dispatch, updateEmbeddings]
  );

  // Handle semantic search
  const handleSearch = useCallback(
    async (query: string) => {
      if (!embeddingsReady) return;
      setIsSearching(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error("Search failed");
        const { embedding } = await res.json();
        const segsWithEmbeddings = segments
          .filter((s) => s.embedding)
          .map((s) => ({ id: s.id, embedding: s.embedding! }));
        const results = rankByRelevance(embedding, segsWithEmbeddings);
        setSearchResults(results);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    },
    [segments, embeddingsReady]
  );

  // Handle segment selection toggle
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Handle remove selected
  const handleRemoveSelected = useCallback(() => {
    const selectedSegs = segments.filter((s) => selectedSegmentIds.has(s.id));
    if (selectedSegs.length > 0) {
      dispatch({ type: "REMOVE_SEGMENTS", segments: selectedSegs });
      setSelectedSegmentIds(new Set());
    }
  }, [segments, selectedSegmentIds, dispatch]);

  // Handle NL edit command
  const handleEditCommand = useCallback(
    async (command: string) => {
      setIsEditProcessing(true);
      setLastExplanation(null);
      try {
        const res = await fetch("/api/edit-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command,
            transcript: segments.map((s) => ({
              id: s.id,
              startTime: s.startTime,
              endTime: s.endTime,
              text: s.text,
            })),
            timeline: {
              clips: timeline.clips.map((c) => ({
                id: c.id,
                type: c.type,
                startTime: c.startTime,
                endTime: c.endTime,
                duration: c.duration,
              })),
              totalDuration: timeline.totalDuration,
            },
          }),
        });

        if (!res.ok) throw new Error("Edit command failed");
        const data: EditCommandResponse = await res.json();
        setLastExplanation(data.explanation);

        // Apply operations
        for (const op of data.operations) {
          switch (op.type) {
            case "remove_time_range":
              if (op.startTime !== undefined && op.endTime !== undefined) {
                dispatch({
                  type: "REMOVE_SEGMENTS",
                  segments: [
                    {
                      id: "temp",
                      startTime: op.startTime,
                      endTime: op.endTime,
                      text: "",
                    },
                  ],
                });
              }
              break;
            case "keep_only_ranges": {
              const ranges = (op as unknown as { ranges: { startTime: number; endTime: number }[] }).ranges;
              if (ranges) {
                const newClips = ranges.map((r) => ({
                  id: uuid(),
                  type: "video" as const,
                  startTime: r.startTime,
                  endTime: r.endTime,
                  duration: r.endTime - r.startTime,
                }));
                dispatch({ type: "APPLY_EDIT", clips: newClips });
              }
              break;
            }
            case "insert_image":
              if (op.prompt) {
                // Generate image and insert
                const imgRes = await fetch("/api/generate-image", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ prompt: op.prompt }),
                });
                if (imgRes.ok) {
                  const { imageBase64, mimeType } = await imgRes.json();
                  const src = `data:${mimeType};base64,${imageBase64}`;
                  // Find clip closest to afterTime
                  let afterClipId: string | null = null;
                  if (op.afterTime !== undefined) {
                    let acc = 0;
                    for (const c of timeline.clips) {
                      acc += c.duration;
                      if (acc >= op.afterTime) {
                        afterClipId = c.id;
                        break;
                      }
                    }
                  }
                  dispatch({
                    type: "INSERT_IMAGE",
                    afterClipId,
                    imageSrc: src,
                    duration: op.duration || 3,
                  });
                }
              }
              break;
            case "reorder": {
              const reorderOp = op as unknown as { fromIndex: number; toIndex: number };
              if (reorderOp.fromIndex !== undefined && reorderOp.toIndex !== undefined) {
                dispatch({
                  type: "REORDER_CLIP",
                  fromIndex: reorderOp.fromIndex,
                  toIndex: reorderOp.toIndex,
                });
              }
              break;
            }
          }
        }
      } catch (err) {
        console.error(err);
        setLastExplanation("Failed to process command. Please try again.");
      } finally {
        setIsEditProcessing(false);
      }
    },
    [segments, timeline, dispatch]
  );

  // Handle image insert
  const handleInsertImage = useCallback(
    (imageSrc: string) => {
      dispatch({
        type: "INSERT_IMAGE",
        afterClipId: selectedClipId || (timeline.clips.length > 0 ? timeline.clips[timeline.clips.length - 1].id : null),
        imageSrc,
        duration: 3,
      });
    },
    [dispatch, selectedClipId, timeline.clips]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePlay]);

  // Upload screen
  if (stage === "upload") {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-950 to-gray-900">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-2">
            <span className="text-violet-400">Vibe</span>Cut
          </h1>
          <p className="text-white/40 text-lg">Edit video by editing meaning</p>
        </div>
        <div className="w-full max-w-2xl">
          <VideoUpload onVideoSelected={handleVideoSelected} />
        </div>
      </div>
    );
  }

  // Processing screen
  if (stage === "processing") {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-950 to-gray-900">
        <h1 className="text-3xl font-bold text-white mb-8">
          <span className="text-violet-400">Vibe</span>Cut
        </h1>
        <div className="w-80 space-y-4 text-center">
          <div className="w-12 h-12 border-3 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto" />
          <p className="text-white/60 text-sm">{processingStatus}</p>
          {ffmpegLoading && (
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-violet-500 h-2 rounded-full transition-all"
                style={{ width: `${ffmpegProgress * 100}%` }}
              />
            </div>
          )}
          {isTranscribing && (
            <p className="text-xs text-white/30">This may take a minute for longer videos</p>
          )}
        </div>
      </div>
    );
  }

  // Editor screen
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-gray-950/80 backdrop-blur-sm shrink-0">
        <h1 className="text-lg font-bold">
          <span className="text-violet-400">Vibe</span>Cut
        </h1>
        <div className="flex items-center gap-3">
          {processingStatus && (
            <span className="text-xs text-violet-300/60">{processingStatus}</span>
          )}
          <ImageGenPanel onInsertImage={handleInsertImage} />
          <ExportButton clips={timeline.clips} videoFile={videoFile} />
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Transcript */}
        <div className="w-80 border-r border-white/10 flex flex-col shrink-0">
          <div className="px-3 py-2 border-b border-white/10">
            <h2 className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Transcript
            </h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <TranscriptPanel
              segments={segments}
              currentTime={currentTime}
              selectedIds={selectedSegmentIds}
              onSeek={seek}
              onToggleSelect={handleToggleSelect}
              onRemoveSelected={handleRemoveSelected}
              onSearch={handleSearch}
              searchResults={searchResults}
              isSearching={isSearching}
            />
          </div>
        </div>

        {/* Center: Video */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-4">
            <VideoPlayer
              videoUrl={videoUrl}
              videoRef={videoRef}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onTogglePlay={togglePlay}
              onSeek={seek}
            />
          </div>
        </div>
      </div>

      {/* Bottom: Command + Timeline */}
      <div className="border-t border-white/10 bg-gray-900/50 shrink-0">
        <div className="px-4 py-3">
          <CommandInput
            onSubmit={handleEditCommand}
            isProcessing={isEditProcessing}
            lastExplanation={lastExplanation}
          />
        </div>
        <div className="px-4 pb-3">
          <Timeline
            clips={timeline.clips}
            totalDuration={timeline.totalDuration}
            currentTime={currentTime}
            playheadPosition={playheadPosition}
            onSeek={seek}
            dispatch={dispatch}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>
      </div>
    </div>
  );
}
