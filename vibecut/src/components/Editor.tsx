"use client";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  DockTab,
  EditCommandResponse,
  LibraryClip,
  MonitorMode,
  TimelineClip,
  TranscriptSegment,
} from "@/types";
import { cosineSimilarity } from "@/lib/embeddings";
import { useTimeline } from "@/hooks/useTimeline";
import { useTranscript } from "@/hooks/useTranscript";
import MediaBin from "./MediaBin";
import VideoPlayer from "./VideoPlayer";
import Timeline from "./Timeline";
import TranscriptPanel from "./TranscriptPanel";
import CommandInput from "./CommandInput";
import ImageGenPanel from "./ImageGenPanel";
import { v4 as uuid } from "uuid";

type SearchHit = { id: string; sourceClipId: string; score: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function placeholderWaveform(seed: string, points = 36) {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }

  return Array.from({ length: points }, (_, index) => {
    const value = Math.sin((hash + index * 13) / 11) * 0.18 + Math.cos((hash + index * 7) / 17) * 0.12;
    return clamp(0.28 + Math.abs(value), 0.18, 0.78);
  });
}

function buildWaveform(segments: TranscriptSegment[], duration: number, points = 36) {
  if (duration <= 0 || segments.length === 0) {
    return Array.from({ length: points }, () => 0.22);
  }

  const bins = Array.from({ length: points }, (_, index) => {
    const binStart = (index / points) * duration;
    const binEnd = ((index + 1) / points) * duration;

    let energy = 0;
    for (const segment of segments) {
      const overlap = Math.max(0, Math.min(segment.endTime, binEnd) - Math.max(segment.startTime, binStart));
      if (overlap <= 0) continue;
      energy += overlap / Math.max(duration / points, 0.25);
      energy += Math.min(segment.text.length / 120, 0.4);
    }

    return clamp(0.18 + Math.min(energy, 1.05) * 0.55, 0.18, 0.95);
  });

  return bins.map((value, index) => {
    const prev = bins[index - 1] ?? value;
    const next = bins[index + 1] ?? value;
    return clamp((prev + value * 2 + next) / 4, 0.18, 0.95);
  });
}

function buildTimelineClip(sourceClipId: string, startTime: number, endTime: number, label?: string): TimelineClip {
  return {
    id: uuid(),
    type: "video",
    sourceClipId,
    sourceStartTime: startTime,
    sourceEndTime: endTime,
    duration: Math.max(0, endTime - startTime),
    label,
  };
}

function getVideoDuration(objectUrl: string) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = objectUrl;
    video.onloadedmetadata = () => resolve(video.duration || 0);
    video.onerror = () => reject(new Error("Failed to load clip metadata"));
  });
}

