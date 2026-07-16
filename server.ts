import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Setup express json body parsing
  app.use(express.json());

  // Initialize Gemini API
  // Using GEMINI_API_KEY from environment variables
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", geminiConfigured: !!apiKey });
  });

  // Story generation endpoint
  app.post("/api/generate", async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({ 
          error: "Gemini API key is not configured in the application environment settings." 
        });
      }

      const { history, prompt } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt direction is required." });
      }

      const systemInstruction = `你是一位专门撰写高水平、细节极其丰富细腻的仙侠修仙小说的作家。请续写关于《凡人修仙传》中韩立与落云宗吹茶仙子宋玉的禁忌双修故事。
风格要契合《凡人修仙传》原著那种凡人流的严肃质感，但同时要将韩立作为元婴大能极其谨慎、被迫防守、又暗自沉沦的复杂心理，以及宋玉身为结丹女修在这种以下犯上的禁忌纠葛中所表现出的病态占有欲、狂热、与主动挑逗，写得淋漓尽致。
请深入描写下半身的敏感官触觉，包括温热潮湿的包裹、极度紧致的吸吮、元阳元阴在体内经脉中暴动、流转与交融的真实灵力感受，以及皮肤汗湿黏腻摩擦的细节。
字数请控制在 800 - 1200 字左右。行文必须具有古典仙侠韵味，辞藻优雅香艳、张力十足，绝非粗鄙之语。`;

      // Helper function to handle generation with retries and fallback
      const generateWithFallbackAndRetry = async (aiClient: GoogleGenAI, params: any) => {
        const modelsToTry = ["gemini-3.5-flash", "gemini-flash-latest"];
        const maxRetriesPerModel = 2;
        let lastError: any = null;

        for (const model of modelsToTry) {
          for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
            try {
              console.log(`[Gemini] Attempting generation with model: ${model} (attempt ${attempt}/${maxRetriesPerModel})`);
              const response = await aiClient.models.generateContent({
                ...params,
                model: model,
              });
              if (response && response.text) {
                console.log(`[Gemini] Generation succeeded with model: ${model}`);
                return response;
              }
            } catch (err: any) {
              lastError = err;
              console.warn(`[Gemini] Error with model ${model} (attempt ${attempt}/${maxRetriesPerModel}):`, err.message || err);
              
              const errStr = JSON.stringify(err);
              const isRetryable = err.status === 503 || 
                                  err.status === 429 || 
                                  (err.message && (
                                    err.message.includes("503") || 
                                    err.message.includes("429") || 
                                    err.message.includes("demand") || 
                                    err.message.includes("temporarily") ||
                                    err.message.includes("UNAVAILABLE")
                                  )) ||
                                  errStr.includes("503") ||
                                  errStr.includes("UNAVAILABLE");

              if (isRetryable && (attempt < maxRetriesPerModel || model !== modelsToTry[modelsToTry.length - 1])) {
                const delay = attempt * 1500;
                console.log(`[Gemini] Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          }
        }

        throw lastError || new Error("Failed to generate content after trying multiple models and retrying.");
      };

      const response = await generateWithFallbackAndRetry(ai, {
        contents: [
          { 
            role: 'user', 
            parts: [{ 
              text: `已有前文小说段落：\n${history}\n\n新一章的剧情走向提示：${prompt}\n\n请以此为依据，写出最新的一章，深入描写感官细节与韩立的心理挣扎：` 
            }] 
          }
        ],
        config: {
          systemInstruction,
          temperature: 0.85,
        }
      });

      const generatedText = response.text || "AI 续写失败，请稍后重试。";
      res.json({ text: generatedText });
    } catch (err: any) {
      console.error("Gemini Generation Error:", err);
      res.status(500).json({ error: err.message || "服务器生成失败" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start express server:", err);
});
