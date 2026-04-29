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
  suggestions?: string[];
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

const SUGGESTED_INTERESTS = ["Reading", "Walking", "Music", "Gardening", "Cooking", "Yoga", "Movies", "Meditation", "Art"];

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
  const [isCheckingRole, setIsCheckingRole] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[] | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [language, setLanguage] = useState(SUPPORTED_LANGUAGES[0].code);

  // Premium State
  const [isPremiumOpen, setIsPremiumOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("Standard");

  // Voice State
  const [voiceMode, setVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const voiceModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const handleChatSubmitRef = useRef<any>(null);

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
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser?.email) {
        setIsCheckingRole(true);
        try {
          const res = await fetch(`/api/user?email=${encodeURIComponent(currentUser.email)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.role) setRole(data.role);
            else setRole(null);
            if (data.interests && data.interests.length > 0) setInterests(data.interests);
            else setInterests(null);
          }
        } catch (e) {
          console.error("Failed to check role", e);
        }
        setIsCheckingRole(false);
      } else {
        setRole(null);
        setInterests(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const saveRole = async (selectedRole: string) => {
    if (!user?.email) return;
    setIsCheckingRole(true);
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, role: selectedRole, name: user.displayName || undefined })
      });
      if (res.ok) {
        setRole(selectedRole);
      }
    } catch (e) {
      console.error("Failed to save role", e);
    }
    setIsCheckingRole(false);
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests(curr => 
      curr.includes(interest) ? curr.filter(i => i !== interest) : [...curr, interest]
    );
  };

  const addCustomInterest = () => {
    if (customInterest.trim() && !selectedInterests.includes(customInterest.trim())) {
      setSelectedInterests(curr => [...curr, customInterest.trim()]);
      setCustomInterest("");
    }
  };

  const saveInterests = async () => {
    if (!user?.email || selectedInterests.length === 0) return;
    setIsCheckingRole(true);
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, interests: selectedInterests })
      });
      if (res.ok) {
        setInterests(selectedInterests);
      }
    } catch (e) {
      console.error("Failed to save interests", e);
    }
    setIsCheckingRole(false);
  };

  useEffect(() => {
    handleChatSubmitRef.current = handleChatSubmit;
  }, [handleChatSubmit]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript.trim() && handleChatSubmitRef.current) {
            handleChatSubmitRef.current(undefined, transcript.trim());
          }
        };

        recognition.onerror = (event: any) => {
          if (event.error !== "no-speech" && event.error !== "aborted" && event.error !== "network") {
            console.error("Speech recognition error", event.error);
          }
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
          if (voiceModeRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
            setTimeout(() => {
              if (voiceModeRef.current && !isSpeakingRef.current && !isProcessingRef.current && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch(e) {}
              }
            }, 300);
          }
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  // Update recognition lang when language changes
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = language;
    }
  }, [language]);

  const startListening = () => {
    if (!recognitionRef.current) return;
    if (isSpeakingRef.current || isProcessingRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (e) {}
  };

  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    utterance.onstart = () => {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      if (recognitionRef.current) {
         try { recognitionRef.current.abort(); } catch(e) {}
      }
    };

    utterance.onend = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (voiceModeRef.current) {
        setTimeout(startListening, 300);
      }
    };
    
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (voiceModeRef.current) {
        setTimeout(startListening, 300);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const toggleVoiceMode = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    const newMode = !voiceMode;
    setVoiceMode(newMode);
    voiceModeRef.current = newMode;

    if (newMode) {
       startListening();
    } else {
       if (recognitionRef.current) {
         try { recognitionRef.current.abort(); } catch(e) {}
       }
       if (window.speechSynthesis) window.speechSynthesis.cancel();
       setIsSpeaking(false);
       isSpeakingRef.current = false;
       setIsListening(false);
    }
  };

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

  // Replaced by initialized recognition logic

  async function handleChatSubmit(event?: FormEvent<HTMLFormElement>, overrideText?: string) {
    if (event) event.preventDefault();
    const text = overrideText || chatInput.trim();
    if (!text || isSendingChat) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch(e) {}
    }
    isProcessingRef.current = true;

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
          history: messages.slice(-8).map(m => ({ role: m.role, text: m.text })),
          email: user?.email
        }),
      });
      const data = (await response.json()) as { reply?: string; stress?: StressLevel; suggestions?: string[] };

      if (!response.ok || typeof data.reply !== "string") {
        throw new Error("Unable to get response.");
      }
      const replyText = data.reply;

      setMessages((current) => [
        ...current,
        { role: "assistant", text: replyText, stress: data.stress, suggestions: data.suggestions },
      ]);
      
      if (voiceModeRef.current) {
        speakText(replyText);
      }
    } catch {
      const fallbackReply = "That sounds like a full day. Hope you get a quiet minute soon.";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: fallbackReply,
        },
      ]);
      if (voiceModeRef.current) {
        speakText(fallbackReply);
      }
    } finally {
      setIsSendingChat(false);
      isProcessingRef.current = false;
      if (voiceModeRef.current && !isSpeakingRef.current) {
        setTimeout(startListening, 300);
      }
    }
  }

  if (authLoading || isCheckingRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FFFFFF]">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#FF8C42]/20 border-t-[#FF8C42]"></div>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#FFFFFF] px-4 py-5 font-sans text-[#1A1A1A]">
      {/* Hide Spline Watermark */}
      <style dangerouslySetInnerHTML={{ __html: `
        #logo, a[href*="spline.design"] {
          display: none !important;
        }
      `}} />

      {/* Soft Background */}
      <div className="absolute inset-0 z-0 bg-[#FFF7F2]"></div>
      
      {/* 3D Asset Container */}
      <div className="absolute inset-0 z-0 flex pointer-events-none">
        <div className={`relative h-full flex items-center justify-center pointer-events-auto transition-all duration-1000 ease-out ${
          (!user && view === "landing") ? "w-full opacity-100" : "w-full lg:w-[calc(100%-700px)] opacity-40"
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

      {user && !role ? (
        <section className={`pointer-events-auto relative z-10 ml-auto mr-4 md:mr-8 lg:mr-16 flex h-[92vh] w-full max-w-[640px] flex-col items-center justify-center overflow-hidden rounded-[28px] border-2 border-[#FF8C42]/30 bg-white/95 backdrop-blur-3xl shadow-[0_20px_70px_-10px_rgba(255,140,66,0.25)] ring-[10px] ring-[#FF8C42]/5 transition-all duration-700 ease-in-out`}>
           <div className="text-center px-8 w-full max-w-md relative z-10">
             <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF7F2] border border-[#FF8C42]/10 shadow-sm">
               <span className="text-3xl">🤝</span>
             </div>
             <h2 className="text-[2rem] font-bold text-[#1A1A1A] mb-2 tracking-tight">Who are you caring as?</h2>
             <p className="text-[14.5px] text-slate-500 mb-8 font-medium">Select your role to personalize your experience.</p>
             
             <div className="flex flex-col gap-4">
               <button onClick={() => saveRole("informal")} className="flex flex-col items-center text-center p-6 rounded-2xl border border-slate-200 hover:border-[#FF8C42] hover:bg-[#FFF7F2] transition-all bg-white shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]">
                 <span className="text-[16.5px] font-semibold text-[#1A1A1A] mb-1.5">Informal Caregiver</span>
                 <span className="text-[13px] text-slate-500 leading-relaxed">Family, friend, or someone supporting a loved one</span>
               </button>
               
               <button onClick={() => saveRole("formal")} className="flex flex-col items-center text-center p-6 rounded-2xl border border-slate-200 hover:border-[#FF8C42] hover:bg-[#FFF7F2] transition-all bg-white shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]">
                 <span className="text-[16.5px] font-semibold text-[#1A1A1A] mb-1.5">Formal Caregiver</span>
                 <span className="text-[13px] text-slate-500 leading-relaxed">Professional caregiver, nurse, or support staff</span>
               </button>
             </div>
           </div>
        </section>
      ) : user && role && !interests ? (
        <section className={`pointer-events-auto relative z-10 ml-auto mr-4 md:mr-8 lg:mr-16 flex h-[92vh] w-full max-w-[640px] flex-col items-center justify-center overflow-hidden rounded-[28px] border-2 border-[#FF8C42]/30 bg-white/95 backdrop-blur-3xl shadow-[0_20px_70px_-10px_rgba(255,140,66,0.25)] ring-[10px] ring-[#FF8C42]/5 transition-all duration-700 ease-in-out`}>
           <div className="text-center px-8 w-full max-w-md relative z-10">
             <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF7F2] border border-[#FF8C42]/10 shadow-sm">
               <span className="text-3xl">🌿</span>
             </div>
             <h2 className="text-[2rem] font-bold text-[#1A1A1A] mb-2 tracking-tight">What do you enjoy?</h2>
             <p className="text-[14.5px] text-slate-500 mb-8 font-medium">Select or add your hobbies to personalize our chats.</p>
             
             <div className="flex flex-wrap justify-center gap-2 mb-6">
               {SUGGESTED_INTERESTS.map(interest => (
                 <button
                   key={interest}
                   onClick={() => toggleInterest(interest)}
                   className={`px-4 py-2 rounded-full border transition-all ${selectedInterests.includes(interest) ? 'bg-[#FF8C42] text-white border-[#FF8C42] shadow-md shadow-[#FF8C42]/20 scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-[#FF8C42]/50 hover:bg-[#FFF7F2]'}`}
                 >
                   {interest}
                 </button>
               ))}
             </div>

             <div className="flex gap-2 mb-8">
               <input 
                 type="text" 
                 value={customInterest}
                 onChange={e => setCustomInterest(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && addCustomInterest()}
                 placeholder="Add custom hobby..."
                 className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14.5px] outline-none focus:border-[#FF8C42] focus:ring-4 focus:ring-[#FF8C42]/10"
               />
               <button 
                 onClick={addCustomInterest}
                 className="px-5 rounded-xl bg-slate-100 text-slate-600 font-medium hover:bg-slate-200 transition-colors"
               >
                 Add
               </button>
             </div>

             <button 
               onClick={saveInterests}
               disabled={selectedInterests.length === 0}
               className="w-full py-4 rounded-xl bg-[#FF8C42] text-white font-semibold shadow-lg shadow-[#FF8C42]/20 hover:bg-[#ff7a29] transition-all disabled:opacity-50 disabled:pointer-events-none"
             >
               Continue
             </button>
           </div>
        </section>
      ) : user && role && interests ? (
        <section className={`pointer-events-auto relative z-10 ml-auto mr-4 md:mr-8 lg:mr-16 flex h-[92vh] w-full max-w-[700px] flex-col overflow-hidden rounded-[28px] border-2 border-[#FF8C42]/30 bg-white/95 backdrop-blur-3xl shadow-[0_20px_70px_-10px_rgba(255,140,66,0.25)] ring-[10px] ring-[#FF8C42]/5 transition-all duration-1000 ease-in-out`}>
          
          {/* Aesthetic Decor */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#FF8C42] via-[#FF4D4D] to-[#FF8C42] opacity-90 z-50"></div>
          <div className="absolute top-0 left-1/4 h-32 w-64 rounded-full bg-[#FF8C42]/15 blur-[60px] pointer-events-none z-0"></div>
          <div className="absolute bottom-0 right-1/4 h-40 w-80 rounded-full bg-[#FF4D4D]/10 blur-[70px] pointer-events-none z-0"></div>

          {/* Sidebar Overlay */}
          <div className={`absolute inset-0 z-50 flex transition-all duration-500 ${isSidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
            {/* Backdrop */}
            <div onClick={() => setIsSidebarOpen(false)} className={`absolute inset-0 bg-black/10 backdrop-blur-sm transition-opacity duration-500 ${isSidebarOpen ? "opacity-100" : "opacity-0"}`}></div>
            {/* Panel */}
            <div className={`absolute bottom-0 left-0 top-0 flex w-[280px] flex-col border-r border-slate-100 bg-[#FFF7F2] shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-[#1A1A1A]">History</h2>
                <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-[#1A1A1A]">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
                <button 
                  onClick={startNewChat}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:bg-slate-50 shadow-sm"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF8C42]/10 text-[#FF8C42]">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                  <span className="text-[14px] font-medium text-[#1A1A1A]">New Conversation</span>
                </button>
                <div className="pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">Previous</div>
                {conversations.map(conv => (
                  <button 
                    key={conv.id}
                    onClick={() => loadChat(conv.id)}
                    className={`w-full truncate rounded-xl p-3 text-left text-[14px] transition-all ${activeChatId === conv.id ? "bg-[#FF8C42]/10 text-[#FF8C42] font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-[#1A1A1A]"}`}
                  >
                    {conv.title}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-100 p-4">
                <button onClick={handleLogout} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-50 py-3 text-[13px] font-bold uppercase tracking-wider text-slate-500 transition-all hover:bg-red-50 hover:text-[#FF4D4D]">
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          {demoMode && (
            <div className="h-[2px] w-full bg-slate-100 relative z-50">
              <div 
                className={`absolute left-0 top-0 h-full transition-all duration-1000 ease-in-out ${
                  currentStress === "LOW" ? "w-1/3 bg-gradient-to-r from-emerald-400 to-emerald-300" :
                  currentStress === "MEDIUM" ? "w-2/3 bg-gradient-to-r from-emerald-400 via-yellow-400 to-[#FF8C42]" :
                  "w-full bg-gradient-to-r from-yellow-400 via-[#FF8C42] to-[#FF4D4D]"
                }`}
              />
            </div>
          )}

          <header className={`flex items-center justify-between border-b bg-white px-8 py-5 transition-colors duration-1000 border-slate-100 relative`}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <button onClick={() => setIsSidebarOpen(true)} className="group flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 transition-all hover:bg-slate-100 active:scale-95 text-slate-500 hover:text-[#1A1A1A]">
                  <svg className="h-4 w-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <h1 className="text-[1.15rem] font-semibold tracking-wide text-[#1A1A1A]">Care Companion</h1>
              </div>
              <p className="text-[13px] text-slate-500 ml-12">A quiet space to share your day</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Premium Button */}
              <button 
                onClick={() => setIsPremiumOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#FF8C42] to-[#FF4D4D] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
              >
                <span>⭐</span> Premium
              </button>

              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="cursor-pointer appearance-none bg-slate-50 hover:bg-slate-100 transition-all border border-slate-200 rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-600 outline-none"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code} className="bg-white text-[#1A1A1A]">
                    {lang.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-3">
                {currentStress === "HIGH" && (
                  <div className="h-2 w-2 rounded-full bg-[#FF4D4D] shadow-[0_0_8px_rgba(255,77,77,0.4)] animate-pulse" />
                )}
              </div>
            </div>
            <div className="absolute bottom-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#FF8C42]/30 to-transparent"></div>
          </header>

          <div className="mt-6 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {activeChatId === "new" ? "New Session" : "Archived Session"}
          </div>

          <div className={`flex-1 overflow-y-auto px-8 py-6 scrollbar-hide transition-all duration-1000 space-y-6`}>
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center opacity-80">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF7F2] border border-[#FF8C42]/10 shadow-sm">
                  <span className="text-2xl">🌱</span>
                </div>
                <h3 className="text-[15px] font-medium text-[#1A1A1A]">Start a new session</h3>
                <p className="mt-1 text-[13.5px] text-slate-500">Care Companion is ready to listen.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex w-full animate-fade-in-up ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="mr-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-slate-100 shadow-sm">
                    <span className="text-[14px]">🤍</span>
                  </div>
                )}
                
                <div className="flex max-w-[80%] flex-col">
                  <div className={`mb-1 flex items-center px-2 text-[10.5px] font-medium uppercase tracking-wider ${message.role === "user" ? "justify-end text-slate-400" : "justify-start text-slate-400"}`}>
                    {message.role === "user" ? "You" : "Care Companion"}
                  </div>
                  <div
                    className={`rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed transition-all duration-700 shadow-sm ${
                      message.role === "user"
                        ? "rounded-tr-sm bg-[#FFE5D0] text-[#1A1A1A]"
                        : "rounded-tl-sm bg-[#F5F5F5] text-[#1A1A1A] border border-[#FF8C42]/10"
                    }`}
                  >
                    {message.text}
                  </div>
                  {message.suggestions && message.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                      {message.suggestions.map((sug, i) => (
                        <button 
                          key={i} 
                          onClick={() => handleChatSubmit(undefined, sug)}
                          disabled={isSendingChat}
                          className="px-3 py-1.5 rounded-full border border-[#FF8C42]/20 bg-[#FFF7F2] text-[12px] font-medium text-[#FF8C42] shadow-sm hover:bg-[#FF8C42] hover:text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {isSendingChat && (
              <div className="flex w-full animate-fade-in-up justify-start">
                <div className="mr-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-slate-100 shadow-sm">
                  <span className="text-[14px]">🤍</span>
                </div>
                <div className="flex flex-col">
                  <div className="mb-1 flex items-center px-2 text-[10.5px] font-medium uppercase tracking-wider justify-start text-slate-400">Care Companion</div>
                  <div className="inline-flex w-fit items-center rounded-2xl rounded-tl-sm bg-[#F5F5F5] border border-[#FF8C42]/10 px-5 py-4 shadow-sm">
                    <span className="flex gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF8C42]/60 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF8C42]/60 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF8C42]/60 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>



          <div className="mx-8 mb-8 relative group">
            <form
              onSubmit={handleChatSubmit}
              className="relative flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-slate-100 transition-all duration-300 focus-within:border-[#FF8C42]/40 focus-within:ring-4 focus-within:ring-[#FF8C42]/10"
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
                placeholder="How was your day?"
                className="min-h-[56px] max-h-[240px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-[#1A1A1A] outline-none placeholder:text-slate-400 transition-colors scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200"
                disabled={isSendingChat}
              />
              
              <div className="flex items-center justify-between px-2 pb-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleVoiceMode}
                    className={`flex h-10 w-auto px-4 items-center justify-center rounded-xl transition-all font-medium text-[13px] ${
                      voiceMode
                        ? "bg-[#FF8C42]/10 text-[#FF8C42] border border-[#FF8C42]/30 shadow-sm"
                        : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200"
                    }`}
                  >
                    {voiceMode ? (
                      <span className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF8C42] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF8C42]"></span>
                        </span>
                        Voice Mode ON
                      </span>
                    ) : (
                      "Voice Mode OFF"
                    )}
                  </button>
                  
                  <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl bg-transparent text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-600">
                    <svg className="h-5 w-5 transition-transform hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                       <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSendingChat || !chatInput.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF8C42] text-white shadow-md shadow-[#FF8C42]/20 transition-all duration-300 hover:bg-[#ff7a29] hover:shadow-lg hover:shadow-[#FF8C42]/30 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  <svg className="h-5 w-5 translate-x-px translate-y-[-1px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : view === "login" ? (
        <section className="pointer-events-auto relative z-10 ml-auto mr-4 md:mr-8 lg:mr-16 flex h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[28px] border-2 border-[#FF8C42]/30 bg-white/95 backdrop-blur-3xl shadow-[0_20px_70px_-10px_rgba(255,140,66,0.25)] ring-[10px] ring-[#FF8C42]/5 transition-all duration-700 ease-in-out animate-[fade-in-up_0.6s_ease-out]">
          
          {/* Aesthetic Decor */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#FF8C42] via-[#FF4D4D] to-[#FF8C42] opacity-90 z-50"></div>
          <div className="absolute -top-20 -right-10 h-64 w-64 rounded-full bg-[#FF8C42]/15 blur-[70px] pointer-events-none z-0"></div>
          <div className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-[#FF4D4D]/10 blur-[70px] pointer-events-none z-0"></div>

          <div className="relative z-10 flex h-full flex-col justify-center px-10 py-12 sm:px-16 md:px-20">
            <div className="mx-auto flex h-full w-full max-w-[400px] flex-col justify-between py-6">
              
              <div className="flex flex-col items-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF7F2] border border-[#FF8C42]/10 shadow-sm relative overflow-hidden">
                  <span className="text-3xl">🤍</span>
                </div>
                <h1 className="mb-2 text-center text-[2rem] font-bold tracking-tight text-[#1A1A1A]">Welcome Back</h1>
                <p className="text-center text-[14.5px] font-medium text-slate-500">Sign in to your quiet space.</p>
              </div>

              <div className="flex w-full flex-col justify-center">
                {authError && (
                  <div className="mb-5 w-full animate-fade-in-up rounded-xl border border-[#FF4D4D]/20 bg-[#FF4D4D]/5 p-4 text-center text-sm font-medium text-[#FF4D4D]">
                    {authError}
                  </div>
                )}
                <form onSubmit={handleLoginSubmit} className="flex w-full flex-col gap-5">
                  <div className="group relative">
                    <label className="mb-2 ml-1 block text-[11.5px] font-bold uppercase tracking-widest text-slate-500 transition-colors group-focus-within:text-[#FF8C42]" htmlFor="email">Email address</label>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-slate-400 transition-colors group-focus-within:text-[#FF8C42]">
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-5 text-[15px] text-[#1A1A1A] outline-none transition-all duration-300 placeholder:text-slate-400 focus:border-[#FF8C42] focus:bg-white focus:ring-4 focus:ring-[#FF8C42]/10"
                        required
                      />
                    </div>
                  </div>
                  <div className="group relative">
                    <div className="mb-2 ml-1 flex items-center justify-between">
                      <label className="block text-[11.5px] font-bold uppercase tracking-widest text-slate-500 transition-colors group-focus-within:text-[#FF8C42]" htmlFor="password">Password</label>
                      <a href="#" className="text-[12px] font-medium text-[#FF8C42] transition-colors hover:text-[#ff7a29]">Forgot?</a>
                    </div>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-slate-400 transition-colors group-focus-within:text-[#FF8C42]">
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-5 text-[15px] text-[#1A1A1A] outline-none transition-all duration-300 placeholder:text-slate-400 focus:border-[#FF8C42] focus:bg-white focus:ring-4 focus:ring-[#FF8C42]/10"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingAuth}
                    className="mt-4 w-full rounded-xl bg-[#FF8C42] py-4 text-[15px] font-semibold tracking-wide text-white shadow-md shadow-[#FF8C42]/20 transition-all duration-300 hover:bg-[#ff7a29] hover:shadow-lg hover:shadow-[#FF8C42]/30 hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isSubmittingAuth ? "Authenticating..." : "Sign In"}
                  </button>
                </form>
              </div>

              <div className="flex w-full flex-col items-center mt-6">
                <div className="mb-6 flex w-full items-center gap-4 opacity-70">
                  <div className="h-[1px] flex-1 bg-slate-200"></div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">OR</span>
                  <div className="h-[1px] flex-1 bg-slate-200"></div>
                </div>

                <button
                  onClick={handleGoogleLogin}
                  disabled={isSubmittingAuth}
                  type="button"
                  className="group flex w-full items-center justify-center gap-4 rounded-xl border border-slate-200 bg-white py-4 text-[14.5px] font-medium text-slate-600 shadow-sm transition-all duration-300 hover:bg-slate-50 hover:border-slate-300 hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
                
                <p className="mt-8 text-center text-[13.5px] font-medium text-slate-500">
                  Don't have an account? <a href="#" className="font-semibold text-[#FF8C42] transition-colors hover:text-[#ff7a29]">Sign up</a>
                </p>
              </div>

            </div>
          </div>
        </section>
      ) : null}
      
      {/* Premium Modal Overlay */}
      <div className={`absolute inset-0 z-[100] flex items-center justify-center transition-all duration-500 ${isPremiumOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
        <div onClick={() => setIsPremiumOpen(false)} className={`absolute inset-0 bg-[#FF8C42]/20 backdrop-blur-md transition-opacity duration-500 ${isPremiumOpen ? "opacity-100" : "opacity-0"}`}></div>
        
        <div className={`relative z-10 w-[90%] max-w-4xl rounded-[24px] bg-white p-6 md:p-10 shadow-[0_20px_70px_-10px_rgba(255,140,66,0.3)] transition-all duration-500 ${isPremiumOpen ? "scale-100 translate-y-0" : "scale-95 translate-y-8"}`}>
           <h2 className="text-2xl font-bold text-[#1A1A1A] mb-1">Our Pricing Plans</h2>
           <p className="text-[14px] text-slate-500 mb-8">Pick a plan that is best for you</p>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Basic Plan */}
              <div 
                onClick={() => setSelectedPlan("Basic")}
                className={`relative flex flex-col rounded-[20px] p-6 border-2 transition-all cursor-pointer ${selectedPlan === "Basic" ? "border-[#FF8C42] bg-[#FFF7F2] shadow-md scale-105 z-10" : "border-slate-100 bg-white hover:border-[#FF8C42]/30"}`}
              >
                 <div className="flex justify-between items-start mb-4">
                   <div className="flex items-center gap-3">
                     <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${selectedPlan === "Basic" ? "border-[#FF8C42]" : "border-slate-300"}`}>
                       {selectedPlan === "Basic" && <div className="h-2.5 w-2.5 rounded-full bg-[#FF8C42]"></div>}
                     </div>
                     <span className="font-medium text-[#1A1A1A]">Basic</span>
                   </div>
                 </div>
                 <div className="mb-2">
                   <span className="text-3xl font-bold text-[#1A1A1A]">Free</span>
                 </div>
                 <p className="text-[13px] text-slate-500 mb-6 pb-6 border-b border-slate-200">Perfect plan for starters</p>
                 
                 <div className="flex flex-col gap-3 flex-1">
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px]">✓</div> 720p Video Resolution
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px]">✓</div> Free Video Tutorials
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px]">✓</div> Single Device Access
                   </div>
                 </div>
              </div>

              {/* Standard Plan */}
              <div 
                onClick={() => setSelectedPlan("Standard")}
                className={`relative flex flex-col rounded-[20px] p-6 border-2 transition-all cursor-pointer ${selectedPlan === "Standard" ? "border-[#FF8C42] bg-[#FFF7F2] shadow-lg shadow-[#FF8C42]/15 scale-[1.08] z-20" : "border-slate-100 bg-white hover:border-[#FF8C42]/30"}`}
              >
                 {selectedPlan === "Standard" && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#FF8C42] to-[#FF4D4D] px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">Popular</div>
                 )}
                 <div className="flex justify-between items-start mb-4 mt-2">
                   <div className="flex items-center gap-3">
                     <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${selectedPlan === "Standard" ? "border-[#FF8C42]" : "border-slate-300"}`}>
                       {selectedPlan === "Standard" && <div className="h-2.5 w-2.5 rounded-full bg-[#FF8C42]"></div>}
                     </div>
                     <span className={`font-medium ${selectedPlan === "Standard" ? "text-[#FF8C42]" : "text-[#1A1A1A]"}`}>Standard</span>
                   </div>
                 </div>
                 <div className="mb-2 flex items-baseline gap-1">
                   <span className="text-3xl font-bold text-[#FF8C42]">₹12,999</span>
                   <span className="text-[13px] font-medium text-slate-500">/ month</span>
                 </div>
                 <p className="text-[13px] text-[#FF8C42] mb-6 pb-6 border-b border-[#FF8C42]/20 font-medium">Find a balance</p>
                 
                 <div className="flex flex-col gap-3 flex-1">
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-700">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px] shadow-[0_0_8px_rgba(255,140,66,0.5)]">✓</div> Full HD Video Resolution
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-700">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px] shadow-[0_0_8px_rgba(255,140,66,0.5)]">✓</div> Ad-free Viewing
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-700">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF8C42] text-white text-[10px] shadow-[0_0_8px_rgba(255,140,66,0.5)]">✓</div> Up to 3 Device Access
                   </div>
                 </div>
              </div>

              {/* Premium Plan */}
              <div 
                onClick={() => setSelectedPlan("Premium")}
                className={`relative flex flex-col rounded-[20px] p-6 border-2 transition-all cursor-pointer ${selectedPlan === "Premium" ? "border-[#FF8C42] bg-[#FFF7F2] shadow-md scale-105 z-10" : "border-slate-100 bg-white hover:border-[#FF8C42]/30"}`}
              >
                 <div className="flex justify-between items-start mb-4">
                   <div className="flex items-center gap-3">
                     <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${selectedPlan === "Premium" ? "border-[#FF8C42]" : "border-slate-300"}`}>
                       {selectedPlan === "Premium" && <div className="h-2.5 w-2.5 rounded-full bg-[#FF8C42]"></div>}
                     </div>
                     <span className="font-medium text-[#1A1A1A]">Premium</span>
                   </div>
                 </div>
                 <div className="mb-2 flex items-baseline gap-1">
                   <span className="text-3xl font-bold text-[#1A1A1A]">₹24,999</span>
                   <span className="text-[13px] font-medium text-slate-500">/ month</span>
                 </div>
                 <p className="text-[13px] text-slate-500 mb-6 pb-6 border-b border-slate-200 font-medium">Zero restrictions</p>
                 
                 <div className="flex flex-col gap-3 flex-1">
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-white text-[10px]">✓</div> 4K Video Resolution
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-white text-[10px]">✓</div> Ad-free Viewing
                   </div>
                   <div className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
                     <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-white text-[10px]">✓</div> Unlimited Device Access
                   </div>
                 </div>
              </div>
           </div>

           <div className="mt-12 flex justify-end gap-4">
             <button 
               onClick={() => setIsPremiumOpen(false)}
               className="rounded-full border border-slate-200 bg-white px-10 py-3.5 text-[14.5px] font-semibold text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700"
             >
               Cancel
             </button>
             <button 
               onClick={() => setIsPremiumOpen(false)}
               className="rounded-full bg-[#FF8C42] px-12 py-3.5 text-[14.5px] font-bold text-white shadow-[0_4px_14px_0_rgba(255,140,66,0.39)] transition-all hover:bg-[#ff7a29] hover:shadow-[0_6px_20px_rgba(255,140,66,0.23)] hover:scale-105 active:scale-95"
             >
               Subscribe
             </button>
           </div>
        </div>
      </div>
    </main>
  );
}