export default function Editor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const monitorModeRef = useRef<MonitorMode>("source");
  const activeProgramClipRef = useRef<string | null>(null);
  const libraryClipsRef = useRef<LibraryClip[]>([]);
  const sourceTimeRef = useRef(0);
  const programTimeRef = useRef(0);

  const [libraryClips, setLibraryClips] = useState<LibraryClip[]>([]);
  const [selectedSourceClipId, setSelectedSourceClipId] = useState<string | null>(null);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>("source");
  const [dockTab, setDockTab] = useState<DockTab>("ai");
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditProcessing, setIsEditProcessing] = useState(false);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [programTime, setProgramTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const { timeline, dispatch } = useTimeline();
  const { activeJobs, error: transcriptError, transcribe, embedTexts } = useTranscript();

  const clipsWithOffsets = useMemo(() => {
    let sequenceStart = 0;
    return timeline.clips.map((clip) => {
      const start = sequenceStart;
      const end = start + clip.duration;
      sequenceStart = end;
      const source = clip.sourceClipId ? libraryClips.find((item) => item.id === clip.sourceClipId) : undefined;
      return {
        ...clip,
        source,
        sequenceStart: start,
        sequenceEnd: end,
      };
    });
  }, [timeline.clips, libraryClips]);

  const selectedSourceClip = useMemo(
    () => libraryClips.find((clip) => clip.id === selectedSourceClipId) || null,
    [libraryClips, selectedSourceClipId]
  );

  const selectedTimelineClip = useMemo(
    () => timeline.clips.find((clip) => clip.id === selectedTimelineClipId) || null,
    [selectedTimelineClipId, timeline.clips]
  );

  const transcriptSourceClipId = selectedTimelineClip?.sourceClipId || selectedSourceClipId;
  const transcriptClip = useMemo(
    () => libraryClips.find((clip) => clip.id === transcriptSourceClipId) || null,
    [libraryClips, transcriptSourceClipId]
  );

  const allTranscriptSegments = useMemo(
    () => libraryClips.flatMap((clip) => clip.transcriptSegments),
    [libraryClips]
  );

  const searchableSegments = useMemo(
    () => allTranscriptSegments.filter((segment) => segment.embedding),
    [allTranscriptSegments]
  );

  const segmentLookup = useMemo(
    () => new Map(allTranscriptSegments.map((segment) => [segment.id, segment])),
    [allTranscriptSegments]
  );

  const processingCount = useMemo(
    () => libraryClips.filter((clip) => clip.status === "queued" || clip.status === "processing").length,
    [libraryClips]
  );

  const currentProgramPlacement = useMemo(() => {
    if (clipsWithOffsets.length === 0) return null;
    const clampedTime = clamp(programTime, 0, Math.max(timeline.totalDuration - 0.001, 0));
    return (
      clipsWithOffsets.find(
        (clip) => clampedTime >= clip.sequenceStart && clampedTime < clip.sequenceEnd
      ) || clipsWithOffsets[clipsWithOffsets.length - 1]
    );
  }, [clipsWithOffsets, programTime, timeline.totalDuration]);

  const activeTranscriptTime = useMemo(() => {
    if (!transcriptClip) return 0;

    if (selectedTimelineClip?.sourceClipId === transcriptClip.id && selectedTimelineClip.type === "video") {
      if (monitorMode === "program" && currentProgramPlacement?.id === selectedTimelineClip.id) {
        return selectedTimelineClip.sourceStartTime + (programTime - currentProgramPlacement.sequenceStart);
      }
      return selectedTimelineClip.sourceStartTime;
    }

    if (monitorMode === "source" && selectedSourceClipId === transcriptClip.id) {
      return sourceTime;
    }

    if (monitorMode === "program" && currentProgramPlacement?.sourceClipId === transcriptClip.id) {
      return currentProgramPlacement.sourceStartTime + (programTime - currentProgramPlacement.sequenceStart);
    }

    return 0;
  }, [
    currentProgramPlacement,
    monitorMode,
    programTime,
    selectedSourceClipId,
    selectedTimelineClip,
    sourceTime,
    transcriptClip,
  ]);

  const selectedTranscriptRange =
    selectedTimelineClip?.sourceClipId === transcriptSourceClipId && selectedTimelineClip.type === "video"
      ? { startTime: selectedTimelineClip.sourceStartTime, endTime: selectedTimelineClip.sourceEndTime }
      : null;

  const monitorVideoUrl =
    monitorMode === "source"
      ? selectedSourceClip?.objectUrl || null
      : currentProgramPlacement?.type === "video"
      ? currentProgramPlacement.source?.objectUrl || null
      : null;

  const monitorImageSrc =
    monitorMode === "program" && currentProgramPlacement?.type === "image"
      ? currentProgramPlacement.imageSrc || null
      : null;

  const monitorCurrentTime = monitorMode === "program" ? programTime : sourceTime;
  const monitorDuration = monitorMode === "program" ? timeline.totalDuration : selectedSourceClip?.duration || 0;

  const monitorSubtitle =
    monitorMode === "source"
      ? selectedSourceClip?.fileName
      : currentProgramPlacement?.label || currentProgramPlacement?.source?.fileName || "Sequence monitor";

  const setClipState = useCallback((clipId: string, updater: (clip: LibraryClip) => LibraryClip) => {
    setLibraryClips((clips) => clips.map((clip) => (clip.id === clipId ? updater(clip) : clip)));
  }, []);

  const setVideoSource = useCallback((url: string, targetTime: number, autoplay: boolean) => {
    const video = videoRef.current;
    if (!video) return;

    const seekAndPlay = () => {
      const apply = () => {
        try {
          video.currentTime = Math.max(0, targetTime);
        } catch {
          // Ignore seek errors while metadata is still settling.
        }

        if (autoplay) {
          void video.play().catch(() => {
            setIsPlaying(false);
          });
        }
      };

      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    };

    if (video.src !== url) {
      video.pause();
      video.src = url;
      video.load();
      seekAndPlay();
      return;
    }

    seekAndPlay();
  }, []);

  const syncProgramPreview = useCallback(
    (time: number, autoplay: boolean) => {
      const clampedTime = clamp(time, 0, Math.max(timeline.totalDuration, 0));
      setProgramTime(clampedTime);

      const activeClip =
        clipsWithOffsets.find(
          (clip) => clampedTime >= clip.sequenceStart && clampedTime < clip.sequenceEnd
        ) || clipsWithOffsets[clipsWithOffsets.length - 1];

      activeProgramClipRef.current = activeClip?.id || null;

      if (!activeClip) {
        videoRef.current?.pause();
        setIsPlaying(false);
        return;
      }

      if (activeClip.type === "image") {
        videoRef.current?.pause();
        setIsPlaying(false);
        return;
      }

      if (!activeClip.source) return;

      const localTime = activeClip.sourceStartTime + (clampedTime - activeClip.sequenceStart);
      setVideoSource(activeClip.source.objectUrl, localTime, autoplay);
    },
    [clipsWithOffsets, setVideoSource, timeline.totalDuration]
  );

  const syncSourcePreview = useCallback(
    (clip: LibraryClip | null, time: number, autoplay: boolean) => {
      if (!clip) {
        videoRef.current?.pause();
        setIsPlaying(false);
        return;
      }

      setSourceTime(clamp(time, 0, clip.duration || 0));
      setVideoSource(clip.objectUrl, clamp(time, 0, clip.duration || 0), autoplay);
    },
    [setVideoSource]
  );

  const processLibraryClip = useCallback(
    async (clip: LibraryClip) => {
      setClipState(clip.id, (current) => ({ ...current, status: "processing", error: undefined }));

      try {
        const transcriptSegments = await transcribe(clip.file, clip.id);
        const embeddings = await embedTexts(transcriptSegments.map((segment) => segment.text));
        const hydratedSegments = transcriptSegments.map((segment, index) => ({
          ...segment,
          embedding: embeddings[index] || undefined,
        }));
        const waveform = buildWaveform(hydratedSegments, clip.duration);

        setClipState(clip.id, (current) => ({
          ...current,
          status: "ready",
          transcriptSegments: hydratedSegments,
          embeddingsReady: true,
          waveform,
        }));
      } catch (error) {
        setClipState(clip.id, (current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Failed to process clip",
        }));
      }
    },
    [embedTexts, setClipState, transcribe]
  );

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const prepared = await Promise.all(
        files.map(async (file) => {
          const objectUrl = URL.createObjectURL(file);
          let duration = 0;
          try {
            duration = await getVideoDuration(objectUrl);
          } catch {
            duration = 0;
          }

          return {
            id: uuid(),
            file,
            fileName: file.name,
            objectUrl,
            duration,
            status: "queued" as const,
            transcriptSegments: [],
            embeddingsReady: false,
            waveform: placeholderWaveform(file.name),
          };
        })
      );

      if (prepared.length === 0) return;

      setLibraryClips((clips) => [...clips, ...prepared]);
      setSelectedSourceClipId((current) => current || prepared[0].id);
      setDockTab("transcript");

      for (const clip of prepared) {
        void processLibraryClip(clip);
      }
    },
    [processLibraryClip]
  );

  const handleSelectSourceClip = useCallback(
    (clipId: string) => {
      setSelectedSourceClipId(clipId);
      setSelectedTimelineClipId(null);
      setMonitorMode("source");
      setDockTab("transcript");

      const clip = libraryClips.find((item) => item.id === clipId) || null;
      syncSourcePreview(clip, 0, false);
    },
    [libraryClips, syncSourcePreview]
  );

  const handleSelectTimelineClip = useCallback(
    (clipId: string | null) => {
      setSelectedTimelineClipId(clipId);
      if (!clipId) return;

      const clip = clipsWithOffsets.find((item) => item.id === clipId);
      if (!clip) return;

      if (clip.sourceClipId) setSelectedSourceClipId(clip.sourceClipId);
      setMonitorMode("program");
      setDockTab("inspector");
      syncProgramPreview(clip.sequenceStart, false);
    },
    [clipsWithOffsets, syncProgramPreview]
  );

  const handleAppendFromLibrary = useCallback(
    (sourceClipId: string) => {
      const sourceClip = libraryClips.find((clip) => clip.id === sourceClipId);
      if (!sourceClip || sourceClip.status !== "ready") return;

      dispatch({
        type: "ADD_SOURCE_CLIP",
        sourceClipId: sourceClip.id,
        duration: sourceClip.duration,
        label: sourceClip.fileName,
      });

      setSelectedSourceClipId(sourceClip.id);
      setMonitorMode("program");
    },
    [dispatch, libraryClips]
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (searchableSegments.length === 0) return;

      setIsSearching(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });

        if (!res.ok) throw new Error("Search failed");

        const { embedding } = await res.json();
        const results = searchableSegments
          .map((segment) => ({
            id: segment.id,
            sourceClipId: segment.sourceClipId,
            score: cosineSimilarity(embedding, segment.embedding!),
          }))
          .sort((a, b) => b.score - a.score);

        setSearchResults(results);
        setDockTab("transcript");

        const topResult = results[0];
        if (topResult) {
          setSelectedSourceClipId(topResult.sourceClipId);
          setSelectedTimelineClipId(null);
          setMonitorMode("source");
          const segment = segmentLookup.get(topResult.id);
          const clip = libraryClips.find((item) => item.id === topResult.sourceClipId) || null;
          if (segment && clip) syncSourcePreview(clip, segment.startTime, false);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsSearching(false);
      }
    },
    [libraryClips, searchableSegments, segmentLookup, syncSourcePreview]
  );

  const handleToggleSegment = useCallback((segmentId: string) => {
    setSelectedSegmentIds((ids) => {
      const next = new Set(ids);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }, []);

  const handleRemoveSelected = useCallback(() => {
    const selectedSegments = transcriptClip?.transcriptSegments.filter((segment) => selectedSegmentIds.has(segment.id)) || [];
    if (selectedSegments.length === 0) return;

    dispatch({ type: "REMOVE_SEGMENTS", segments: selectedSegments });
    setSelectedSegmentIds(new Set());
    setMonitorMode("program");
  }, [dispatch, selectedSegmentIds, transcriptClip]);

  const handleInsertImage = useCallback(
    (imageSrc: string) => {
      const lastClip = selectedTimelineClipId
        ? timeline.clips.find((clip) => clip.id === selectedTimelineClipId) || null
        : timeline.clips[timeline.clips.length - 1] || null;

      dispatch({
        type: "INSERT_IMAGE",
        afterClipId: lastClip?.id || null,
        imageSrc,
        duration: 3,
        label: "AI still",
      });
      setMonitorMode("program");
    },
    [dispatch, selectedTimelineClipId, timeline.clips]
  );

  const handleEditCommand = useCallback(
    async (command: string) => {
      if (timeline.clips.length === 0) return;

      setIsEditProcessing(true);
      setLastExplanation(null);

      try {
        const activeSourceIds = new Set(
          timeline.clips
            .filter((clip) => clip.type === "video" && clip.sourceClipId)
            .map((clip) => clip.sourceClipId!)
        );

        const transcript = libraryClips
          .filter((clip) => activeSourceIds.has(clip.id))
          .flatMap((clip) =>
            clip.transcriptSegments.map((segment) => ({
              id: segment.id,
              sourceClipId: segment.sourceClipId,
              startTime: segment.startTime,
              endTime: segment.endTime,
              text: segment.text,
            }))
          );

        const res = await fetch("/api/edit-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command,
            transcript,
            timeline: {
              clips: clipsWithOffsets.map((clip, index) => ({
                id: clip.id,
                index,
                type: clip.type,
                label: clip.label || clip.source?.fileName || "Still",
                sourceClipId: clip.sourceClipId,
                sourceStartTime: clip.sourceStartTime,
                sourceEndTime: clip.sourceEndTime,
                sequenceStart: clip.sequenceStart,
                sequenceEnd: clip.sequenceEnd,
                duration: clip.duration,
              })),
              totalDuration: timeline.totalDuration,
            },
          }),
        });

        if (!res.ok) throw new Error("Edit command failed");
        const data: EditCommandResponse = await res.json();
        setLastExplanation(data.explanation);

        for (const operation of data.operations) {
          if (operation.type === "remove_time_range") {
            if (operation.startTime === undefined || operation.endTime === undefined || !operation.sourceClipId) continue;
            dispatch({
              type: "REMOVE_SEGMENTS",
              segments: [
                {
                  id: uuid(),
                  sourceClipId: operation.sourceClipId,
                  startTime: operation.startTime,
                  endTime: operation.endTime,
                  text: "",
                },
              ],
            });
            continue;
          }

          if (operation.type === "keep_only_ranges" && operation.ranges) {
            const nextClips = operation.ranges
              .filter((range) => range.sourceClipId && range.endTime > range.startTime)
              .map((range) => {
                const source = libraryClips.find((clip) => clip.id === range.sourceClipId);
                return buildTimelineClip(range.sourceClipId!, range.startTime, range.endTime, source?.fileName);
              });

            if (nextClips.length > 0) dispatch({ type: "APPLY_EDIT", clips: nextClips });
            continue;
          }

          if (operation.type === "insert_image" && operation.prompt) {
            const imgRes = await fetch("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: operation.prompt }),
            });

            if (!imgRes.ok) continue;

            const { imageBase64, mimeType } = await imgRes.json();
            const src = `data:${mimeType};base64,${imageBase64}`;

            let afterClipId: string | null = null;
            if (operation.afterTime !== undefined) {
              const afterTime = operation.afterTime;
              const clip = clipsWithOffsets.find(
                (item) => afterTime >= item.sequenceStart && afterTime <= item.sequenceEnd
              );
              afterClipId = clip?.id || clipsWithOffsets[clipsWithOffsets.length - 1]?.id || null;
            }

            dispatch({
              type: "INSERT_IMAGE",
              afterClipId,
              imageSrc: src,
              duration: operation.duration || 3,
              label: "AI still",
            });
            continue;
          }

          if (
            operation.type === "reorder" &&
            operation.fromIndex !== undefined &&
            operation.toIndex !== undefined
          ) {
            dispatch({
              type: "REORDER_CLIP",
              fromIndex: operation.fromIndex,
              toIndex: operation.toIndex,
            });
          }
        }

        setMonitorMode("program");
      } catch (error) {
        console.error(error);
        setLastExplanation("Failed to process command. Please try again.");
      } finally {
        setIsEditProcessing(false);
      }
    },
    [clipsWithOffsets, dispatch, libraryClips, timeline.clips, timeline.totalDuration]
  );

  const handleMonitorSeek = useCallback(
    (time: number) => {
      if (monitorMode === "program") {
        syncProgramPreview(time, false);
        return;
      }

      syncSourcePreview(selectedSourceClip, time, false);
    },
    [monitorMode, selectedSourceClip, syncProgramPreview, syncSourcePreview]
  );

  const handleTimelineSeek = useCallback(
    (time: number) => {
      setMonitorMode("program");
      syncProgramPreview(time, false);
    },
    [syncProgramPreview]
  );

  const handleTranscriptSeek = useCallback(
    (time: number) => {
      if (!transcriptClip) return;
      setSelectedSourceClipId(transcriptClip.id);
      setSelectedTimelineClipId(null);
      setMonitorMode("source");
      syncSourcePreview(transcriptClip, time, false);
    },
    [syncSourcePreview, transcriptClip]
  );

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;

    if (monitorMode === "source") {
      if (!selectedSourceClip) return;
      if (!video || video.paused) {
        syncSourcePreview(selectedSourceClip, sourceTime, true);
      } else {
        video.pause();
      }
      return;
    }

    if (!timeline.clips.length) return;
    if (currentProgramPlacement?.type === "image") {
      return;
    }

    if (!video || video.paused) {
      syncProgramPreview(programTime, true);
    } else {
      video.pause();
    }
  }, [
    currentProgramPlacement?.type,
    monitorMode,
    programTime,
    selectedSourceClip,
    sourceTime,
    syncProgramPreview,
    syncSourcePreview,
    timeline.clips.length,
  ]);

  useEffect(() => {
    monitorModeRef.current = monitorMode;
  }, [monitorMode]);

  useEffect(() => {
    activeProgramClipRef.current = currentProgramPlacement?.id || null;
  }, [currentProgramPlacement]);

  useEffect(() => {
    libraryClipsRef.current = libraryClips;
  }, [libraryClips]);

  useEffect(() => {
    sourceTimeRef.current = sourceTime;
  }, [sourceTime]);

  useEffect(() => {
    programTimeRef.current = programTime;
  }, [programTime]);

  useEffect(() => {
    setSelectedSegmentIds(new Set());
  }, [transcriptSourceClipId]);

  useEffect(() => {
    if (monitorMode !== "source") return;
    syncSourcePreview(selectedSourceClip, sourceTimeRef.current, false);
  }, [monitorMode, selectedSourceClip, syncSourcePreview]);

  useEffect(() => {
    if (monitorMode !== "program" || timeline.clips.length === 0) return;
    syncProgramPreview(clamp(programTimeRef.current, 0, Math.max(timeline.totalDuration, 0)), false);
  }, [monitorMode, syncProgramPreview, timeline.clips, timeline.totalDuration]);

  useEffect(() => {
    if (timeline.clips.length === 0) {
      setProgramTime(0);
      if (monitorMode === "program") setIsPlaying(false);
      return;
    }

    if (monitorMode === "program" && programTime > timeline.totalDuration) {
      syncProgramPreview(timeline.totalDuration, false);
    }
  }, [monitorMode, programTime, syncProgramPreview, timeline.clips.length, timeline.totalDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (monitorModeRef.current === "source") {
        setSourceTime(video.currentTime);
        return;
      }

      const activeClip = clipsWithOffsets.find((clip) => clip.id === activeProgramClipRef.current);
      if (!activeClip || activeClip.type !== "video") return;

      const nextSequenceTime = activeClip.sequenceStart + (video.currentTime - activeClip.sourceStartTime);
      if (video.currentTime >= activeClip.sourceEndTime - 0.04) {
        const nextClip = clipsWithOffsets.find((clip) => clip.sequenceStart >= activeClip.sequenceEnd - 0.0001);
        if (!nextClip) {
          setProgramTime(timeline.totalDuration);
          video.pause();
          return;
        }

        syncProgramPreview(nextClip.sequenceStart, !video.paused);
        return;
      }

      setProgramTime(nextSequenceTime);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [clipsWithOffsets, syncProgramPreview, timeline.totalDuration]);

  useEffect(() => {
    return () => {
      for (const clip of libraryClipsRef.current) {
        URL.revokeObjectURL(clip.objectUrl);
      }
    };
  }, []);

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#0b0c0f] text-white">
      <header className="flex items-center justify-between border-b border-white/8 bg-[#111215] px-5 py-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">Workspace</p>
            <h1 className="mt-1 text-lg font-semibold text-white/92">VibeCut Studio</h1>
          </div>
          <div className="hidden h-8 w-px bg-white/8 md:block" />
          <div className="hidden gap-4 text-[11px] uppercase tracking-[0.18em] text-white/34 md:flex">
            <span>{libraryClips.length} clips</span>
            <span>{timeline.clips.length} sequence items</span>
            <span>{formatTime(timeline.totalDuration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(processingCount > 0 || activeJobs > 0) && (
            <div className="rounded-full border border-amber-400/18 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-200">
              Processing {processingCount || activeJobs} clip{processingCount === 1 || activeJobs === 1 ? "" : "s"}
            </div>
          )}
          {transcriptError && (
            <div className="rounded-full border border-red-400/18 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-200">
              {transcriptError}
            </div>
          )}
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[260px_minmax(0,1fr)_320px] overflow-hidden 2xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <MediaBin
          clips={libraryClips}
          selectedClipId={selectedSourceClipId}
          onSelectClip={handleSelectSourceClip}
          onAddFiles={handleAddFiles}
        />

        <main className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_320px] overflow-hidden bg-[#0d0e12]">
          <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
              <div className="inline-flex rounded-xl border border-white/8 bg-[#131419] p-1">
                {(["source", "program"] as MonitorMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setMonitorMode(mode);
                      if (mode === "source") syncSourcePreview(selectedSourceClip, sourceTime, false);
                      else syncProgramPreview(programTime, false);
                    }}
                    className={`rounded-lg px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] transition ${
                      monitorMode === mode
                        ? "bg-sky-400 text-black"
                        : "text-white/45 hover:text-white/78"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div className="hidden shrink-0 text-xs uppercase tracking-[0.2em] text-white/28 lg:block">
                {monitorMode === "source" ? "Media preview" : "Sequence preview"}
              </div>
            </div>

            <VideoPlayer
              videoRef={videoRef}
              videoUrl={monitorVideoUrl}
              imageSrc={monitorImageSrc}
              isPlaying={isPlaying}
              currentTime={monitorCurrentTime}
              duration={monitorDuration}
              title={monitorMode === "source" ? "Source" : "Program"}
              subtitle={monitorSubtitle}
              emptyLabel={monitorMode === "source" ? "Select a clip from the media bin" : "Build a sequence to preview it"}
              onTogglePlay={handleTogglePlay}
              onSeek={handleMonitorSeek}
            />
          </section>

          <section className="min-h-0 min-w-0 overflow-hidden p-4 pt-0">
            <Timeline
              clips={timeline.clips}
              libraryClips={libraryClips}
              totalDuration={timeline.totalDuration}
              currentTime={programTime}
              onSeek={handleTimelineSeek}
              onAppendFromLibrary={handleAppendFromLibrary}
              dispatch={dispatch}
              selectedClipId={selectedTimelineClipId}
              onSelectClip={handleSelectTimelineClip}
            />
          </section>
        </main>

        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/8 bg-[#141518]">
          <div className="border-b border-white/8 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Dock</p>
            <div className="mt-3 grid grid-cols-3 rounded-xl border border-white/8 bg-white/[0.03] p-1">
              {([
                { id: "ai", label: "AI Edit" },
                { id: "transcript", label: "Transcript" },
                { id: "inspector", label: "Inspector" },
              ] as { id: DockTab; label: string }[]).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDockTab(tab.id)}
                  className={`rounded-lg px-2 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition ${
                    dockTab === tab.id
                      ? "bg-sky-400 text-black"
                      : "text-white/42 hover:text-white/78"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {dockTab === "ai" && (
              <div className="flex h-full min-h-0 min-w-0 flex-col">
                <div className="border-b border-white/8 px-4 py-3">
                  <p className="text-sm font-medium text-white/84">Edit by intent</p>
                  <p className="mt-1 text-xs leading-5 text-white/38">
                    Run natural-language edits against the current sequence.
                  </p>
                </div>
                <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overflow-x-hidden p-4">
                  <CommandInput
                    onSubmit={handleEditCommand}
                    isProcessing={isEditProcessing}
                    lastExplanation={lastExplanation}
                  />
                  <ImageGenPanel onInsertImage={handleInsertImage} />
                </div>
              </div>
            )}

            {dockTab === "transcript" && (
              <TranscriptPanel
                clipName={transcriptClip?.fileName}
                segments={transcriptClip?.transcriptSegments || []}
                currentTime={activeTranscriptTime}
                selectedIds={selectedSegmentIds}
                activeRange={selectedTranscriptRange}
                onSeek={handleTranscriptSeek}
                onToggleSelect={handleToggleSegment}
                onRemoveSelected={handleRemoveSelected}
                onSearch={handleSearch}
                searchResults={searchResults}
                isSearching={isSearching}
              />
            )}

            {dockTab === "inspector" && (
              <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden p-4">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Selection</p>
                  {selectedTimelineClip ? (
                    <div className="mt-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-white/86">
                          {selectedTimelineClip.label || selectedSourceClip?.fileName || "Sequence clip"}
                        </p>
                        <p className="mt-1 text-xs text-white/38">
                          {selectedTimelineClip.type === "image" ? "Still frame clip" : "Video clip"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-white/48">
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">In</p>
                          <p className="mt-1 font-medium text-white/78">
                            {formatTime(selectedTimelineClip.sourceStartTime)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Out</p>
                          <p className="mt-1 font-medium text-white/78">
                            {formatTime(selectedTimelineClip.sourceEndTime)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Duration</p>
                          <p className="mt-1 font-medium text-white/78">{formatTime(selectedTimelineClip.duration)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Source</p>
                          <p className="mt-1 truncate font-medium text-white/78">
                            {selectedTimelineClip.sourceClipId || "Generated"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : selectedSourceClip ? (
                    <div className="mt-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-white/86">{selectedSourceClip.fileName}</p>
                        <p className="mt-1 text-xs text-white/38">Library clip</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-white/48">
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Duration</p>
                          <p className="mt-1 font-medium text-white/78">{formatTime(selectedSourceClip.duration)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Status</p>
                          <p className="mt-1 font-medium capitalize text-white/78">{selectedSourceClip.status}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Transcript</p>
                          <p className="mt-1 font-medium text-white/78">
                            {selectedSourceClip.transcriptSegments.length} segments
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Embeddings</p>
                          <p className="mt-1 font-medium text-white/78">
                            {selectedSourceClip.embeddingsReady ? "Ready" : "Pending"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-white/36">
                      Select a library clip or timeline item to inspect it.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
