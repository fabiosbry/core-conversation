"use client";

import { useVoice, VoiceReadyState } from "@humeai/voice-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  emotions?: { name: string; score: number }[];
  timestamp: Date;
  hidden?: boolean;
}

// Keywords for PAUSE mode
const PAUSE_KEYWORDS = [
  "hold on",
  "wait",
  "one second",
  "let me think",
  "give me a moment",
  "pause",
  "just a sec",
  "hang on",
];

// Keywords for SHORT/QUICK mode
const SHORT_KEYWORDS = ["quick", "brief", "short", "hurry", "rush", "fast"];

// Keywords for DETAILED mode
const DETAILED_KEYWORDS = [
  "detail",
  "explain",
  "more time",
  "elaborate",
  "in depth",
  "how does that work",
  "what do you mean",
  "tell me more",
];

// Keywords for INTERRUPT
const INTERRUPT_KEYWORDS = ["interrupt me", "lost", "yesterday"];

export default function CoreConversation() {
  const {
    connect,
    disconnect,
    readyState,
    messages,
    sendSessionSettings,
    sendUserInput,
    isMuted,
    mute,
    unmute,
    isAudioMuted,
    muteAudio,
    unmuteAudio,
    error,
    micFft,
    fft,
    isPlaying,
  } = useVoice();

  const [conversation, setConversation] = useState<Message[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [currentEmotions, setCurrentEmotions] = useState<{ name: string; score: number }[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHeadphoneTip, setShowHeadphoneTip] = useState(false);
  const [showFeatureTip, setShowFeatureTip] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pauseResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const interruptCooldownRef = useRef(false);
  const interruptActiveRef = useRef(false);
  const interruptMutedPhaseRef = useRef(false);
  
  // LLM Judge refs
  const turnStartRef = useRef(0);
  const lastJudgeRef = useRef(0);
  const judgeAbortRef = useRef<AbortController | null>(null);

  const isConnected = readyState === VoiceReadyState.OPEN;
  
  // LLM Judge - calls triggerInterrupt() just like keyword detection
  async function checkLLMInterrupt(speech: string) {
    if (interruptCooldownRef.current) return;
    
    // Need 6+ words and 1.2s+ speaking time
    const words = speech.split(/\s+/).filter(Boolean).length;
    if (words < 6) return;
    
    const speakingTime = (Date.now() - turnStartRef.current) / 1000;
    if (speakingTime < 1.2) return;
    
    // Debounce 400ms
    if (Date.now() - lastJudgeRef.current < 400) return;
    lastJudgeRef.current = Date.now();
    
    // Abort previous request
    judgeAbortRef.current?.abort();
    judgeAbortRef.current = new AbortController();
    
    try {
      const res = await fetch("/api/judge-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speech, speakingTime }),
        signal: judgeAbortRef.current.signal,
      });
      const { interrupt } = await res.json();
      
      // Same as keyword: just call triggerInterrupt()
      if (interrupt && !interruptCooldownRef.current) {
        triggerInterrupt();
      }
    } catch {}
  }

  useEffect(() => {
    if (isConnected) {
      setIsConnecting(false);
      // Show headphone tip on mobile
      if (window.innerWidth < 768) {
        setShowHeadphoneTip(true);
        setTimeout(() => setShowHeadphoneTip(false), 5000);
      }
      // Show feature tip on both mobile and desktop (after headphone tip on mobile)
      const featureTipDelay = window.innerWidth < 768 ? 5500 : 500;
      setTimeout(() => {
        setShowFeatureTip(true);
        setTimeout(() => setShowFeatureTip(false), 8000);
      }, featureTipDelay);
    }
  }, [isConnected]);

  // Auto-scroll transcript
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  // Process messages from Hume
  useEffect(() => {
    if (!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!("type" in lastMessage)) return;

    if (lastMessage.type === "user_interruption" && !interruptActiveRef.current) {
      muteAudio();
      unmuteAudio();
    }

    if (lastMessage.type === "user_message") {
      const content = (lastMessage as any).message?.content || "";
      const emotions = extractEmotions(lastMessage);
      const isInterim = (lastMessage as any).interim === true;
      const isInstructionMessage = content.includes("CRITICAL INSTRUCTION");
      
      // Track when user starts speaking
      if (isInterim && turnStartRef.current === 0) {
        turnStartRef.current = Date.now();
      }

      setConversation((prev) => {
        const lastConv = prev[prev.length - 1];
        if (lastConv?.role === "user" && !lastConv.hidden) {
          return [...prev.slice(0, -1), { ...lastConv, content, emotions, hidden: isInstructionMessage }];
        }
        return [...prev, { role: "user", content, emotions, timestamp: new Date(), hidden: isInstructionMessage }];
      });

      setCurrentEmotions(emotions);

      // Check interrupt keywords (fast path)
      if (content && !interruptCooldownRef.current) {
        const lower = content.toLowerCase();
        for (const kw of INTERRUPT_KEYWORDS) {
          if (lower.includes(kw)) {
            triggerInterrupt();
            break;
          }
        }
      }
      
      // LLM Judge on interim (same result: calls triggerInterrupt)
      if (isInterim && content) {
        checkLLMInterrupt(content);
      }

      if (!isInterim) {
        detectModeKeywords(content);
        turnStartRef.current = 0; // Reset for next turn
      }
    }

    if (lastMessage.type === "assistant_message") {
      const content = (lastMessage as any).message?.content || "";
      const shouldHide = isPaused || interruptMutedPhaseRef.current;

      setConversation((prev) => {
        const lastConv = prev[prev.length - 1];
        if (lastConv?.role === "assistant" && !lastConv.hidden) {
          return [
            ...prev.slice(0, -1),
            { ...lastConv, content: lastConv.content + " " + content, hidden: shouldHide ? true : lastConv.hidden },
          ];
        }
        return [...prev, { role: "assistant", content, timestamp: new Date(), hidden: shouldHide }];
      });
    }
  }, [messages, isPaused]);

  // Auto-resume from pause
  useEffect(() => {
    if (!isPaused || isMuted) return;
    if (!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!("type" in lastMessage)) return;

    if (lastMessage.type === "user_message") {
      const content = (lastMessage as any).message?.content || "";
      const isPausePhrase = PAUSE_KEYWORDS.some((kw) => content.toLowerCase().includes(kw));
      if (!isPausePhrase && content.length > 5) {
        handleResume();
      }
    }
  }, [messages, isPaused, isMuted]);

  function extractEmotions(msg: any): { name: string; score: number }[] {
    try {
      const prosody = msg.models?.prosody?.scores;
      if (!prosody) return [];
      return Object.entries(prosody)
        .map(([name, score]) => ({ name, score: score as number }))
        .filter((e) => e.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  function detectModeKeywords(text: string) {
    const lower = text.toLowerCase();

    for (const kw of PAUSE_KEYWORDS) {
      if (lower.includes(kw) && !isPaused) {
        triggerPause();
        return;
      }
    }

    for (const kw of SHORT_KEYWORDS) {
      if (lower.includes(kw)) {
        sendSessionSettings({
          context: { text: "Keep responses very brief. Answer in 1 short sentence.", type: "editable" as any },
        });
        return;
      }
    }

    for (const kw of DETAILED_KEYWORDS) {
      if (lower.includes(kw)) {
        sendSessionSettings({
          context: { text: "Provide detailed explanations with examples.", type: "editable" as any },
        });
        return;
      }
    }
  }

  async function triggerInterrupt() {
    if (interruptCooldownRef.current) return;
    interruptCooldownRef.current = true;
    interruptActiveRef.current = true;
    interruptMutedPhaseRef.current = true;

    mute();
    muteAudio();

    // STEP 1: Wait 100ms then send "ok" prime to make AI respond fast
    await new Promise((r) => setTimeout(r, 100));
    sendUserInput(
      `CRITICAL INSTRUCTION: YOUR NEXT MESSAGE MUST BE "ok" nothing else, end there, just "ok".`
    );

    // STEP 2: Reduced wait time since AI should respond with "ok" very fast
    const pauseTime = window.innerWidth < 768 ? 900 : 650;
    await new Promise((r) => setTimeout(r, pauseTime));

    // STEP 3: Now send the actual interrupt prompt
    sendUserInput(
      `CRITICAL INSTRUCTION: Begin your next message with "Sorry to interrupt, but..." then ask a brief question or make an observation that directly relates to what the user was just talking about. Reference specific details from their recent messages to show you're engaged with their actual topic. Keep it concise but personalized to the conversation context.`
    );

    await new Promise((r) => setTimeout(r, 500));
    interruptMutedPhaseRef.current = false;
    unmuteAudio();

    setTimeout(() => {
      unmute();
      interruptActiveRef.current = false;
    }, 5000);

    setTimeout(() => {
      interruptCooldownRef.current = false;
    }, 12000);
  }

  function triggerPause() {
    if (interruptActiveRef.current) return;
    muteAudio();
    mute();
    setIsPaused(true);

    if (pauseResumeTimeoutRef.current) clearTimeout(pauseResumeTimeoutRef.current);
    pauseResumeTimeoutRef.current = setTimeout(() => {
      if (!interruptActiveRef.current) unmute();
    }, 2000);
  }

  function handleResume() {
    if (interruptActiveRef.current) return;
    if (pauseResumeTimeoutRef.current) clearTimeout(pauseResumeTimeoutRef.current);
    unmuteAudio();
    unmute();
    setIsPaused(false);
  }

  async function handleConnect() {
    if (isConnecting) return;
    setIsConnecting(true);

    interruptCooldownRef.current = false;
    interruptActiveRef.current = false;
    interruptMutedPhaseRef.current = false;
    turnStartRef.current = 0;
    lastJudgeRef.current = 0;

    try {
      const response = await fetch("/api/hume-token");
      if (!response.ok) throw new Error("Failed to get access token");
      const { accessToken } = await response.json();

      const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID;
      await connect({
        auth: { type: "accessToken", value: accessToken },
        ...(configId && { configId }),
      });
    } catch (e) {
      console.error("Connection error:", e);
      setIsConnecting(false);
    }
  }

  function handleDisconnect() {
    disconnect();
    setConversation([]);
    setIsPaused(false);
    setIsConnecting(false);
    setShowTranscript(false);
    interruptCooldownRef.current = false;
    interruptActiveRef.current = false;
    interruptMutedPhaseRef.current = false;
    turnStartRef.current = 0;
    lastJudgeRef.current = 0;
    judgeAbortRef.current?.abort();
  }

  const visualizerBars = isConnected && !isPaused ? (isMuted ? fft : micFft) : [];
  const normalizedBars = visualizerBars.slice(0, 32).map((v) => Math.max(0.15, v));

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Desktop background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="hidden md:block absolute inset-0 w-[100vh] h-[100vw] object-cover z-0 rotate-90 origin-center translate-x-[calc(50vw-50vh)]"
        style={{
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%) rotate(90deg)",
          minWidth: "100vh",
          minHeight: "100vw",
        }}
      >
        <source src="/video.mov" type="video/mp4" />
      </video>

      {/* Mobile background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="md:hidden absolute inset-0 w-full h-full object-cover z-0 scale-110"
      >
        <source src="/video-mobile.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 video-overlay z-[1]" />

      <div className="relative z-10 h-full w-full flex flex-col">
        {/* Header */}
        <header className="absolute top-0 left-0 right-0 pt-12 md:pt-8 px-4 md:px-8 pb-4 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex items-center gap-2 md:gap-4"
          >
            <h1 className="text-lg md:text-2xl font-semibold tracking-tight text-white">
              peoplemakethings
            </h1>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-white/50 uppercase tracking-wider">Live</span>
              </motion.div>
            )}
          </motion.div>
        </header>

        {/* Main Content */}
        <motion.div
          className="flex-1 flex items-center justify-center px-4"
          animate={{ y: showTranscript ? -60 : 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
        >
          <AnimatePresence mode="wait">
            {!isConnected ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                <motion.button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="relative group"
                  whileHover={!isConnecting ? { scale: 1.02 } : {}}
                  whileTap={!isConnecting ? { scale: 0.95 } : {}}
                  animate={isConnecting ? { scale: [1, 1.05, 1] } : {}}
                  transition={isConnecting ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : {}}
                >
                  <motion.div
                    className={`absolute inset-0 rounded-full ${isConnecting ? "bg-white/10" : "bg-white/5"}`}
                    animate={isConnecting ? { rotate: 360 } : {}}
                    transition={isConnecting ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
                  />

                  {isConnecting && (
                    <motion.div
                      className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-white/40"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  )}

                  <motion.div
                    className={`relative glass-strong rounded-full p-6 md:p-8 glow-subtle ${!isConnecting ? "breathe-pulse" : ""}`}
                    animate={isConnecting ? { opacity: [1, 0.7, 1] } : {}}
                    transition={isConnecting ? { duration: 1, repeat: Infinity } : {}}
                  >
                    <Mic className={`w-10 h-10 md:w-12 md:h-12 ${isConnecting ? "text-white/60" : "text-white"}`} strokeWidth={1.5} />
                  </motion.div>

                  {!isConnecting && (
                    <motion.div
                      className="absolute inset-0 rounded-full border border-white/20"
                      initial={{ scale: 1, opacity: 0 }}
                      whileHover={{ scale: 1.1, opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </motion.button>

                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-white/40 text-sm tracking-wide"
                >
                  {isConnecting ? "Connecting..." : "Tap to start conversation"}
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                <div className="relative">
                  {isPlaying && !isPaused && (
                    <>
                      <motion.div
                        className="absolute inset-0 rounded-full border border-white/20"
                        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                      />
                      <motion.div
                        className="absolute inset-0 rounded-full border border-white/10"
                        animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                        transition={{ duration: 2, delay: 0.5, repeat: Infinity, ease: "easeOut" }}
                      />
                    </>
                  )}

                  <motion.div
                    className="glass-strong rounded-full p-6 md:p-10 glow-subtle relative overflow-hidden"
                    animate={isPlaying && !isPaused ? { scale: [1, 1.02, 1] } : {}}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  >
                    {isPaused ? (
                      <div className="flex items-center justify-center h-12 w-24 md:h-16 md:w-32">
                        <span className="text-white/60 text-sm md:text-base">waiting...</span>
                      </div>
                    ) : interruptActiveRef.current ? (
                      <div className="flex items-center justify-center h-12 w-24 md:h-16 md:w-32">
                        <span className="text-white/60 text-sm md:text-base">interrupting...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-[2px] md:gap-[3px] h-12 w-24 md:h-16 md:w-32">
                        {normalizedBars.map((value, i) => (
                          <motion.div
                            key={i}
                            className="w-1 rounded-full bg-white/80"
                            animate={{
                              height: `${Math.max(8, value * 64)}px`,
                              opacity: 0.4 + value * 0.6,
                            }}
                            transition={{ duration: 0.05, ease: "easeOut" }}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                </div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <motion.button
                    onClick={handleDisconnect}
                    className="glass rounded-full p-3 md:p-4 hover:bg-white/10 transition-all"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <X className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
                  </motion.button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Show transcript button */}
        {isConnected && conversation.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setShowTranscript(!showTranscript)}
            className="hidden md:block absolute bottom-8 left-1/2 -translate-x-1/2 glass rounded-full px-6 py-3 text-xs text-white/60 hover:text-white/80 hover:bg-white/10 transition uppercase tracking-wider"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </motion.button>
        )}

        {/* Transcript panel */}
        <AnimatePresence>
          {showTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="hidden md:block absolute bottom-20 left-1/2 -translate-x-1/2 w-full max-w-lg"
            >
              <div className="glass-strong rounded-3xl p-6 max-h-64 overflow-y-auto">
                <div className="space-y-3">
                  {conversation
                    .filter((m) => !m.hidden)
                    .map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                            msg.role === "user" ? "bg-white/20 text-white" : "bg-white/5 text-white/80"
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{msg.content}</p>
                        </div>
                      </motion.div>
                    ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-24 left-1/2 -translate-x-1/2 glass rounded-2xl px-6 py-3 border-red-500/20 text-red-400 text-sm"
            >
              {error.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Emotions sidebar */}
        <AnimatePresence>
          {currentEmotions.length > 0 && isConnected && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`absolute right-4 md:right-8 top-20 md:top-1/2 md:-translate-y-1/2 ${showTranscript ? "hidden md:block" : ""}`}
            >
              <div className="glass rounded-xl md:rounded-2xl p-3 md:p-4 space-y-2 md:space-y-3">
                <p className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Emotions</p>
                {currentEmotions.slice(0, 2).map((emotion) => (
                  <div key={emotion.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 md:gap-4">
                      <span className="text-[10px] md:text-xs text-white/60 capitalize truncate max-w-[60px] md:max-w-none">
                        {emotion.name.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] md:text-xs text-white/40">{Math.round(emotion.score * 100)}%</span>
                    </div>
                    <div className="w-16 md:w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${emotion.score * 100}%` }}
                        className="h-full bg-white/50 rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Headphone tip for mobile */}
        <AnimatePresence>
          {showHeadphoneTip && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="md:hidden absolute top-24 left-4 right-4"
            >
              <div className="glass rounded-xl px-4 py-3 text-center cursor-pointer" onClick={() => setShowHeadphoneTip(false)}>
                <p className="text-white/70 text-xs">🎧 Use headphones for best experience</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Feature tip for both mobile and desktop */}
        <AnimatePresence>
          {showFeatureTip && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-24 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-md"
            >
              <div className="glass rounded-xl px-4 py-3 cursor-pointer" onClick={() => setShowFeatureTip(false)}>
                <div className="text-white/80 text-xs md:text-sm text-center leading-relaxed">
                  <p className="text-white mb-2">💡 Try getting me to:</p>
                  <p>• hold my response</p>
                  <p>• adjust verbosity</p>
                  <p>• interrupt you</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
