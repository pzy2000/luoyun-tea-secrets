import { useState, useEffect, useRef } from "react";
import { 
  BookOpen, 
  Sparkles, 
  Sliders, 
  Volume2, 
  VolumeX, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft, 
  Trash2, 
  FileText, 
  Feather, 
  Check, 
  Loader2,
  BookOpenText,
  Compass,
  CornerDownRight
} from "lucide-react";
import { INITIAL_CHAPTERS, PRESET_PROMPTS, REASSURING_MESSAGES, Chapter } from "./data";

// Type definitions for reading settings
interface ReaderSettings {
  theme: "mystic-dark" | "silk-light" | "bamboo-green";
  fontFamily: "font-sans" | "font-serif" | "font-mono";
  fontSize: number; // in pixels
  autoScroll: boolean;
  scrollSpeed: number; // index or value
  apiUrl: string;
  apiKey: string;
}

export default function App() {
  // Novel chapters state
  const [chapters, setChapters] = useState<Chapter[]>(() => {
    const saved = localStorage.getItem("luoyun_chapters");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved chapters, resetting", e);
      }
    }
    return INITIAL_CHAPTERS;
  });

  // Selected chapter
  const [selectedId, setSelectedId] = useState<number>(1);
  const currentChapter = chapters.find(c => c.id === selectedId) || chapters[0] || INITIAL_CHAPTERS[0];

  // Settings state
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem("luoyun_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.apiUrl) {
          parsed.apiUrl = "";
        }
        if (!parsed.apiKey) {
          parsed.apiKey = "";
        }
        return parsed;
      } catch (e) {}
    }
    return {
      theme: "mystic-dark",
      fontFamily: "font-serif",
      fontSize: 18,
      autoScroll: false,
      scrollSpeed: 20,
      apiUrl: "",
      apiKey: ""
    };
  });

  // AI prompt state
  const [prompt, setPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fate trajectory options state
  const [fateOptions, setFateOptions] = useState<string[]>(() => {
    const saved = localStorage.getItem("luoyun_fate_options");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved fate options", e);
      }
    }
    return PRESET_PROMPTS;
  });
  const [isGeneratingOptions, setIsGeneratingOptions] = useState<boolean>(false);

  // Audio environment states
  const [ambientPlaying, setAmbientPlaying] = useState<boolean>(false);
  const [ambientVolume, setAmbientVolume] = useState<number>(0.2);
  const audioContextRef = useRef<AudioContext | null>(null);
  const noiseSourceNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);

  // Auto-scroll ref & timer
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  // Persist chapters
  useEffect(() => {
    localStorage.setItem("luoyun_chapters", JSON.stringify(chapters));
  }, [chapters]);

  // Persist settings
  useEffect(() => {
    localStorage.setItem("luoyun_settings", JSON.stringify(settings));
  }, [settings]);

  // Persist fate options
  useEffect(() => {
    localStorage.setItem("luoyun_fate_options", JSON.stringify(fateOptions));
  }, [fateOptions]);

  // Auto-scroll implementation
  useEffect(() => {
    if (settings.autoScroll && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }

      // Convert speed setting (1 to 50) to millisecond intervals
      const intervalMs = Math.max(10, 100 - settings.scrollSpeed);
      
      scrollIntervalRef.current = window.setInterval(() => {
        if (container) {
          // If already scrolled to bottom, stop auto scrolling
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
            setSettings(prev => ({ ...prev, autoScroll: false }));
          } else {
            container.scrollTop += 1;
          }
        }
      }, intervalMs);
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, [settings.autoScroll, settings.scrollSpeed, selectedId]);

  // AI Loading Screen Steps Rotator
  useEffect(() => {
    let interval: number;
    if (isGenerating) {
      let index = 0;
      setLoadingStep(REASSURING_MESSAGES[0]);
      interval = window.setInterval(() => {
        index = (index + 1) % REASSURING_MESSAGES.length;
        setLoadingStep(REASSURING_MESSAGES[index]);
      }, 3500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating]);

  // Ambient Synthesizer using Web Audio API
  const startAmbience = () => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      // Create Gain Node for volume
      const gainNode = ctx.createGain();
      gainNode.gain.value = ambientVolume;
      gainNodeRef.current = gainNode;

      // Create Bandpass filter for wind modulation
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 3.0;
      filterNodeRef.current = filter;

      // Generate brown noise buffer for rustling leaves/wind
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Amplify slightly
      }

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      // Low frequency oscillator (LFO) to modulate wind intensity
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12; // Modulate wind once every ~8 seconds

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 250; // Filter cutoff swing frequency

      // Connect LFO modulation
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      // Base filter cutoff
      filter.frequency.value = 600;

      // Connect nodes
      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Start oscillators and noise
      noiseSource.start();
      lfo.start();

      // Store node references for cancellation
      (noiseSourceNodeRef as any).current = noiseSource;
      lfoRef.current = lfo;

      setAmbientPlaying(true);
    } catch (e) {
      console.error("Web Audio API failed to initialize", e);
    }
  };

  const stopAmbience = () => {
    try {
      if ((noiseSourceNodeRef as any).current) {
        (noiseSourceNodeRef as any).current.stop();
        (noiseSourceNodeRef as any).current.disconnect();
        (noiseSourceNodeRef as any).current = null;
      }
      if (lfoRef.current) {
        lfoRef.current.stop();
        lfoRef.current.disconnect();
        lfoRef.current = null;
      }
      if (filterNodeRef.current) {
        filterNodeRef.current.disconnect();
        filterNodeRef.current = null;
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
      setAmbientPlaying(false);
    } catch (e) {
      console.error("Web Audio API failed to stop", e);
    }
  };

  // Handle volume changes
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      gainNodeRef.current.gain.setValueAtTime(ambientVolume, audioContextRef.current.currentTime);
    }
  }, [ambientVolume]);

  const toggleAmbience = () => {
    if (ambientPlaying) {
      stopAmbience();
    } else {
      startAmbience();
    }
  };

  // Reset to original chapters
  const resetChapters = () => {
    if (confirm("确认重置吗？这将清除所有 AI 续写的章节，只保留落云宗原著。")) {
      setChapters(INITIAL_CHAPTERS);
      setSelectedId(1);
      setFateOptions(PRESET_PROMPTS);
      localStorage.removeItem("luoyun_fate_options");
    }
  };

  // Delete current selected chapter
  const deleteCurrentChapter = () => {
    if (chapters.length <= 1) return;
    if (confirm(`确认删除章节《${currentChapter.title}》吗？`)) {
      const remaining = chapters.filter(c => c.id !== currentChapter.id);
      const reindexed = remaining.map((chap, idx) => ({
        ...chap,
        id: idx + 1
      }));
      setChapters(reindexed);
      const lastChapter = reindexed[reindexed.length - 1];
      setSelectedId(lastChapter.id);

      if (lastChapter.id === 1) {
        setFateOptions(PRESET_PROMPTS);
      } else {
        generateFateOptions(reindexed, lastChapter);
      }
    }
  };

  // Detect if running inside Capacitor / native app
  const isNativeApp = () => {
    return (
      window.location.protocol.startsWith("capacitor") ||
      window.location.protocol.startsWith("file") ||
      (window.location.hostname === "localhost" && !window.location.port) ||
      window.location.hostname === "127.0.0.1"
    );
  };

  // Direct Gemini REST API call for mobile (no backend needed)
  const callGeminiDirectly = async (novelHistory: string, userPrompt: string): Promise<string> => {
    const apiKey = settings.apiKey;
    if (!apiKey) {
      throw new Error("请在右侧设置面板中填入你的 Gemini API Key。可前往 https://aistudio.google.com/apikey 免费获取。");
    }

    const systemInstruction = `你是一位专门撰写高水平、细节极其丰富细腻的仙侠修仙小说的作家。请续写关于《凡人修仙传》中韩立与落云宗吹茶仙子宋玉的禁忌双修故事。
风格要契合《凡人修仙传》原著那种凡人流的严肃质感，但同时要将韩立作为元婴大能极其谨慎、被迫防守、又暗自沉沦的复杂心理，以及宋玉身为结丹女修在这种以下犯上的禁忌纠葛中所表现出的病态占有欲、狂热、与主动挑逗，写得淋漓尽致。
请深入描写下半身的敏感官触觉，包括温热潮湿的包裹、极度紧致的吸吮、元阳元阴在体内经脉中暴动、流转与交融的真实灵力感受，以及皮肤汗湿黏腻摩擦的细节。
字数请控制在 800 - 1200 字左右。行文必须具有古典仙侠韵味，辞藻优雅香艳、张力十足，绝非粗鄙之语。`;

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
          console.log(`[Gemini Direct] Attempting generation with model: ${model} (attempt ${attempt}/${maxRetriesPerModel})`);
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemInstruction }]
              },
              contents: [{
                role: "user",
                parts: [{
                  text: `已有前文小说段落：\n${novelHistory}\n\n新一章的剧情走向提示：${userPrompt}\n\n请以此为依据，写出最新的一章，深入描写感官细节与韩立的心理挣扎：`
                }]
              }],
              generationConfig: {
                temperature: 0.85
              }
            })
          });

          const data = await res.json();

          if (!res.ok) {
            const errMsg = data?.error?.message || JSON.stringify(data);
            const status = res.status;
            
            const isRetryable = status === 503 || status === 429 ||
                                errMsg.toLowerCase().includes("limit") ||
                                errMsg.toLowerCase().includes("quota") ||
                                errMsg.toLowerCase().includes("exhausted") ||
                                errMsg.toLowerCase().includes("unavailable") ||
                                errMsg.toLowerCase().includes("overloaded");

            console.warn(`[Gemini Direct] Error with model ${model} (status ${status}):`, errMsg);

            if (isRetryable && attempt < maxRetriesPerModel) {
              const delay = attempt * 1500;
              await new Promise(r => setTimeout(r, delay));
              continue;
            } else {
              lastError = new Error(errMsg);
              break;
            }
          }

          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            console.log(`[Gemini Direct] Generation succeeded with model: ${model}`);
            return text;
          }
          throw new Error("Gemini 返回了空内容，请重试。");
        } catch (err: any) {
          lastError = err;
          console.warn(`[Gemini Direct] Exception with model ${model} (attempt ${attempt}/${maxRetriesPerModel}):`, err.message || err);
          
          const errStr = String(err.message || err).toLowerCase();
          const isRetryable = errStr.includes("503") || 
                              errStr.includes("429") || 
                              errStr.includes("limit") || 
                              errStr.includes("quota") || 
                              errStr.includes("exhausted") || 
                              errStr.includes("unavailable") || 
                              errStr.includes("overloaded") ||
                              errStr.includes("fetch") ||
                              errStr.includes("network");

          if (isRetryable && attempt < maxRetriesPerModel) {
            const delay = attempt * 1500;
            await new Promise(r => setTimeout(r, delay));
          } else {
            break;
          }
        }
      }
    }
    throw lastError || new Error("所有模型均调用失败，请稍后重试。");
  };

  // Helper to parse JSON array or extract lines robustly
  const extractOptions = (text: string): string[] => {
    try {
      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim()).filter(Boolean).slice(0, 5);
      }
    } catch (e) {
      console.warn("[Options Parse] Failed to parse JSON array, attempting regex line extraction", e);
    }

    // Fallback: extract line by line
    const lines = text.split(/\n+/);
    const options: string[] = [];
    for (let line of lines) {
      // Remove common list formatting (e.g. "1. ", "- ", etc.)
      const cleanedLine = line.replace(/^\s*[-*+\d.]+\s*/, "").replace(/[\[\]"']/g, "").trim();
      if (cleanedLine.length > 5 && cleanedLine.length < 100) {
        options.push(cleanedLine);
      }
    }
    if (options.length >= 3) {
      return options.slice(0, 5);
    }
    return PRESET_PROMPTS;
  };

  // Direct Gemini API call for generating options
  const callGeminiForOptions = async (history: string, latestChapter: string): Promise<string> => {
    const apiKey = settings.apiKey;
    if (!apiKey) {
      throw new Error("API Key 未设置");
    }

    const systemInstruction = `你是一位专门为仙侠修仙小说生成后续剧情选择分支的助手。请根据提供的小说前文历史以及刚刚生成的最新章节，推演并设计 5 个接下来的剧情推演方向选项（宿命轨迹）。
每个选项字数控制在 15 到 35 字之间，要带有《凡人修仙传》原著那种严肃修仙、克制又暗流涌动的风格，以及韩立与宋玉之间暧昧、斗智、禁忌双修的张力。
你必须只返回一个 JSON 数组，包含这 5 个选项。不要包含任何 markdown 代码块标记，如：
["选项一", "选项二", "选项三", "选项四", "选项五"]`;

    const modelsToTry = [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash"
    ];
    const maxRetriesPerModel = 2;
    let lastError: any = null;

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
        try {
          console.log(`[Gemini Direct Options] Attempting with model: ${model} (attempt ${attempt}/${maxRetriesPerModel})`);
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemInstruction }]
              },
              contents: [{
                role: "user",
                parts: [{
                  text: `前文小说历史：\n${history}\n\n最新生成的章节内容：\n${latestChapter}\n\n请根据上述内容，推演下一步的 5 个剧情走向选项，以 JSON 数组格式返回：`
                }]
              }],
              generationConfig: {
                temperature: 0.85,
                responseMimeType: "application/json"
              }
            })
          });

          const data = await res.json();

          if (!res.ok) {
            const errMsg = data?.error?.message || JSON.stringify(data);
            const status = res.status;
            
            const isRetryable = status === 503 || status === 429 ||
                                errMsg.toLowerCase().includes("limit") ||
                                errMsg.toLowerCase().includes("quota") ||
                                errMsg.toLowerCase().includes("exhausted") ||
                                errMsg.toLowerCase().includes("unavailable") ||
                                errMsg.toLowerCase().includes("overloaded");

            console.warn(`[Gemini Direct Options] Error with model ${model} (status ${status}):`, errMsg);

            if (isRetryable && attempt < maxRetriesPerModel) {
              const delay = attempt * 1500;
              await new Promise(r => setTimeout(r, delay));
              continue;
            } else {
              lastError = new Error(errMsg);
              break;
            }
          }

          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            console.log(`[Gemini Direct Options] Generation succeeded with model: ${model}`);
            return text;
          }
          throw new Error("Gemini 返回了空内容，请重试。");
        } catch (err: any) {
          lastError = err;
          console.warn(`[Gemini Direct Options] Exception with model ${model} (attempt ${attempt}/${maxRetriesPerModel}):`, err.message || err);
          
          const errStr = String(err.message || err).toLowerCase();
          const isRetryable = errStr.includes("503") || 
                              errStr.includes("429") || 
                              errStr.includes("limit") || 
                              errStr.includes("quota") || 
                              errStr.includes("exhausted") || 
                              errStr.includes("unavailable") || 
                              errStr.includes("overloaded") ||
                              errStr.includes("fetch") ||
                              errStr.includes("network");

          if (isRetryable && attempt < maxRetriesPerModel) {
            const delay = attempt * 1500;
            await new Promise(r => setTimeout(r, delay));
          } else {
            break;
          }
        }
      }
    }
    throw lastError || new Error("所有模型生成选项均调用失败，请重试。");
  };

  // Main coordinator function to generate options
  const generateFateOptions = async (historyChapters: Chapter[], currentCap: Chapter) => {
    const hasApiKey = settings.apiKey && settings.apiKey.trim() !== "";
    const hasCustomUrl = settings.apiUrl && settings.apiUrl.trim() !== "";
    const isNative = isNativeApp();

    if (!hasApiKey && !hasCustomUrl && isNative) {
      console.log("[Fate Options] No API key for mobile, skipping options generation.");
      return;
    }

    setIsGeneratingOptions(true);
    try {
      const historyText = historyChapters
        .filter(c => c.id < currentCap.id)
        .map(c => `【${c.title}】\n${c.content}`)
        .join("\n\n");
      const latestText = `【${currentCap.title}】\n${currentCap.content}`;

      let resultText = "";
      let calledServer = false;

      if (hasCustomUrl) {
        const res = await fetch(`${settings.apiUrl}/api/generate-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: historyText, latestChapter: latestText })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "后端生成选项失败");
        resultText = data.options;
      } else if (!isNative) {
        // Browser version: Try relative Express server proxy first
        try {
          const res = await fetch("/api/generate-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ history: historyText, latestChapter: latestText })
          });
          if (res.status === 404) {
            calledServer = false;
          } else {
            calledServer = true;
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "代理生成选项失败");
            resultText = data.options;
          }
        } catch (e) {
          console.warn("Failed to call server options API, falling back to direct call:", e);
          calledServer = false;
          if (!hasApiKey) {
            throw e;
          }
        }
      }

      if (!hasCustomUrl && (isNative || !calledServer)) {
        if (!hasApiKey) {
          throw new Error("直连/静态部署模式下，请先填入 Gemini API Key。");
        }
        resultText = await callGeminiForOptions(historyText, latestText);
      }

      const options = extractOptions(resultText);
      setFateOptions(options);
    } catch (err: any) {
      console.warn("自动生成剧情走向选项失败:", err.message || err);
    } finally {
      setIsGeneratingOptions(false);
    }
  };

  // Generate Next Chapter
  const generateNextChapter = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) {
      setErrorMsg("请先在右侧输入框写入或选择一个剧情走向提示。");
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    const novelHistory = chapters
      .map(c => `【${c.title}】\n${c.content}`)
      .join("\n\n");

    try {
      let generatedText: string = "";

      const hasCustomUrl = settings.apiUrl && settings.apiUrl.trim();
      const isNative = isNativeApp();
      let calledServer = false;

      if (hasCustomUrl) {
        // Call custom backend API (either mobile or desktop)
        const res = await fetch(`${settings.apiUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: novelHistory, prompt: prompt })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "后端服务器请求失败");
        generatedText = data.text;
      } else if (!isNative) {
        // Browser version: Try relative Express server proxy first
        try {
          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ history: novelHistory, prompt: prompt })
          });
          if (res.status === 404) {
            calledServer = false;
          } else {
            calledServer = true;
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "请求服务器失败");
            generatedText = data.text;
          }
        } catch (e: any) {
          console.warn("Failed to call server API, falling back to direct call:", e);
          calledServer = false;
          if (!settings.apiKey) {
            throw e;
          }
        }
      }

      if (!hasCustomUrl && (isNative || !calledServer)) {
        // Mobile app or static web deployment (e.g. GitHub Pages): call Gemini REST API directly
        generatedText = await callGeminiDirectly(novelHistory, prompt);
      }

      const newId = chapters.length + 1;
      const newChapter: Chapter = {
        id: newId,
        title: `第${newId}章：${prompt.length > 12 ? prompt.slice(0, 12) + "..." : prompt}`,
        subtitle: `AI 续写自：${prompt.length > 20 ? prompt.slice(0, 20) + "..." : prompt}`,
        content: generatedText,
        isAiGenerated: true,
        promptUsed: prompt
      };

      const updatedChapters = [...chapters, newChapter];
      setChapters(updatedChapters);
      setSelectedId(newId);
      setPrompt("");

      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }

      // Automatically generate new options for the next step
      generateFateOptions(updatedChapters, newChapter);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "生成失败，可能您的 GEMINI_API_KEY 无效或受限。");
    } finally {
      setIsGenerating(false);
    }
  };

  const selectPresetPrompt = (preset: string) => {
    setPrompt(preset);
  };

  // High contrast custom themes supporting the Bold Typography aesthetic
  const getThemeClasses = () => {
    switch (settings.theme) {
      case "silk-light":
        return {
          appBg: "bg-[#F8F6F2] text-[#2C2925] selection:bg-[#EAE4D9]",
          cardBg: "bg-white border-[#2C2925]/10 shadow-sm",
          textMuted: "text-[#2C2925]/60",
          textTitle: "text-[#2C2925]",
          accentColor: "text-[#96743A] bg-[#96743A]/10 border-[#96743A]/20",
          accentText: "text-[#96743A]",
          accentBorder: "border-[#2C2925]/10",
          accentBtn: "bg-[#2C2925] hover:bg-[#403B35] text-white",
          sidebarActive: "bg-[#2C2925]/5 text-[#96743A] border-l-4 border-[#96743A]",
          sidebarHover: "hover:bg-[#2C2925]/5",
          inputBg: "bg-[#F8F6F2] border-[#2C2925]/20 text-[#2C2925] focus:border-[#96743A]",
          readerBg: "bg-transparent",
          dividerColor: "border-[#2C2925]/10",
          giganticText: "text-transparent bg-clip-text bg-gradient-to-b from-[#2C2925]/15 to-[#2C2925]/5"
        };
      case "bamboo-green":
        return {
          appBg: "bg-[#0B1311] text-[#E2EDE4] selection:bg-[#203D2E]",
          cardBg: "bg-[#13221E]/80 border-[#E2EDE4]/10 shadow-lg shadow-black/30",
          textMuted: "text-[#E2EDE4]/50",
          textTitle: "text-[#E2EDE4]",
          accentColor: "text-[#C9A66B] bg-[#C9A66B]/15 border-[#C9A66B]/30",
          accentText: "text-[#C9A66B]",
          accentBorder: "border-[#E2EDE4]/10",
          accentBtn: "bg-[#C9A66B] hover:bg-[#E2BE80] text-[#0B1311] font-bold",
          sidebarActive: "bg-[#1A312B] text-[#C9A66B] border-l-4 border-[#C9A66B]",
          sidebarHover: "hover:bg-[#1A312B]/40",
          inputBg: "bg-[#0B1311]/60 border-[#E2EDE4]/20 text-[#E2EDE4] focus:border-[#C9A66B]",
          readerBg: "bg-transparent",
          dividerColor: "border-[#E2EDE4]/10",
          giganticText: "text-transparent bg-clip-text bg-gradient-to-b from-[#E2EDE4]/20 to-[#E2EDE4]/3"
        };
      case "mystic-dark":
      default:
        return {
          appBg: "bg-[#0D0D0D] text-[#E0D8D0] selection:bg-[#453725]/80",
          cardBg: "bg-[#141414] border-[#E0D8D0]/10 shadow-xl shadow-black/80",
          textMuted: "text-[#E0D8D0]/40",
          textTitle: "text-[#E0D8D0]",
          accentColor: "text-[#C9A66B] bg-[#C9A66B]/15 border-[#C9A66B]/30",
          accentText: "text-[#C9A66B]",
          accentBorder: "border-[#E0D8D0]/10",
          accentBtn: "bg-[#C9A66B] hover:bg-[#E2BE80] text-[#0D0D0D] font-bold",
          sidebarActive: "bg-[#212121] text-[#C9A66B] border-l-4 border-[#C9A66B]",
          sidebarHover: "hover:bg-[#1C1C1C]",
          inputBg: "bg-[#090909] border-[#E0D8D0]/20 text-[#E0D8D0] focus:border-[#C9A66B]",
          readerBg: "bg-transparent",
          dividerColor: "border-[#E0D8D0]/10",
          giganticText: "text-transparent bg-clip-text bg-gradient-to-b from-[#E0D8D0]/20 to-[#E0D8D0]/3"
        };
    }
  };

  const themeClasses = getThemeClasses();

  // Parse chapter content into paragraphs for elegant editorial formatting
  const renderEditorialContent = (content: string) => {
    const paragraphs = content.split("\n").map(p => p.trim()).filter(Boolean);
    return paragraphs.map((para, index) => {
      const isQuote = para.startsWith("“") || para.startsWith("‘") || para.startsWith("【") || para.includes("“");
      let className = "mb-8 text-justify leading-[1.85] tracking-wide ";
      
      if (index === 0) {
        className += "dropcap ";
      }
      
      if (isQuote) {
        className += `italic ${themeClasses.accentText} font-serif font-medium `;
      } else {
        className += "opacity-90 font-serif ";
      }
      
      return (
        <p key={index} className={className}>
          {para}
        </p>
      );
    });
  };

  // Convert chapter index to uppercase Roman numeral or styled digit
  const getRomanNumeral = (num: number) => {
    const romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    return romans[num - 1] || num.toString().padStart(2, '0');
  };

  return (
    <div id="app-root" className={`min-h-screen ${themeClasses.appBg} flex flex-col transition-all duration-500 relative font-serif`}>
      
      {/* Decorative luxury gradient background glow */}
      <div className="absolute inset-0 pointer-events-none opacity-10 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#C9A66B]/20 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#C9A66B]/5 rounded-full blur-3xl"></div>
      </div>

      {/* Top Header Section */}
      <header className={`z-10 border-b ${themeClasses.dividerColor} ${themeClasses.cardBg} px-8 py-4 flex items-center justify-between transition-all duration-300`}>
        <div className="flex items-center space-x-4">
          <div className="p-2 border border-[#C9A66B]/30 rounded-lg">
            <Feather className={`w-5 h-5 ${themeClasses.accentText}`} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-widest uppercase font-serif flex items-center gap-2">
              落云修仙传 <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C9A66B]/20 text-[#C9A66B] border border-[#C9A66B]/30 font-sans tracking-widest uppercase">灵茶秘话</span>
            </h1>
            <p className={`text-[10px] tracking-wider font-sans uppercase ${themeClasses.textMuted}`}>吹茶仙子宋玉 × 元婴大能韩立 • 禁忌宿命双修</p>
          </div>
        </div>

        {/* Header Sound & reset controls */}
        <div className="flex items-center space-x-6">
          <div className="hidden md:flex items-center space-x-3 bg-black/40 px-3 py-1.5 rounded-lg border border-[#E0D8D0]/10">
            <button
              onClick={toggleAmbience}
              className={`p-1 rounded transition-colors ${
                ambientPlaying ? "bg-[#C9A66B]/20 text-[#C9A66B]" : "hover:bg-white/5 text-[#E0D8D0]/40"
              }`}
              title="播放静室白噪音"
            >
              {ambientPlaying ? <Volume2 className="w-3.5 h-3.5 animate-pulse" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <div className="flex flex-col">
              <span className="text-[9px] text-[#E0D8D0]/50 font-sans tracking-wider uppercase">静室雨夜氛围</span>
              <div className="flex items-center space-x-1.5">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={ambientVolume}
                  onChange={(e) => setAmbientVolume(parseFloat(e.target.value))}
                  disabled={!ambientPlaying}
                  className="w-14 h-[2px] bg-[#E0D8D0]/10 rounded appearance-none cursor-pointer accent-[#C9A66B] disabled:opacity-30"
                />
              </div>
            </div>
          </div>

          <button
            onClick={resetChapters}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded border text-[10px] uppercase tracking-widest transition-all ${themeClasses.sidebarHover} ${themeClasses.accentBorder} font-sans`}
            title="重置原著小说"
          >
            <RotateCcw className="w-3 h-3" />
            <span>重置</span>
          </button>
        </div>
      </header>

      {/* Main Layout Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-0 border-r border-l border-[#E0D8D0]/10 min-h-[calc(100vh-140px)]">
        
        {/* PANEL 1 (lg:col-span-3): Dramatic Visual Poster (Matches Design Aesthetic) */}
        <section className={`lg:col-span-3 flex flex-col justify-between p-8 border-r ${themeClasses.dividerColor} relative bg-black/10`}>
          <div className="space-y-6">
            <div className={`text-[10px] tracking-[0.4em] uppercase ${themeClasses.textMuted} font-sans`}>
              Chapter Serialization
            </div>
            
            {/* Dramatic giant Roman numeral background */}
            <div className={`text-[110px] font-bold leading-none select-none tracking-tighter ${themeClasses.giganticText} -ml-2 font-serif`}>
              {getRomanNumeral(currentChapter.id)}
            </div>

            <div className="space-y-3">
              <span className={`text-[10px] px-2 py-0.5 rounded border border-[#C9A66B]/30 text-[#C9A66B] bg-[#C9A66B]/5 uppercase tracking-widest font-sans inline-block`}>
                第 {currentChapter.id} 卷
              </span>
              <h2 className="text-3xl font-light leading-tight font-serif text-[#E0D8D0]">
                {currentChapter.title.includes("：") ? currentChapter.title.split("：")[1] : currentChapter.title}
              </h2>
              <p className={`text-xs italic ${themeClasses.textMuted} font-serif leading-relaxed pt-1`}>
                {currentChapter.subtitle}
              </p>
            </div>
          </div>

          {/* Vertical layout footer tags */}
          <div className="flex items-end gap-6 pt-12 lg:pt-0">
            <div className={`[writing-mode:vertical-rl] text-[9px] tracking-[0.3em] uppercase ${themeClasses.textMuted} font-sans border-r ${themeClasses.dividerColor} pr-3 py-2 shrink-0`}>
              FALLING CLOUD SECT • SONG YU • HAN LI
            </div>
            <div className="flex-1">
              <p className={`text-[11px] leading-relaxed opacity-60 font-serif`}>
                “道友，在这宗门里，你不再是那个掌控一切的元婴大能，而是在我面前……一个被彻底标记的囚徒。”
              </p>
            </div>
          </div>
        </section>

        {/* PANEL 2 (lg:col-span-6): Beautiful Reading Canvas (Matches Right Column Narrative Display) */}
        <section className="lg:col-span-6 flex flex-col p-8 md:p-12 relative">
          
          {/* Header Metadata block */}
          <div className={`flex justify-between items-center mb-8 border-b ${themeClasses.dividerColor} pb-4`}>
            <div className={`flex gap-6 text-[9px] tracking-widest uppercase font-sans ${themeClasses.textMuted}`}>
              <span>章数: {currentChapter.id} / {chapters.length}</span>
              <span>字数: ~{currentChapter.content.length} 字</span>
              <span>氛围: {settings.theme === "silk-light" ? "月白" : settings.theme === "bamboo-green" ? "深竹" : "幽室"}</span>
            </div>
            <div className="w-16 h-[1px] bg-[#C9A66B]/50"></div>
          </div>

          {/* AI generated tag header overlay */}
          {currentChapter.isAiGenerated && (
            <div className="mb-6 p-3 rounded bg-[#C9A66B]/5 border border-[#C9A66B]/20 flex items-center justify-between text-[11px]">
              <span className={`flex items-center gap-1.5 font-mono ${themeClasses.accentText}`}>
                <Sparkles className="w-3.5 h-3.5" />
                AI 灵力推演章节 (自定走向)
              </span>
              <button
                onClick={deleteCurrentChapter}
                className="text-red-400 hover:text-red-300 font-sans tracking-wider uppercase text-[10px] flex items-center gap-0.5"
                title="删除当前AI续写章节"
              >
                <Trash2 className="w-3 h-3" />
                <span>销毁</span>
              </button>
            </div>
          )}

          {/* Core scrollable text pane with Drop Cap first-letter and beautiful font settings */}
          <div 
            ref={scrollContainerRef}
            className={`flex-1 overflow-y-auto pr-2 text-justify transition-all duration-300 ${settings.fontFamily}`}
            style={{ fontSize: `${settings.fontSize}px`, maxHeight: "58vh" }}
          >
            {renderEditorialContent(currentChapter.content)}
          </div>

          {/* Pagination Footer controls (Classical elegant arrows) */}
          <div className={`mt-8 border-t ${themeClasses.dividerColor} pt-6 flex items-center justify-between`}>
            <button
              disabled={selectedId <= 1}
              onClick={() => {
                setSelectedId(prev => Math.max(1, prev - 1));
                if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
              }}
              className={`flex items-center gap-1 px-3 py-1.5 border ${themeClasses.dividerColor} rounded text-xs font-sans uppercase tracking-widest transition-all ${
                selectedId <= 1 ? "opacity-20 cursor-not-allowed" : "hover:bg-[#C9A66B]/10 hover:text-[#C9A66B]"
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一章</span>
            </button>

            <span className="text-[10px] font-sans uppercase tracking-widest opacity-40">
              落云灵茶秘话 • {selectedId}/{chapters.length}
            </span>

            <button
              disabled={selectedId >= chapters.length}
              onClick={() => {
                setSelectedId(prev => Math.min(chapters.length, prev + 1));
                if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
              }}
              className={`flex items-center gap-1 px-3 py-1.5 border ${themeClasses.dividerColor} rounded text-xs font-sans uppercase tracking-widest transition-all ${
                selectedId >= chapters.length ? "opacity-20 cursor-not-allowed" : "hover:bg-[#C9A66B]/10 hover:text-[#C9A66B]"
              }`}
            >
              <span>下一章</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* PANEL 3 (lg:col-span-3): Settings panel & AI Plot Generator Console */}
        <section className={`lg:col-span-3 p-6 flex flex-col justify-between border-l ${themeClasses.dividerColor} bg-black/5`}>
          
          {/* Top section: Reader settings */}
          <div className="space-y-6">
            
            {/* Preference block */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-[#C9A66B] flex items-center gap-1.5 font-sans">
                <Sliders className="w-3.5 h-3.5" />
                <span>玉简秘色阅读偏好</span>
              </h3>

              {/* Theme toggle buttons */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-sans tracking-wider opacity-50">阅读氛围</span>
                <div className="grid grid-cols-3 gap-1">
                  {(["mystic-dark", "bamboo-green", "silk-light"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setSettings(prev => ({ ...prev, theme: t }))}
                      className={`py-1 text-[10px] rounded transition-all font-sans uppercase border ${
                        settings.theme === t 
                          ? "border-[#C9A66B] text-[#C9A66B] bg-[#C9A66B]/10 font-bold" 
                          : `border-[#E0D8D0]/10 ${themeClasses.sidebarHover} text-[#E0D8D0]/60`
                      }`}
                    >
                      {t === "mystic-dark" ? "幽香" : t === "bamboo-green" ? "竹林" : "月白"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font selection */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-sans tracking-wider opacity-50">体悟字体</span>
                <div className="grid grid-cols-3 gap-1">
                  {(["font-serif", "font-sans", "font-mono"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setSettings(prev => ({ ...prev, fontFamily: f }))}
                      className={`py-1 text-[10px] rounded transition-all border ${
                        settings.fontFamily === f 
                          ? "border-[#C9A66B] text-[#C9A66B] bg-[#C9A66B]/10 font-bold" 
                          : `border-[#E0D8D0]/10 ${themeClasses.sidebarHover} text-[#E0D8D0]/60`
                      }`}
                    >
                      {f === "font-serif" ? "雅宋" : f === "font-sans" ? "现代" : "等宽"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Slider */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-sans uppercase opacity-50">
                  <span>字号大小</span>
                  <span className="text-[#C9A66B] font-mono">{settings.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="14"
                  max="28"
                  value={settings.fontSize}
                  onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                  className="w-full h-[2px] bg-[#E0D8D0]/10 rounded appearance-none cursor-pointer accent-[#C9A66B]"
                />
              </div>

              {/* Dynamic scroll options */}
              <div className="pt-2 border-t border-[#E0D8D0]/10">
                <label className="flex items-center justify-between cursor-pointer group">
                  <span className="text-[10px] font-sans uppercase tracking-wider text-[#E0D8D0]/70 group-hover:text-[#C9A66B] transition-colors">神识垂览 (自动滚动)</span>
                  <input
                    type="checkbox"
                    checked={settings.autoScroll}
                    onChange={(e) => setSettings(prev => ({ ...prev, autoScroll: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="relative w-7 h-3.5 bg-black/50 border border-[#E0D8D0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:bg-[#C9A66B] after:content-[''] after:absolute after:top-[1px] after:start-[1px] after:bg-[#E0D8D0]/40 after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-[#C9A66B]/20"></div>
                </label>

                {settings.autoScroll && (
                  <div className="space-y-1 mt-2 p-2 rounded bg-black/20 border border-[#E0D8D0]/5">
                    <div className="flex justify-between items-center text-[9px] font-mono">
                      <span className="opacity-40">周天运转速度</span>
                      <span className="text-[#C9A66B] font-bold">{settings.scrollSpeed} 迈</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={settings.scrollSpeed}
                      onChange={(e) => setSettings(prev => ({ ...prev, scrollSpeed: parseInt(e.target.value) }))}
                      className="w-full h-[1px] bg-[#E0D8D0]/10 appearance-none cursor-pointer accent-[#C9A66B]"
                    />
                  </div>
                )}
              </div>

              {/* Gemini API Key for mobile/static direct access */}
              <div className="pt-2 border-t border-[#E0D8D0]/10 space-y-1">
                <div className="flex justify-between items-center text-[10px] font-sans uppercase opacity-50">
                  <span>Gemini API Key (静态部署/手机端必填)</span>
                </div>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="AIza..."
                  className={`w-full p-1.5 rounded border text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-[#C9A66B] ${themeClasses.inputBg}`}
                />
                <p className={`text-[9px] leading-relaxed ${themeClasses.textMuted}`}>静态部署网页端 / 手机端直连调用 Gemini API，无需后端服务器。<br/>获取密钥：aistudio.google.com/apikey</p>
              </div>

              {/* Optional custom backend URL override */}
              <div className="pt-1 space-y-1">
                <div className="flex justify-between items-center text-[10px] font-sans uppercase opacity-50">
                  <span>自定义后端地址 (可选)</span>
                </div>
                <input
                  type="text"
                  value={settings.apiUrl}
                  onChange={(e) => setSettings(prev => ({ ...prev, apiUrl: e.target.value }))}
                  placeholder="留空则直接调用 Gemini API"
                  className={`w-full p-1.5 rounded border text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-[#C9A66B] ${themeClasses.inputBg}`}
                />
              </div>
            </div>

            {/* Middle Section: AI plot choices */}
            <div className="space-y-3 pt-4 border-t border-[#E0D8D0]/10">
              <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-[#C9A66B] flex items-center gap-1.5 font-sans">
                <Compass className="w-3.5 h-3.5" />
                <span>剧情推演方向</span>
              </h3>
              <p className={`text-[10px] text-[#E0D8D0]/50 font-sans leading-relaxed`}>
                选择以下宿命轨迹，引导神魂：
              </p>
              
              <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1">
                {isGeneratingOptions ? (
                  <div className="space-y-2 py-1 animate-pulse">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="flex items-center gap-2 p-1.5 rounded border border-transparent">
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-[#C9A66B]/60 shrink-0" />
                        <div className="h-2.5 bg-white/10 rounded w-5/6"></div>
                      </div>
                    ))}
                    <p className={`text-[9px] text-[#C9A66B]/60 text-center font-sans tracking-wider pt-1`}>
                      天机推演中，正在孕育新的宿命轨迹...
                    </p>
                  </div>
                ) : (
                  fateOptions.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => selectPresetPrompt(preset)}
                      className={`w-full text-left p-2 rounded border text-[10px] transition-all flex items-start gap-1 font-serif ${
                        prompt === preset 
                          ? "border-[#C9A66B] text-[#C9A66B] bg-[#C9A66B]/5 font-medium" 
                          : "border-transparent text-[#E0D8D0]/70 hover:bg-white/5 hover:text-[#E0D8D0]"
                      }`}
                    >
                      <CornerDownRight className="w-2.5 h-2.5 shrink-0 mt-0.5 opacity-40" />
                      <span className="line-clamp-2 leading-relaxed">{preset}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Bottom portion: input & generator button */}
          <div className="pt-6 border-t border-[#E0D8D0]/10 space-y-3 mt-6 lg:mt-0">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="自拟后续神异走向（例如：南宫婉突然推门而入，震惊地目睹这一切...）"
              rows={3}
              className={`w-full p-2.5 rounded border text-[11px] leading-relaxed focus:ring-1 focus:ring-[#C9A66B] focus:outline-none transition-all resize-none font-serif ${themeClasses.inputBg}`}
              maxLength={200}
            />

            {errorMsg && (
              <p className="text-[10px] text-red-400 font-mono leading-relaxed bg-red-950/20 p-2 rounded border border-red-900/30">
                {errorMsg}
              </p>
            )}

            <button
              onClick={generateNextChapter}
              disabled={isGenerating || !prompt.trim()}
              className={`w-full py-2 px-3 rounded font-sans uppercase tracking-[0.2em] text-[10px] flex items-center justify-center space-x-2 transition-all ${
                isGenerating || !prompt.trim()
                  ? "bg-white/5 text-[#E0D8D0]/20 border border-[#E0D8D0]/10 cursor-not-allowed"
                  : `${themeClasses.accentBtn} shadow-lg shadow-[#C9A66B]/5`
              }`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>祭炼秘简中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 运转：推演下一卷</span>
                </>
              )}
            </button>
          </div>
        </section>

      </main>

      {/* Immersive Loader Screen */}
      {isGenerating && (
        <div className="fixed inset-0 bg-[#0D0D0D]/95 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-sm animate-fadeIn">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="relative inline-block">
              <div className="w-20 h-20 rounded-full border-2 border-[#C9A66B]/20 border-t-[#C9A66B] animate-spin flex items-center justify-center">
                <BookOpenText className="w-8 h-8 text-[#C9A66B] animate-pulse" />
              </div>
              <div className="absolute -inset-2 bg-[#C9A66B]/5 rounded-full blur-xl animate-pulse"></div>
            </div>

            <div className="space-y-1">
              <h3 className="text-md font-bold font-serif text-[#C9A66B] tracking-widest uppercase">
                灵气交泰 • 周天编织中
              </h3>
              <p className="text-[10px] text-[#E0D8D0]/60 max-w-xs mx-auto font-sans uppercase tracking-wider">
                元婴与结丹的大跨度交融正在归入万象，请稍候...
              </p>
            </div>

            <div className="p-4 rounded border border-[#E0D8D0]/10 bg-black/40 shadow-inner">
              <p className="text-[11px] font-serif text-[#C9A66B] transition-all duration-500 animate-pulse">
                {loadingStep}
              </p>
            </div>

            <div className="flex justify-center space-x-1.5">
              <span className="w-1.5 h-1.5 bg-[#C9A66B] rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-[#C9A66B] rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1.5 h-1.5 bg-[#C9A66B] rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        </div>
      )}

      {/* Modern minimal footer */}
      <footer className={`text-center py-4 text-[9px] ${themeClasses.textMuted} tracking-[0.35em] uppercase border-t ${themeClasses.dividerColor} relative z-10 bg-black/20 font-sans`}>
        落云宗翠竹轩出品 © 2026 落云修仙传：灵茶秘话 • v4.2 BOLD TYPOGRAPHY EDITION
      </footer>
    </div>
  );
}
