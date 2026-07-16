import express from "express";
import path from "path";
import dotenv from "dotenv";
import os from "node:os";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { getSyncState, saveSyncState } from "./db";

// Load environment variables
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add CORS headers to allow requests from mobile apps (Capacitor)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

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

  // Helper function to handle generation with retries and fallback
  const generateWithFallbackAndRetry = async (aiClient: GoogleGenAI, params: any) => {
    const modelsToTry = [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
      "gemma-4-31b-it",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash"
    ];
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
          
          const errStr = String(err.message || err).toLowerCase();
          const status = err.status || (err.statusText ? parseInt(err.statusText) : null);
          
          const isRetryable = status === 503 || 
                              status === 429 || 
                              errStr.includes("503") || 
                              errStr.includes("429") || 
                              errStr.includes("limit") || 
                              errStr.includes("quota") || 
                              errStr.includes("exhausted") || 
                              errStr.includes("unavailable") || 
                              errStr.includes("overloaded") ||
                              errStr.includes("demand") ||
                              errStr.includes("temporarily");

          if (isRetryable && attempt < maxRetriesPerModel) {
            const delay = attempt * 1500;
            console.log(`[Gemini] Error is retryable. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            console.log(`[Gemini] Skipping further attempts for model ${model} due to ${isRetryable ? "exhausted retries" : "non-retryable error"}. Falling back to next model.`);
            break;
          }
        }
      }
    }

    throw lastError || new Error("Failed to generate content after trying multiple models and retrying.");
  };

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

  // Story options generation endpoint
  app.post("/api/generate-options", async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({ 
          error: "Gemini API key is not configured in the application environment settings." 
        });
      }

      const { history, latestChapter } = req.body;

      const systemInstruction = `你是一位专门为仙侠修仙小说生成后续剧情选择分支的助手。请根据提供的小说前文历史以及刚刚生成的最新章节，推演并设计 5 个接下来的剧情推演方向选项（宿命轨迹）。
每个选项字数控制在 15 到 35 字之间，要带有《凡人修仙传》原著那种严肃修仙、克制又暗流涌动的风格，以及韩立与宋玉之间暧昧、斗智、禁忌双修的张力。
你必须只返回一个 JSON 数组，包含这 5 个选项。不要包含任何 markdown 代码块标记，如：
["选项一", "选项二", "选项三", "选项四", "选项五"]`;

      const response = await generateWithFallbackAndRetry(ai, {
        contents: [
          { 
            role: 'user', 
            parts: [{ 
              text: `前文小说历史：\n${history}\n\n最新生成的章节内容：\n${latestChapter}\n\n请根据上述内容，推演下一步的 5 个剧情走向选项，以 JSON 数组格式返回：` 
            }] 
          }
        ],
        config: {
          systemInstruction,
          temperature: 0.85,
          responseMimeType: "application/json"
        }
      });

      const generatedText = response.text || "[]";
      res.json({ options: generatedText });
    } catch (err: any) {
      console.error("Gemini Options Generation Error:", err);
      res.status(500).json({ error: err.message || "服务器生成剧情选项失败" });
    }
  });

  // Database Synchronization Endpoints
  app.get("/api/sync", (req, res) => {
    try {
      const state = getSyncState();
      res.json(state);
    } catch (err: any) {
      console.error("Sync GET Error:", err);
      res.status(500).json({ error: "获取同步状态失败" });
    }
  });

  app.post("/api/sync", (req, res) => {
    try {
      const { chapters, selectedId, fateOptions } = req.body;
      if (!Array.isArray(chapters)) {
        return res.status(400).json({ error: "章节数据格式不正确" });
      }
      saveSyncState(chapters, selectedId || 1, fateOptions || []);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Sync POST Error:", err);
      res.status(500).json({ error: "保存同步状态失败" });
    }
  });

  // Helper to get local network IP
  function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.family === "IPv4") {
          return iface.address;
        }
      }
    }
    return "localhost";
  }

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
    const localIp = getLocalIpAddress();
    console.log(`[Server] Running locally at: http://localhost:${PORT}`);
    console.log(`[Server] Running on LAN at:    http://${localIp}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start express server:", err);
});
