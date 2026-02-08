"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { Sparkles, ArrowRight, Globe } from 'lucide-react';
import ParticleSparkles from '@/components/ParticleSparkles';

import { TTS_MODELS, TTSModelId, DEFAULT_MODEL_ID } from '@/app/config/models';

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState('');
  const [selectedModel, setSelectedModel] = useState<TTSModelId>(DEFAULT_MODEL_ID);

  // Mouse tracking for cursor glow
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Use springs for smooth following effect
  const springConfig = { damping: 25, stiffness: 150 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  const createRoom = () => {
    const newId = Math.random().toString(36).substring(7);
    router.push(`/room/${newId}?model=${selectedModel}`);
  };

  const joinRoom = () => {
    if (roomId) router.push(`/room/${roomId}?model=${selectedModel}`);
  };

  // Define variants for smooth entrance
  const fadeInUp = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: "easeOut" as any }
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center animated-gradient-bg text-white p-4 overflow-hidden relative selection:bg-indigo-500/30">
      {/* Minimalist Background handled by main class animated-gradient-bg */}


      <div className="max-w-4xl w-full text-center relative z-10 space-y-12 py-20">
        {/* Hero Section */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } } } as any}
          className="space-y-8"
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, scale: 0.8 },
              visible: {
                opacity: 1,
                scale: 1,
                transition: { duration: 1.2, ease: "circOut" as any }
              }
            }}
            className="flex justify-center mb-10 relative"
          >
            <div className="relative w-80 h-80 flex items-center justify-center group">
              {/* Particle sparkles concentrated near logo */}
              <ParticleSparkles />

              <motion.div
                animate={{
                  y: [0, -15, 0],
                }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="relative z-10"
              >
                {/* Restored Original Logo Asset */}
                <img
                  src="/icon.png"
                  alt="Orlena AI"
                  className="w-64 h-64 object-contain drop-shadow-[0_0_60px_rgba(99,102,241,0.7)] group-hover:scale-105 transition-transform duration-1000"
                  onError={(e) => {
                    // Fallback if image not yet placed
                    (e.target as HTMLImageElement).style.display = 'none';
                    ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.display = 'flex';
                  }}
                />
                <div className="hidden absolute inset-0 items-center justify-center">
                  <Sparkles className="w-20 h-20 text-indigo-400" />
                </div>
              </motion.div>

              {/* Local Orbital Rings */}
              <div className="absolute inset-0 rounded-full border border-white/10 group-hover:border-indigo-500/40 transition-colors duration-1000 group-hover:scale-125" />
              <div className="absolute inset-4 rounded-full border border-white/5 animate-spin-slow pointer-events-none" />
            </div>
          </motion.div>

          <motion.h1
            variants={fadeInUp as any}
            className="text-6xl md:text-[8.5rem] font-[950] font-syne uppercase tracking-[-0.02em] md:tracking-[-0.05em] bg-clip-text text-transparent bg-gradient-to-b from-white via-white/95 to-white/30 leading-none drop-shadow-2xl px-4 whitespace-nowrap overflow-visible inline-block w-full"
          >
            Orlena AI
          </motion.h1>

          <motion.p
            variants={fadeInUp as any}
            className="text-2xl md:text-4xl text-indigo-100/90 font-light italic leading-relaxed tracking-tight mt-4"
          >
            &quot;Language barrier&quot; in the big 2026 is crazy.
          </motion.p>

          <motion.div variants={fadeInUp as any} className="space-y-6">
            <p className="text-zinc-400 max-w-2xl mx-auto leading-relaxed text-lg">
              Welcome to your universal translation layer for real conversations. Orlena understands and converses in all Indian languages, and speaks FOR you to the other person. Dissolve boundaries and communicate without limits anytime and anywhere.
            </p>
          </motion.div>
        </motion.div>

        {/* Action Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="flex flex-col gap-6 max-w-sm mx-auto w-full pt-8"
        >
          <button
            onClick={createRoom}
            className="button-lift group relative w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-500/50 text-white font-medium py-4 px-6 rounded-2xl transition-all duration-200 backdrop-blur-md overflow-hidden shadow-lg hover:shadow-indigo-500/20"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              Start New Experience <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
            </span>
          </button>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/5" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-semibold">
              <span className="bg-[#050510] px-4 text-zinc-500">
                Model selection (Powered by <span className="text-indigo-400 font-bold text-xs">SARVAM AI ✨</span>)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pb-2">
            {(Object.values(TTS_MODELS)).map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id as TTSModelId)}
                className={`flex flex-col items-start p-3 rounded-xl border transition-all text-left ${selectedModel === m.id
                  ? 'bg-indigo-600/10 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${selectedModel === m.id ? 'bg-indigo-400' : 'bg-zinc-600'}`} />
                  <span className="font-bold text-sm tracking-tight">{m.name}</span>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{m.subtitle}</span>
              </button>
            ))}
          </div>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/5" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-semibold">
              <span className="bg-[#050510] px-4 text-zinc-500">Or join existing</span>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Room Code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="focus-glow flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent outline-none transition-all text-center tracking-widest font-mono uppercase"
            />
            <button
              onClick={joinRoom}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-500/20"
            >
              Join
            </button>
          </div>
        </motion.div>

        {/* Product Details Section */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="pt-32 space-y-16 border-t border-white/5 text-center"
        >
          <div className="flex items-center justify-center gap-8 text-[10px] uppercase tracking-[0.3em] font-bold text-zinc-600">
            <span className="flex items-center gap-2"><Globe className="w-3 h-3 translate-y-[-1px]" /> Universal Translation</span>
            <span className="opacity-30">|</span>
            <span>Real-time Voice</span>
            <span className="opacity-30">|</span>
            <span>Zero Latency</span>
          </div>

          <div className="space-y-6">
            <h2 className="text-4xl md:text-5xl font-bold font-syne tracking-tight text-white/90 uppercase">
              Breaking the final barrier of communication
            </h2>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed font-light">
              Orlena AI is your universal translation layer for natural, real-time voice conversations.
              Built for the diverse linguistic landscape of India, it seamlessly bridges the gap across all major Indic languages,
              acting as a silent, intelligent mediator that lets you focus on the human connection, not the language.
            </p>
          </div>

          <div className="relative aspect-video w-full max-w-4xl mx-auto rounded-3xl overflow-hidden shadow-2xl shadow-indigo-500/10 border border-white/10 group">
            <div className="absolute inset-0 bg-gradient-to-t from-[#050510] via-transparent to-transparent z-10 pointer-events-none opacity-40 group-hover:opacity-20 transition-opacity duration-500" />
            <iframe
              className="absolute inset-0 w-full h-full"
              src="https://www.youtube.com/embed/s7d4QB-e7-c"
              title="Orlena AI Demo"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 }}
          className="pt-24 pb-12 flex flex-col items-center gap-6"
        >


          <div className="pt-8 border-t border-white/5 w-full max-w-2xl text-center space-y-3">
            <p className="text-zinc-500 text-xs tracking-widest uppercase font-medium">Made by Adhvaith</p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] text-zinc-600 tracking-wider">
              <a href="mailto:adhvaithks@gmail.com" className="hover:text-indigo-400 transition-colors uppercase">Contact: adhvaithks@gmail.com</a>
              <a href="https://www.linkedin.com/in/adhvaith-ks-066758181/" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-400 transition-colors uppercase">LinkedIn: Adhvaith KS</a>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
