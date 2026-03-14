"use client";
import { useState, RefObject, useCallback } from "react";
import Image from "next/image";

export interface FontOverlayData {
  text: string;
  fontFamily: string;
  color: string;
  textShadow: string;
  cssFilter?: string;
}

interface VibeFontPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  onAddFiles?: (files: File[]) => void;
  onApplyFont?: (overlay: FontOverlayData) => void; 
}

type Step = "input" | "generating-style" | "style-review" | "generating-image" | "image-review" | "generating-video";
type Mode = "overlay" | "video";

export default function VibeFontPanel({ videoRef, onAddFiles, onApplyFont }: VibeFontPanelProps) {
  const [mode, setMode] = useState<Mode>("overlay");
  const [text, setText] = useState("VIBE CUT");
  
  // Video State
  const [step, setStep] = useState<Step>("input");
  const [artDirection, setArtDirection] = useState("");
  const [referenceFrame, setReferenceFrame] = useState<string | null>(null);
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [baseImageMimeType, setBaseImageMimeType] = useState<string>("");
  
  // Overlay State
  const [isGeneratingOverlay, setIsGeneratingOverlay] = useState(false);
  const [generatedFont, setGeneratedFont] = useState<Omit<FontOverlayData, "text"> | null>(null);

  const [error, setError] = useState<string | null>(null);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, [videoRef]);

  const handleGenerateOverlay = async () => {
    const frameBase64 = captureFrame();
    if (!frameBase64) {
      setError("Failed to capture video frame. Is a video playing?");
      return;
    }

    setIsGeneratingOverlay(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: frameBase64 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      
      const fontUrl = `https://fonts.googleapis.com/css2?family=${data.fontFamily.replace(/ /g, '+')}&display=swap`;
      if (!document.querySelector(`link[href="${fontUrl}"]`)) {
        const link = document.createElement("link");
        link.href = fontUrl;
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }

      setGeneratedFont({
        fontFamily: data.fontFamily,
        color: data.color,
        textShadow: data.textShadow,
        cssFilter: data.cssFilter,
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGeneratingOverlay(false);
    }
  };

  const handleApplyOverlay = () => {
    if (generatedFont && onApplyFont) {
      onApplyFont({
        text: text || "VibeCut",
        ...generatedFont,
      });
    }
  };

  const handleStartVideo = async () => {
    const frameBase64 = captureFrame();
    if (!frameBase64) {
      setError("Failed to capture video frame. Is a video playing?");
      return;
    }
    
    setReferenceFrame(frameBase64);
    setStep("generating-style");
    setError(null);

    try {
      const res = await fetch("/api/vibe-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "style", text }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate style");
      }

      const { style } = await res.json();
      setArtDirection(style);
      setStep("style-review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Style generation failed");
      setStep("input");
    }
  };

  const handleGenerateImage = async () => {
    setStep("generating-image");
    setError(null);

    try {
      const res = await fetch("/api/vibe-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "image", 
          text, 
          style: artDirection,
          referenceImage: referenceFrame
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate base image");
      }

      const { data, mimeType } = await res.json();
      setBaseImage(`data:${mimeType};base64,${data}`);
      setBaseImageMimeType(mimeType);
      setStep("image-review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
      setStep("style-review");
    }
  };

  const handleGenerateVideo = async () => {
    setStep("generating-video");
    setError(null);

    try {
      const res = await fetch("/api/vibe-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "video", 
          text, 
          imageBase64: baseImage,
          imageMimeType: baseImageMimeType,
          style: artDirection
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to request video");
      }

      const { videoUri } = await res.json();
      
      const finalRes = await fetch(videoUri);
      const videoBlob = await finalRes.blob();
      const filename = `cinematic_text_${Date.now()}.mp4`;
      const videoFile = new File([videoBlob], filename, { type: "video/mp4" });
      
      if (onAddFiles) {
        onAddFiles([videoFile]);
      }
      
      setStep("input");
      setBaseImage(null);
      setArtDirection("");
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation logic failed");
      setStep("image-review");
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="border-b border-white/8 px-4 py-3">
        <p className="text-sm font-medium text-white/84">Cinematic Text</p>
        <p className="mt-1 text-xs leading-5 text-white/38">
          Add dynamic text overlays to the current frame or generate AI intro videos.
        </p>
      </div>

      <div className="flex gap-2 p-4 pb-0">
        <button 
          onClick={() => setMode("overlay")} 
          className={`px-3 py-1.5 text-[11px] font-medium rounded-lg uppercase tracking-widest transition-colors ${mode === "overlay" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
        >
          Overlay
        </button>
        <button 
          onClick={() => setMode("video")} 
          className={`px-3 py-1.5 text-[11px] font-medium rounded-lg uppercase tracking-widest transition-colors ${mode === "video" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
        >
          AI Video Intro
        </button>
      </div>

      <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overflow-x-hidden p-4">
        {mode === "overlay" && (
           <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <input
              type="text"
              placeholder="Text to display..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none"
            />

            <button
              onClick={handleGenerateOverlay}
              disabled={isGeneratingOverlay}
              className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingOverlay ? "Analyzing Frame..." : "Generate VibeFont Overlay"}
            </button>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {generatedFont && (
              <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                <div
                  className="flex min-h-[80px] items-center justify-center rounded-lg bg-black/40 p-4 text-center overflow-hidden"
                  style={{
                    fontFamily: `'${generatedFont.fontFamily}', sans-serif`,
                    color: generatedFont.color,
                    textShadow: generatedFont.textShadow,
                    filter: generatedFont.cssFilter,
                    fontSize: "2rem",
                  }}
                >
                  {text || "Preview text"}
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-[10px] text-white/50">
                  <div className="rounded bg-black/20 p-2">
                    <span className="block text-white/30">Font</span>
                    {generatedFont.fontFamily}
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <span className="block text-white/30">Color</span>
                    {generatedFont.color}
                  </div>
                </div>

                <button
                  onClick={handleApplyOverlay}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  Apply Overlay to Video
                </button>
              </div>
            )}
           </div>
        )}

        {mode === "video" && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            {step === "input" && (
              <>
                <input
                  type="text"
                  placeholder="Cinematic Text..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none"
                />
                <button
                  onClick={handleStartVideo}
                  disabled={!text}
                  className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start Magic Video Generator
                </button>
                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
              </>
            )}

            {step === "generating-style" && (
              <div className="py-8 text-center text-sm text-white/60 animate-pulse">
                Dreaming up art direction...
              </div>
            )}

            {step === "style-review" && (
              <div className="space-y-4">
                 <div>
                    <p className="text-[10px] uppercase text-white/40 mb-1">Art Direction</p>
                    <textarea
                      value={artDirection}
                      onChange={(e) => setArtDirection(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none resize-none"
                    />
                 </div>
                 
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setStep("input")}
                     className="flex-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                   >
                     Back
                   </button>
                   <button 
                     onClick={handleGenerateImage}
                     className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                   >
                     Test Base Image
                   </button>
                 </div>
              </div>
            )}

            {step === "generating-image" && (
              <div className="py-8 text-center text-sm text-white/60 animate-pulse">
                Compositing cinematic base plate...
              </div>
            )}

            {step === "image-review" && baseImage && (
              <div className="space-y-4">
                 <div>
                    <p className="text-[10px] uppercase text-white/40 mb-1">Base Target Image</p>
                    <div className="aspect-video relative overflow-hidden rounded-lg bg-black/40">
                      <Image src={baseImage} alt="Base text image" fill className="object-cover" unoptimized/>
                    </div>
                 </div>
                 
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setStep("style-review")}
                     className="flex-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                   >
                     Back
                   </button>
                   <button 
                     onClick={handleGenerateVideo}
                     className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
                   >
                     Generate Veo Transition
                   </button>
                 </div>
                 {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
              </div>
            )}

            {step === "generating-video" && (
               <div className="py-8 text-center text-sm text-amber-400 animate-pulse">
                 Generating final video intro with Veo 3.1... (This takes a few minutes)
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
