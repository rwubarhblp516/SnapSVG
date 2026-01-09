import { GoogleGenAI } from "@google/genai";
import { TracerParams } from "../types";

// Helper to safely get env key without crashing if 'process' is undefined
export const getEnvApiKey = () => {
    try {
        // @ts-ignore
        if (typeof process !== "undefined" && process.env) {
            return process.env.API_KEY;
        }
    } catch(e) {}
    try {
        // @ts-ignore
        const meta = import.meta as any;
        if (meta && meta.env) {
            return meta.env.VITE_API_KEY || meta.env.API_KEY;
        }
    } catch(e) {}
    return "";
};

/**
 * AI 智能调参：分析图片风格，返回最佳的 TracerParams 配置
 */
export const analyzeImageStyle = async (base64Image: string, apiKey?: string): Promise<Partial<TracerParams>> => {
  const keyToUse = apiKey || getEnvApiKey();

  if (!keyToUse) {
      throw new Error("Missing API Key. Please enter your Gemini API Key in the settings.");
  }

  const ai = new GoogleGenAI({ apiKey: keyToUse });

  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

    // Use Flash model for speed, it's good enough for classification/parameter estimation
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      You are an expert Image Processing Engineer specializing in Vectorization (Image-to-SVG).
      Analyze the attached image and determine the OPTIMAL settings for a quantization tracer algorithm.

      CRITICAL STRATEGY RULES:
      1. **Sampling (Upscale) IS KING**: 
         - **DEFAULT TO 4 (4x Upscale)** for almost ALL images (cartoons, anime, photos, logos) to ensure smooth curves and sharp corners.
         - Only use 2 if the image is very simple/flat.
         - Only use 1 if it is "Pixel Art" style where you want to keep the blocks.
      
      2. **Paths (Fitting)**:
         - Do NOT oversmooth. We want detail.
         - **Target 70-95** for most images. 
         - Only go below 60 if it's an abstract blob or very loose sketch.
         - If it's a character (like anime/cartoon), keep Paths HIGH (>80) to capture eyes/features accurately.

      3. **Colors**:
         - Be generous. If it looks like a full-color illustration, give it 32-64 colors.
         - Only reduce colors if it's clearly a flat vector logo or 2-tone icon.

      4. **Noise**:
         - Keep it low (0-10) for clean digital art.
         - Raise it (20-50) ONLY for pencil sketches or grainy scans.

      Return a strictly valid JSON object with these properties:
      {
        "colors": integer (2-64),
        "paths": integer (10-100),
        "corners": integer (0-100),
        "noise": integer (0-100),
        "blur": integer (0-4),
        "colorMode": string ("color", "grayscale", "binary"),
        "sampling": integer (1, 2, or 4)
      }
      
      Output ONLY the JSON.
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: cleanBase64 } },
          { text: prompt }
        ]
      },
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from AI");

    // Clean potential markdown code blocks
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const params = JSON.parse(jsonStr);

    return params;

  } catch (error) {
    console.error("Gemini Image Analysis Failed:", error);
    throw error;
  }
};