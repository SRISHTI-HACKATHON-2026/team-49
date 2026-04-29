"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useRef, useState } from "react";
import { auth, googleProvider, signInWithEmailAndPassword, signInWithPopup } from "../lib/firebase";
import { onAuthStateChanged, User, signOut } from "firebase/auth";

type ChatRole = "user" | "assistant";
type StressLevel = "LOW" | "MEDIUM" | "HIGH";

type ChatMessage = {
  role: ChatRole;
  text: string;
  stress?: StressLevel;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: Date;
};

const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent opacity-50"></div>
    </div>
  ),
});

const SUPPORTED_LANGUAGES = [
  { code: "en-US", name: "English" },
  { code: "hi-IN", name: "Hindi" },
  { code: "kn-IN", name: "Kannada" },
  { code: "mr-IN", name: "Marathi" },
];

if (typeof console !== "undefined") {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("Missing property")) {
      return; // Suppress harmless Spline runtime warning
    }
    originalError(...args);
  };
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [language, setLanguage] = useState(SUPPORTED_LANGUAGES[0].code);

  // Auth State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<"landing" | "login">("landing");

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("new");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSplineMouseDown = (e: any) => {
    console.log("Clicked Spline Object:", e.target?.name);
    if (view === "landing") {
      setView("login");
    }
  };

  const currentStress = messages.length > 0 
    ? [...messages].reverse().find(m => m.stress)?.stress || "LOW"
    : "LOW";
  const isDeepMode = currentStress === "HIGH";
  const demoMode = true;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // History fetching disabled to ensure a completely fresh session.

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load saved conversations on mount
  useEffect(() => {
    const saved = localStorage.getItem("carecompanion_conversations");
    if (saved) {
      try {
        setConversations(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse conversations", e);
      }
    }
  }, []);

  useEffect(() => {
    if (activeChatId === "new" && messages.length > 0) {
      const newId = Date.now().toString();
      setActiveChatId(newId);
      setConversations(curr => {
        const next = [
          { id: newId, title: messages[0].text.slice(0, 30) + "...", messages, updatedAt: new Date() },
          ...curr
        ];
        localStorage.setItem("carecompanion_conversations", JSON.stringify(next));
        return next;
      });
    } else if (activeChatId !== "new") {
      setConversations(curr => {
        const next = curr.map(c => c.id === activeChatId ? { ...c, messages, updatedAt: new Date() } : c);
        localStorage.setItem("carecompanion_conversations", JSON.stringify(next));
        return next;
      });
    }
  }, [messages, activeChatId]);

  const loadChat = (id: string) => {
    setActiveChatId(id);
    const target = conversations.find(c => c.id === id);
    if (target) setMessages(target.messages);
    setIsSidebarOpen(false);
  };

  const startNewChat = () => {
    setActiveChatId("new");
    setMessages([]);
    setIsSidebarOpen(false);
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmittingAuth(true);
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setAuthError(err.message || "Failed to log in.");
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsSubmittingAuth(true);
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError(err.message || "Failed to log in with Google.");
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser. Please try Chrome or Edge.");
      return;
    }
    
    if (isListening) return;
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setChatInput((prev) => prev ? prev + " " + transcript : transcript);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        console.error("Speech recognition error", event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  async function handleChatSubmit(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    const text = chatInput.trim();
    if (!text || isSendingChat) return;

    const userMessage: ChatMessage = { role: "user", text };
    setMessages((current) => [...current, userMessage]);
    setChatInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setIsSendingChat(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          text, 
          language,
          history: messages.slice(-8).map(m => ({ role: m.role, text: m.text }))
        }),
      });
      const data = (await response.json()) as { reply?: string; stress?: StressLevel };

      if (!response.ok || typeof data.reply !== "string") {
        throw new Error("Unable to get response.");
      }
      const replyText = data.reply;

      setMessages((current) => [
        ...current,
        { role: "assistant", text: replyText, stress: data.stress },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "That sounds like a full day. Hope you get a quiet minute soon.",
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/10 border-t-blue-500"></div>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020617] px-4 py-5 font-sans text-slate-200">
      {/* Hide Spline Watermark */}
      <style dangerouslySetInnerHTML={{ __html: `
        #logo, a[href*="spline.design"] {
          display: none !important;
        }
      `}} />

      {/* Immersive Deep Gradient Background */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-[#020617]/90 to-[#020617]"></div>
      
      {/* 3D Asset Container */}
      <div className="absolute inset-0 z-0 flex pointer-events-none">
        <div className={`relative h-full flex items-center justify-center mix-blend-screen pointer-events-auto transition-all duration-1000 ease-out ${
          (!user && view === "landing") ? "w-full opacity-100" : "w-full lg:w-[calc(100%-640px)] opacity-80"
        }`}>
          <Spline 
            scene={
              user ? "https://prod.spline.design/WUoG92pX2GJCg7Tb/scene.splinecode" : 
              view === "landing" ? "https://prod.spline.design/VGSu8vjoiJFGpRUy/scene.splinecode" : 
              "https://prod.spline.design/79i8QtCQkjOrZxDd/scene.splinecode"
            } 
            onMouseDown={handleSplineMouseDown}
          />
        </div>
      </div>

      {user ? (
        <section className={`pointer-events-auto relative z-10 ml-auto mr-4 flex h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[40px] border border-white/10 shadow-[0_0_120px_-20px_rgba(30,58,138,0.4)] backdrop-blur-3xl ring-1 ring-white/5 transition-all duration-1000 ease-in-out md:mr-8 lg:mr-16 ${
          isDeepMode ? "bg-[#01040f]/95" : "bg-slate-950/60"
        }`}>
          
          {/* Sidebar Overlay */}
          <div className={`absolute inset-0 z-50 flex transition-all duration-500 ${isSidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
            {/* Backdrop */}
            <div onClick={() => setIsSidebarOpen(false)} className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500 ${isSidebarOpen ? "opacity-100" : "opacity-0"}`}></div>
            {/* Panel */}
            <div className={`absolute bottom-0 left-0 top-0 flex w-[280px] flex-col border-r border-white/10 bg-[#020617]/95 shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-300">History</h2>
                <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                <button 
                  onClick={startNewChat}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition-all hover:bg-white/10"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                  <span className="text-[14px] font-medium text-slate-200">New Conversation</span>
                </button>
                <div className="pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">Previous</div>
                {conversations.map(conv => (
                  <button 
                    key={conv.id}
                    onClick={() => loadChat(conv.id)}
                    className={`w-full truncate rounded-xl p-3 text-left text-[14px] transition-all ${activeChatId === conv.id ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                  >
                    {conv.title}
                  </button>
                ))}
              </div>
              <div className="border-t border-white/10 p-4">
                <button onClick={handleLogout} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[13px] font-bold uppercase tracking-wider text-slate-400 transition-all hover:bg-red-500/20 hover:text-red-400">
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          {demoMode && (
            <div className="h-[3px] w-full bg-white/5 relative z-50">
              <div 
                className={`absolute left-0 top-0 h-full transition-all duration-1000 ease-in-out ${
                  currentStress === "LOW" ? "w-1/3 bg-gradient-to-r from-emerald-500/40 to-emerald-400/80" :
                  currentStress === "MEDIUM" ? "w-2/3 bg-gradient-to-r from-emerald-500/40 via-yellow-400/60 to-yellow-400/90" :
                  "w-full bg-gradient-to-r from-yellow-400/50 via-red-500/60 to-red-500/90"
                }`}
              />
            </div>
          )}

          <header className={`flex items-center justify-between border-b bg-white/[0.03] px-8 py-5 backdrop-blur-md transition-colors duration-1000 ${isDeepMode ? "border-white/[0.02]" : "border-white/5"}`}>
            <div className="flex items-center gap-4">
              <button onClick={() => setIsSidebarOpen(true)} className="group flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition-all hover:bg-white/10 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)] active:scale-95">
                <svg className="h-5 w-5 text-slate-300 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-[1.25rem] font-semibold tracking-wide text-transparent">CareCompanion AI</h1>
            </div>
            <div className="flex items-center gap-4">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="cursor-pointer appearance-none bg-white/5 hover:bg-white/10 transition-all border border-white/10 rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-300 outline-none shadow-sm"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                    {lang.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-3">
                <div className={`h-1.5 w-1.5 rounded-full transition-all duration-1000 ${currentStress === "HIGH" ? "bg-red-500/90 shadow-[0_0_8px_rgba(239,68,68,0.6)]" : "bg-white/10"}`} />
                <div className="relative flex h-4 w-4 items-center justify-center">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${isDeepMode ? "bg-indigo-400/50" : "bg-blue-400"}`}></span>
                  <span className={`relative inline-flex h-3 w-3 rounded-full ${isDeepMode ? "bg-indigo-500/80 shadow-[0_0_12px_rgba(99,102,241,0.5)]" : "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.9)]"}`}></span>
                </div>
              </div>
            </div>
          </header>

          <div className="mt-6 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-slate-500/60">
            {activeChatId === "new" ? "New Session" : "Archived Session"}
          </div>

          <div className={`flex-1 overflow-y-auto px-8 py-6 scrollbar-hide transition-all duration-1000 ${isDeepMode ? "space-y-10" : "space-y-8"}`}>
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center opacity-60">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5 border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
                  <span className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">✨</span>
                </div>
                <h3 className="text-[15px] font-semibold text-slate-300">Start a new session</h3>
                <p className="mt-1 text-[13.5px] text-slate-500">CareCompanion is ready to listen.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex w-full animate-fade-in-up ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="mr-4 mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-400/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                    <span className="text-[14px]">🤖</span>
                  </div>
                )}
                
                <div className="flex max-w-[80%] flex-col">
                  <div className={`mb-1.5 flex items-center px-1 text-[10px] font-bold uppercase tracking-widest ${message.role === "user" ? "justify-end text-blue-400/70" : "justify-start text-slate-500"}`}>
                    {message.role === "user" ? "You" : "CareCompanion"}
                  </div>
                  <div
                    className={`rounded-[24px] px-6 py-4 text-[15px] leading-relaxed shadow-xl backdrop-blur-md transition-all duration-1000 ${
                      message.role === "user"
                        ? "rounded-tr-sm bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_10px_30px_-10px_rgba(59,130,246,0.4)]"
                        : `rounded-tl-sm border border-white/[0.08] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.4)] ${isDeepMode ? "bg-white/[0.02] text-slate-300/90" : "bg-white/[0.04] text-slate-200"}`
                    }`}
                  >
                    {message.text}
                  </div>
                </div>

                {message.role === "user" && (
                  <div className="ml-4 mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 border border-white/5 shadow-inner">
                    <span className="text-[14px]">👤</span>
                  </div>
                )}
              </div>
            ))}
            
            {isSendingChat && (
              <div className="flex w-full animate-fade-in-up justify-start">
                <div className="mr-4 mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-400/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                  <span className="text-[14px]">🤖</span>
                </div>
                <div className="flex flex-col">
                  <div className="mb-1.5 flex items-center px-1 text-[10px] font-bold uppercase tracking-widest justify-start text-slate-500">CareCompanion</div>
                  <div className="inline-flex w-fit items-center rounded-[24px] rounded-tl-sm bg-white/[0.04] border border-white/[0.08] px-6 py-5 text-sm text-slate-400 shadow-xl">
                    <span className="flex gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-400/70 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="h-2 w-2 rounded-full bg-blue-400/70 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="h-2 w-2 rounded-full bg-blue-400/70 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>



          <div className="mx-8 mb-8 relative group">
            {/* Animated Glow Backdrop */}
            <div className="absolute -inset-[1px] rounded-[36px] bg-gradient-to-r from-blue-600/30 via-purple-600/30 to-blue-600/30 opacity-40 blur-md transition-all duration-500 group-focus-within:opacity-100 group-focus-within:duration-200"></div>
            
            <form
              onSubmit={handleChatSubmit}
              className="relative flex flex-col gap-2 rounded-[36px] border border-white/10 bg-black/60 p-2 shadow-2xl backdrop-blur-2xl transition-all duration-300 focus-within:border-white/20 focus-within:bg-black/80"
            >
              <textarea
                ref={textareaRef}
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                placeholder="Ask CareCompanion anything..."
                className="min-h-[56px] max-h-[240px] w-full resize-none bg-transparent px-6 py-4 text-[16px] leading-relaxed text-white outline-none placeholder:text-slate-500/70 transition-colors focus:placeholder:text-slate-600 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
                disabled={isSendingChat}
              />
              
              <div className="flex items-center justify-between px-2 pb-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    className={`flex h-11 w-11 items-center justify-center rounded-[20px] transition-all duration-300 ${
                      isListening
                        ? "bg-red-500/20 text-red-400 shadow-[0_0_25px_rgba(239,68,68,0.5)] border border-red-500/50 scale-105"
                        : "bg-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                    aria-label="Voice input"
                  >
                    <svg className={`h-[22px] w-[22px] transition-transform ${isListening ? 'animate-pulse scale-110' : 'hover:scale-110'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </button>
                  
                  <button type="button" className="flex h-11 w-11 items-center justify-center rounded-[20px] bg-transparent text-slate-400 transition-all hover:bg-white/5 hover:text-white">
                    <svg className="h-[22px] w-[22px] transition-transform hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                       <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSendingChat || !chatInput.trim()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[20px] bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all duration-300 hover:bg-blue-50 hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40 disabled:bg-white/20 disabled:text-white/50 disabled:shadow-none"
                >
                  <svg className="h-[20px] w-[20px] translate-x-px translate-y-[-1px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : view === "login" ? (
        <section className="pointer-events-auto relative z-10 ml-auto mr-4 flex h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[40px] border border-white/5 bg-slate-950/50 shadow-[0_0_120px_-20px_rgba(59,130,246,0.3)] backdrop-blur-3xl ring-1 ring-white/10 transition-all duration-700 ease-in-out md:mr-8 lg:mr-16 animate-[fade-in-up_0.6s_ease-out]">
          <div className="flex h-full flex-col justify-center px-10 py-12 sm:px-16 md:px-20">
            <div className="mx-auto flex h-full w-full max-w-[400px] flex-col justify-between py-6">
              
              <div className="flex flex-col items-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-tr from-blue-600/20 via-indigo-500/20 to-purple-500/20 border border-white/10 shadow-[0_0_40px_rgba(59,130,246,0.3)] backdrop-blur-xl relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-50"></div>
                  <svg className="h-10 w-10 text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.8)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </div>
                <h1 className="mb-2 text-center bg-gradient-to-br from-white via-white to-slate-400 bg-clip-text text-[2rem] font-bold tracking-tight text-transparent">Access Portal</h1>
                <p className="text-center text-[14.5px] font-medium text-slate-400/80">Authenticate to sync your neural dashboard.</p>
              </div>

              <div className="flex w-full flex-col justify-center">
                {authError && (
                  <div className="mb-5 w-full animate-fade-in-up rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center text-sm font-medium text-red-400 backdrop-blur-md shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                    {authError}
                  </div>
                )}
                <form onSubmit={handleLoginSubmit} className="flex w-full flex-col gap-5">
                  <div className="group relative">
                    <label className="mb-2 ml-1 block text-[11.5px] font-bold uppercase tracking-widest text-slate-400/80 transition-colors group-focus-within:text-blue-400" htmlFor="email">Email address</label>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-slate-500 transition-colors group-focus-within:text-blue-400">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                        </svg>
                      </div>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="hello@example.com"
                        className="w-full rounded-2xl border border-white/10 bg-black/30 py-4.5 pl-12 pr-5 text-[15px] text-white outline-none transition-all duration-300 placeholder:text-slate-600 focus:border-blue-500/50 focus:bg-black/50 focus:ring-4 focus:ring-blue-500/15 shadow-inner"
                        required
                      />
                    </div>
                  </div>
                  <div className="group relative">
                    <div className="mb-2 ml-1 flex items-center justify-between">
                      <label className="block text-[11.5px] font-bold uppercase tracking-widest text-slate-400/80 transition-colors group-focus-within:text-blue-400" htmlFor="password">Password</label>
                      <a href="#" className="text-[12.5px] font-semibold text-blue-400/80 transition-colors hover:text-blue-300">Forgot?</a>
                    </div>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-slate-500 transition-colors group-focus-within:text-blue-400">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </div>
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-2xl border border-white/10 bg-black/30 py-4.5 pl-12 pr-5 text-[15px] text-white outline-none transition-all duration-300 placeholder:text-slate-600 focus:border-blue-500/50 focus:bg-black/50 focus:ring-4 focus:ring-blue-500/15 shadow-inner"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingAuth}
                    className="mt-6 w-full rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 py-4.5 text-[15.5px] font-bold tracking-wide text-white shadow-[0_0_25px_rgba(59,130,246,0.4)] transition-all duration-300 hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 hover:shadow-[0_0_40px_rgba(59,130,246,0.6)] hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isSubmittingAuth ? "Authenticating..." : "Initialize Session"}
                  </button>
                </form>
              </div>

              <div className="flex w-full flex-col items-center">
                <div className="mb-6 flex w-full items-center gap-4 opacity-50">
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/30 to-white/30"></div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">OR</span>
                  <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-white/30 to-white/30"></div>
                </div>

                <button
                  onClick={handleGoogleLogin}
                  disabled={isSubmittingAuth}
                  type="button"
                  className="group flex w-full items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] py-4.5 text-[15.5px] font-semibold text-slate-200 transition-all duration-300 hover:bg-white/[0.08] hover:border-white/20 hover:shadow-[0_0_25px_rgba(255,255,255,0.08)] hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 transition-transform duration-300 group-hover:scale-110" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
                
                <p className="mt-6 text-center text-[13.5px] font-medium text-slate-500">
                  Don't have an account? <a href="#" className="font-semibold text-blue-400 transition-colors hover:text-blue-300">Sign up</a>
                </p>
              </div>

            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
