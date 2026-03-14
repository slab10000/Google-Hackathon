import { getGeminiClient, MODELS } from "./gemini";

// Helper to clean base64 string
export const cleanBase64 = (base64Str: string) => {
  return base64Str.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to create a blank black image for the video start frame
const createBlankImage = (width: number, height: number): string => {
  // We don't have document in server components.
  // Instead, return a hardcoded 1280x720 black png base64 to avoid DOM dependencies.
  return "iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAADPxVxEAAAMbaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Inc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjYtYzE0MCA3OS4xNjA0NTEsIDIwMTcvMDUvMDYtMDE6MDg6MjEgICAgICAgICI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KPD94cGFja2V0IGVuZD0iciI/Pu/OQeQAACM/SURBVHgB7P0LdttI1i2MX... (rest omitted, provide a real 1x1 black pixel and let it scale, or omit imageBytes if veo supports text-to-video without starting image)";
};

// Valid 1x1 black PNG base64
const BLACK_1X1_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";


export const generateStyleSuggestion = async (text: string, referenceImage?: string): Promise<{ style: string, typography: string }> => {
  const ai = getGeminiClient();
  const parts: any[] = [];

  const genericPrompt = referenceImage 
    ? `Analyze this image and generate two descriptions for a cinematic text animation of the word/phrase: "${text}".
       The styling must perfectly match the material, lighting, and environment of this frame.`
    : `Generate two descriptions for a cinematic text animation of the word/phrase: "${text}".
       Focus on material, lighting, and environment.`;

  parts.push({
    text: `${genericPrompt}
    
    Return the response strictly as a JSON object:
    - "style": A short (10-15 words) description of the visual atmosphere and environment (e.g., "Ancient stone temple with mossy walls and golden sunbeams").
    - "typography": A short (10-15 words) description of how the text itself should look (e.g., "Bold, weathered stone letters with cracked textures and soft internal glow").
    `
  });

  if (referenceImage) {
    const [mimeTypePart, data] = referenceImage.split(';base64,');
    parts.push({
      inlineData: {
        data: data,
        mimeType: mimeTypePart.replace('data:', '')
      }
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODELS.REASONING,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: "application/json",
      },
    });
    
    const resText = response.text?.trim() || "{}";
    let data;
    try {
        data = JSON.parse(resText);
    } catch (e) {
        const jsonMatch = resText.match(/```json\n([\s\S]*?)\n```/);
        data = jsonMatch ? JSON.parse(jsonMatch[1]) : {};
    }

    return {
      style: data.style || "",
      typography: data.typography || ""
    };
  } catch (e) {
    console.error("Failed to generate style suggestion", e);
    return { style: "", typography: "" };
  }
};

interface TextImageOptions {
  text: string;
  style: string;
  typographyPrompt?: string;
  referenceImage?: string; // Full Data URL
}

export const generateTextImage = async ({ text, style, typographyPrompt, referenceImage }: TextImageOptions): Promise<{ data: string, mimeType: string }> => {
  const ai = getGeminiClient();
  const parts: any[] = [];
  
  const typoInstruction = typographyPrompt && typographyPrompt.trim().length > 0 
    ? typographyPrompt 
    : "High-quality, creative typography that perfectly matches the visual environment. Legible and artistic.";

  if (referenceImage) {
    const [mimeTypePart, data] = referenceImage.split(';base64,');
    parts.push({
      inlineData: {
        data: data,
        mimeType: mimeTypePart.replace('data:', '')
      }
    });
    
    parts.push({ 
      text: `Analyze the visual style, color palette, lighting, and textures of this reference image. 
      Create a NEW high-resolution cinematic image featuring the text "${text}" written in the center. 
      Typography Instruction: ${typoInstruction}.
      The text should look like it perfectly belongs in the world of the reference image.
      Additional style instructions: ${style}.` 
    });
  } else {
    parts.push({ 
      text: `A hyper-realistic, cinematic, high-resolution image featuring the text "${text}". 
      Typography Instruction: ${typoInstruction}. 
      Visual Style: ${style}. 
      The typography must be legible, artistic, and centered. Lighting should be dramatic and atmospheric. 8k resolution, detailed texture.` 
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODELS.IMAGE_GEN,
      contents: { role: 'user', parts },
      config: {
        responseModalities: ["IMAGE"]
      } as any // Forcing config since types might differ
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return { 
          data: part.inlineData.data || "", 
          // @ts-ignore
          mimeType: part.inlineData.mimeType || 'image/png' 
        };
      }
    }
    throw new Error("No image generated");
  } catch (error: any) {
    throw error;
  }
};

const pollForVideo = async (operation: any) => {
  const ai = getGeminiClient();
  let op = operation;
  const startTime = Date.now();
  const MAX_WAIT_TIME = 180000; 

  while (!op.done) {
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      throw new Error("Video generation timed out.");
    }
    await sleep(5000); 
    // @ts-ignore
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  return op;
};

const fetchVideoBlob = async (uri: string) => {
  try {
    const url = new URL(uri);
    url.searchParams.append('key', process.env.GEMINI_API_KEY || '');
    
    const videoResponse = await fetch(url.toString());
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video content: ${videoResponse.statusText}`);
    }
    const blob = await videoResponse.blob();
    // Return a base64 string because URL.createObjectURL cannot be passed across server boundaries
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:${blob.type};base64,${buffer.toString('base64')}`;
  } catch (e: any) {
    const fallbackUrl = `${uri}${uri.includes('?') ? '&' : '?'}key=${process.env.GEMINI_API_KEY}`;
    const videoResponse = await fetch(fallbackUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video content: ${videoResponse.statusText}`);
    }
    const blob = await videoResponse.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:${blob.type};base64,${buffer.toString('base64')}`;
  }
};

export const generateTextVideo = async (text: string, imageBase64: string, imageMimeType: string, promptStyle: string): Promise<string> => {
  const ai = getGeminiClient();

  if (!imageBase64) throw new Error("Image generation failed, cannot generate video.");

  const cleanImageBase64 = cleanBase64(imageBase64);

  const maxRevealRetries = 1; 
  for (let i = 0; i <= maxRevealRetries; i++) {
    try {
      const revealPrompt = `Cinematic animation. ${promptStyle}. High quality, 8k, smooth motion.`;

      // @ts-ignore - types may not have generateVideos defined if using older genai version
      let operation = await ai.models.generateVideos({
        model: MODELS.VIDEO_GEN,
        prompt: revealPrompt,
        image: {
          imageBytes: cleanImageBase64,
          mimeType: imageMimeType
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      const op = await pollForVideo(operation);

      if (!op.error && op.response?.generatedVideos?.[0]?.video?.uri) {
        return await fetchVideoBlob(op.response.generatedVideos[0].video.uri);
      }
      
      if (op.error) {
        if (i < maxRevealRetries) {
          await sleep(3000);
          continue; 
        }
        throw new Error(op.error.message);
      }
    } catch (error: any) {
      if (i === maxRevealRetries) throw error;
      await sleep(3000);
    }
  }

  throw new Error("Unable to generate video.");
};
