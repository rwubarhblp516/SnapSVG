import { GoogleGenAI } from "@google/genai";

export const segmentImageWithGemini = async (base64Image: string, width: number, height: number, apiKey?: string): Promise<string> => {
  // Use provided key, or fallback to env (if configured during build), or throw error
  const keyToUse = apiKey || process.env.API_KEY;

  if (!keyToUse) {
      throw new Error("Missing API Key. Please enter your Gemini API Key in the settings.");
  }

  const ai = new GoogleGenAI({ apiKey: keyToUse });

  try {
    // Clean base64 string
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

    const model = "gemini-2.5-flash-preview";
    
    const prompt = `
      You are an expert SVG artist. Your task is to vectorize the attached character image into a clean, flat SVG.
      
      CRITICAL RULES:
      1. **Anatomy Segmentation**: You MUST group the SVG paths by body parts using <g> tags with specific IDs.
         - Example: <g id="head">...</g>, <g id="torso">...</g>, <g id="left_arm">...</g>, <g id="legs">...</g>.
      2. **Coordinate System**: The SVG viewBox MUST be "0 0 ${width} ${height}". Ensure the drawing fits exactly within these dimensions.
      3. **Style**: Use flat colors (no gradients). Keep the style consistent with the original image but simplified for vector graphics.
      4. **Output**: Return ONLY the raw SVG code. Do not include markdown blocks (like \`\`\`svg). Do not include explanations.
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
        temperature: 0.2, 
        maxOutputTokens: 8192,
      }
    });

    const text = response.text || "";
    
    // Cleanup markdown if present
    const svgContent = text.replace(/```svg/g, '').replace(/```/g, '').trim();
    
    // Basic validation
    if (!svgContent.includes("<svg")) {
        throw new Error("AI did not return a valid SVG.");
    }

    return svgContent;

  } catch (error) {
    console.error("Gemini AI Segmentation Failed:", error);
    throw error;
  }
};