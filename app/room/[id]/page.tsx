"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useWebRTC } from '@/hooks/useWebRTC';
import { SUPPORTED_LANGUAGES, LanguageCode } from '@/app/config/languages';
import { Gender } from '@/app/config/voices';
import { TTS_MODELS, TTSModelId } from '@/app/config/models';

export default function RoomPage() {
    const { id } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const roomId = id as string;

    const initialModel = searchParams.get('model') || 'bulbul:v3-beta';

    // Simple random user ID for now
    const [userId] = useState(() => Math.random().toString(36).substring(7));

    const [hearLang, setHearLang] = useState<LanguageCode>('en-IN');

    const [isTalking, setIsTalking] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    // Update transcripts state to include translation properties if needed, or just append text
    // Let's enhance transcripts to show original + translated
    // Profile State
    const [profile, setProfile] = useState<{ name: string; avatar: string; gender: Gender; isSet: boolean }>({
        name: '',
        avatar: '👤',
        gender: 'neutral',
        isSet: false
    });

    // Translation status bubble
    const [isTranslating, setIsTranslating] = useState(false);
    const [translatingToLang, setTranslatingToLang] = useState<string>('');

    const AVATARS = ['👤', '👩', '👨', '🧑', '👧', '👦', '🤖', '👽', '🦊', '🐱'];

    interface TranscriptMsg {
        text: string;
        sender: 'me' | 'remote';
        isTranslated?: boolean;
        originalText?: string;
    }
    const [transcripts, setTranscripts] = useState<TranscriptMsg[]>([]);

    const {
        isConnected,
        isDataChannelOpen,
        isRemoteSpeaking,
        isPeerSpeaking,
        participants,
        lastTranscript,
        startCall,
        sendAudio,
        sendText,
        remoteProfile,
        sendProfile,
        sendSpeakingStatus,
        ttsModel,
        localStream,
        remoteFlowStatus, // New state from hook
        sendDataMessage   // New function from hook
    } = useWebRTC(roomId, userId, initialModel);

    const translateText = useCallback(async (text: string, source: string, target: string): Promise<string> => {
        try {
            console.log(`[TRANS] Translating "${text}" from ${source} to ${target}`);
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, sourceLang: source, targetLang: target })
            });
            const data = await res.json();
            if (data.translated_text) {
                return data.translated_text;
            } else {
                console.error('[TRANS] API error:', JSON.stringify(data));
                return `[Error] ${text}`;
            }
        } catch (e) {
            console.error('[TRANS] Network error:', e);
            return text;
        }
    }, []);



    // ... handlePointerDown/Up ...
    const toggleRecording = async () => {
        if (!mediaRecorderRef.current) {
            await initRecorder();
        }

        if (isTalking) {
            // STOP RECORDING
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                setIsTalking(false);
                sendSpeakingStatus(false); // Signal speaking stopped
                mediaRecorderRef.current.requestData();
                mediaRecorderRef.current.stop();
            }
        } else {
            // START RECORDING
            if (!mediaRecorderRef.current) await initRecorder();

            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                try {
                    mediaRecorderRef.current.start(100);
                    setIsTalking(true);
                    sendSpeakingStatus(true); // Signal speaking started
                    console.log('[PTT] recording started');
                } catch (e) {
                    console.error("Failed to start recorder", e);
                }
            }
        }
    };

    const initRecorder = async () => {
        try {
            // Use the shared stream from WebRTC to avoid conflict
            const recorderStream = localStream || await navigator.mediaDevices.getUserMedia({ audio: true });

            const types = [
                'audio/webm',
                'audio/opus',
                'audio/ogg',
                ''
            ];
            const supportedType = types.find(t => t === '' || MediaRecorder.isTypeSupported(t)) || '';
            console.log(`[REC] Select recorder mime type: ${supportedType || 'default'}`);

            const options = supportedType ? { mimeType: supportedType } : undefined;
            const mediaRecorder = new MediaRecorder(recorderStream, options);

            console.log(`[REC] recorder mime type: ${mediaRecorder.mimeType}`);

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                console.log('[PTT] recording stopped');

                // Content-Type must be a simple mime type for Sarvam (remove ;codecs=...)
                const cleanMime = (mediaRecorder.mimeType || 'audio/webm').split(';')[0];
                const blob = new Blob(audioChunksRef.current, { type: cleanMime });

                console.log(`[PTT] audio blob size: ${blob.size} bytes`);
                console.log(`[PTT] upload mime type: ${blob.type}`);

                if (blob.size < 1000) {
                    console.warn('[REC] Blob too small, ignoring.');
                    return;
                }

                // STT API Call
                console.log(`[PTT] sending audio to STT`);
                setOrlenaFlowState('receiving');
                setFlowDirection('me_to_peer');
                broadcastFlowStatus('receiving'); // Tell peer I am sending to Orlena
                const formData = new FormData();
                formData.append('audio', blob, `audio.${cleanMime.split('/')[1]}`);

                fetch('/api/stt', { method: 'POST', body: formData })
                    .then(async (res) => {
                        if (!res.ok) {
                            const errText = await res.text();
                            throw new Error(`STT API Error: ${res.status} ${res.statusText} - ${errText}`);
                        }
                        return res.json();
                    })
                    .then(data => {
                        console.log('[PTT] STT response received');
                        if (data.transcript) {
                            const text = data.transcript;
                            const detectedLang = data.language_code || 'hi-IN';

                            console.log(`[STT] Transcript: "${text}", Detected Lang: ${detectedLang}`);
                            sendText(text, detectedLang);
                            setTranscripts(prev => [...prev, { text, sender: 'me' }]);
                        } else {
                            console.warn('STT response missing transcript:', data);
                        }
                    })
                    .catch(err => {
                        console.error('STT Request Failed:', err);
                    });

                // Do not stop the stream tracks here, as they are shared with WebRTC
                mediaRecorderRef.current = null;
            };

        } catch (err) {
            console.error('Error accessing microphone for recorder:', err);
        }
    };

    const [isTTSPlaying, setIsTTSPlaying] = useState(false);

    // Orlena Flow States: tracks the translation pipeline visualization
    type OrlenaFlowState = 'idle' | 'receiving' | 'translating' | 'playing';
    const [orlenaFlowState, setOrlenaFlowState] = useState<OrlenaFlowState>('idle');
    const [flowDirection, setFlowDirection] = useState<'me_to_peer' | 'peer_to_me' | null>(null);

    // Sync remote flow status to local UI visualization
    // Sync remote flow status to local UI visualization
    useEffect(() => {
        console.log('[FLOW] Remote status changed:', remoteFlowStatus);

        if (remoteFlowStatus === 'idle') {
            setOrlenaFlowState('idle');
            setFlowDirection(null);
        } else if (remoteFlowStatus === 'receiving') {
            // Peer is speaking/sending to Orlena
            setOrlenaFlowState('receiving');
            setFlowDirection('peer_to_me');
        } else if (remoteFlowStatus === 'translating') {
            // Peer is translating. This implies they received a message (from me) and are processing it.
            // So on my screen: Me -> Orlena (spinning)
            setOrlenaFlowState('translating');
            setFlowDirection('me_to_peer');
        } else if (remoteFlowStatus === 'playing') {
            // Peer is playing audio (TTS). This implies they are hearing the translation of my message.
            // So on my screen: Orlena -> Peer (playing)
            setOrlenaFlowState('playing');
            setFlowDirection('me_to_peer');
        }
    }, [remoteFlowStatus]);

    // Remote is doing something (translating/playing) -> implies flow is coming from them to me
    // BUT wait:
    // If remote is 'receiving' (from me), that means *I* am sending.
    // If remote is 'translating' (locally), that means *I* sent text? No, wait.
    // Let's stick to the user request:
    // "when user 1 is waiting for a reply... user 1 is supposed to see the audio coming from user 2 to orlena to user 1"

    // Map remote status:
    // Peer says 'translating' -> They are translating text I sent? OR they are translating text they spoke?
    // The flow_status I implemented in useWebRTC is generic.

    // Let's assume we broadcast strictly what *we* are doing to the *audio/text flow*.

    // IF Peer Speaking -> Peer sends 'receiving' (to Orlena)?
    // Actually, we need to manually trigger these sends.


    const broadcastFlowStatus = (status: 'idle' | 'receiving' | 'translating' | 'playing') => {
        sendDataMessage({ type: 'flow_status', status });
    };

    const playTTS = useCallback(async (text: string, lang: string, gender: Gender = 'neutral', modelId: string = 'bulbul:v3-beta') => {
        try {
            console.log(`[TTS] Requesting audio for: "${text}" in ${lang} with voice gender: ${gender} and model: ${modelId}`);
            setIsTTSPlaying(true);
            setIsTranslating(false); // Hide translation bubble when TTS starts
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, targetLang: lang, gender, model: modelId })
            });
            const data = await res.json();

            if (data.audio) {
                console.log(`[TTS] Received audio, length: ${data.audio.length}`);
                const binaryString = window.atob(data.audio);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'audio/wav' }); // Sarvam usually returns wav/mp3
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);

                audio.onended = () => {
                    setIsTTSPlaying(false);
                    setOrlenaFlowState('idle');
                    setFlowDirection(null);
                    broadcastFlowStatus('idle'); // Tell peer I am done playing
                    URL.revokeObjectURL(url);
                };

                await audio.play();
            } else {
                console.error('[TTS] No audio in response:', data);
                setIsTTSPlaying(false);
                setOrlenaFlowState('idle');
                setFlowDirection(null);
                broadcastFlowStatus('idle');
            }
        } catch (e) {
            console.error('[TTS] Playback failed:', e);
            setIsTTSPlaying(false);
            setOrlenaFlowState('idle');
            setFlowDirection(null);
            broadcastFlowStatus('idle');
        }
    }, []);

    // Sync Profile ONLY when profile is explicitly set
    useEffect(() => {
        if (profile.isSet) {
            const p = { name: profile.name, avatar: profile.avatar, gender: profile.gender };
            console.log('[SYNC] Writing profile to Firebase:', p);
            sendProfile(p);
        }
    }, [profile.isSet, profile.name, profile.avatar, profile.gender, sendProfile]);

    useEffect(() => {
        const handleIncoming = async () => {
            if (lastTranscript) {
                if (lastTranscript.sender === 'remote') {
                    // Set flow direction for Orlena visualization
                    setOrlenaFlowState('receiving');
                    setFlowDirection('peer_to_me');

                    // Strict Logic as requested:
                    const sourceLang = lastTranscript.language;

                    console.log(`[TRANS] Decision Logic:`, {
                        source: sourceLang,
                        target: hearLang,
                        text: lastTranscript.text
                    });

                    let finalText = lastTranscript.text;
                    let wasTranslated = false;

                    if (sourceLang && sourceLang === hearLang) {
                        // MATCH: Show Original
                        console.log('[TRANS] Lang Match -> Show Original');
                        setTranscripts(prev => [...prev, { text: lastTranscript.text, sender: 'remote' }]);
                        finalText = lastTranscript.text;
                    } else {
                        // MISMATCH -> Translate
                        const srcParam = sourceLang || 'auto';
                        console.log(`[TRANS] Lang Mismatch/Unknown (${srcParam} vs ${hearLang}) -> Translating...`);

                        // Show translation bubble
                        const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === hearLang)?.label || hearLang;
                        setTranslatingToLang(targetLangName);
                        setIsTranslating(true);
                        setOrlenaFlowState('translating');
                        broadcastFlowStatus('translating'); // Tell peer I am translating (meaning Orlena is working on my side)

                        const translated = await translateText(lastTranscript.text, srcParam, hearLang);
                        setTranscripts(prev => [...prev, {
                            text: translated,
                            sender: 'remote',
                            isTranslated: true,
                            originalText: lastTranscript.text
                        }]);
                        finalText = translated;
                        wasTranslated = true;
                    }

                    // Trigger TTS with gender-aware voice
                    // Use hearLang as target for TTS, and remote user's gender for voice
                    if (!finalText.startsWith('[')) { // Avoid TTSing error messages
                        setOrlenaFlowState('playing');
                        broadcastFlowStatus('playing'); // Tell peer I am playing the audio
                        const voiceGender = remoteProfile?.gender || 'neutral';
                        playTTS(finalText, hearLang, voiceGender as Gender, ttsModel);
                    } else {
                        setOrlenaFlowState('idle');
                        setFlowDirection(null);
                        broadcastFlowStatus('idle'); // Tell peer I am done
                    }
                } else {
                    // It's 'me'. Show original.
                    setTranscripts(prev => [...prev, { text: lastTranscript.text, sender: 'me' }]);
                }
            }
        };
        handleIncoming();
    }, [lastTranscript, hearLang, translateText, playTTS]);

    return (
        <main className="flex min-h-screen flex-col bg-zinc-950 text-white">
            {/* Header */}
            <header className="p-4 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="font-bold text-lg flex items-center gap-2">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">Orlena AI</span>
                    <span className="text-zinc-700">|</span>
                    <span className="text-zinc-400 text-sm font-mono">{roomId}</span>
                </h2>

                {/* Language Controls */}
                <div className="flex gap-4 items-center bg-zinc-900 px-4 py-2 rounded-lg border border-zinc-800">
                    <div className="flex flex-col text-xs">
                        <span className="text-zinc-500 mb-1">Hear in</span>
                        <select
                            value={hearLang}
                            onChange={(e) => {
                                const selected = e.target.value as LanguageCode;
                                console.log('[UI] Hear Language Changed to:', selected);
                                setHearLang(selected);
                            }}
                            className="bg-zinc-800 border-none rounded px-2 py-1 text-white focus:ring-1 focus:ring-emerald-500"
                        >
                            {SUPPORTED_LANGUAGES.map((lang) => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex gap-4 items-center">
                    <span className={`text-xs px-2 py-1 rounded ${isDataChannelOpen ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                        {isDataChannelOpen ? 'Connected' : 'Offline'}
                    </span>
                    <button onClick={() => router.push('/')} className="text-sm text-zinc-500 hover:text-white">Exit</button>
                </div>
            </header>

            {/* ... rest of UI ... */}
            {/* Profile Modal */}
            {!profile.isSet && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-sm space-y-6 shadow-2xl">
                        <div className="text-center space-y-2">
                            <h3 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                                Join Call
                            </h3>
                            <p className="text-zinc-500 text-sm">Set your profile for this session</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Display Name</label>
                                <input
                                    type="text"
                                    value={profile.name}
                                    onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Enter your name"
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Choose Avatar</label>
                                <div className="grid grid-cols-5 gap-2">
                                    {AVATARS.map(av => (
                                        <button
                                            key={av}
                                            onClick={() => setProfile(prev => ({ ...prev, avatar: av }))}
                                            className={`text-2xl p-2 rounded-lg transition-all ${profile.avatar === av ? 'bg-indigo-600/20 ring-2 ring-indigo-500 scale-110' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                                        >
                                            {av}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Voice Gender</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { value: 'male' as Gender, label: 'Male 👨', icon: '♂️' },
                                        { value: 'female' as Gender, label: 'Female 👩', icon: '♀️' },
                                        { value: 'neutral' as Gender, label: 'Neutral 🤝', icon: '⚪' }
                                    ].map(option => (
                                        <button
                                            key={option.value}
                                            onClick={() => setProfile(prev => ({ ...prev, gender: option.value }))}
                                            className={`text-sm py-2 px-3 rounded-lg transition-all ${profile.gender === option.value ? 'bg-indigo-600/20 ring-2 ring-indigo-500' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-zinc-600 mt-1">This selects the voice others hear</p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                if (profile.name.trim()) {
                                    setProfile(prev => ({ ...prev, isSet: true }));
                                }
                            }}
                            disabled={!profile.name.trim()}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20"
                        >
                            Enter Room
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-8">
                {/* Participants Flow: Me → Orlena → Peer */}
                <div className="flex items-center justify-center gap-2 w-full max-w-4xl">
                    {/* Me */}
                    <div className={`bg-zinc-900 rounded-2xl p-6 flex flex-col items-center justify-center border relative overflow-hidden transition-all duration-300 min-w-[180px] ${isTalking ? 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]' : 'border-zinc-800'}`}>
                        <div className="relative w-20 h-20 mb-3">
                            {isTalking && (
                                <>
                                    <div className="absolute inset-0 rounded-full border-2 border-indigo-500/40 waveform-ring" style={{ animationDelay: '0s' }} />
                                    <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 waveform-ring" style={{ animationDelay: '0.3s' }} />
                                </>
                            )}
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-3xl transition-all ${isTalking ? 'bg-indigo-500/20 ring-4 ring-indigo-500/30' : 'bg-indigo-600/20 ring-4 ring-indigo-600/10'}`}>
                                {profile.avatar}
                            </div>
                        </div>
                        <p className={`font-bold text-base transition-colors ${isTalking ? 'text-indigo-400' : 'text-white'}`}>{profile.name || 'You'}</p>
                        <div className="h-5 flex items-center justify-center">
                            {isTTSPlaying ? (
                                <p className="text-emerald-400 text-xs font-medium animate-pulse">🔊 Hearing translation</p>
                            ) : isTalking ? (
                                <p className="text-indigo-400 text-xs font-medium animate-pulse">🎙️ Speaking...</p>
                            ) : (
                                <p className="text-zinc-500 text-xs uppercase tracking-widest">ME</p>
                            )}
                        </div>
                    </div>

                    {/* Arrow: Me ↔ Orlena */}
                    <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${((orlenaFlowState === 'receiving' && flowDirection === 'me_to_peer') || (orlenaFlowState === 'playing' && flowDirection === 'peer_to_me')) ? 'opacity-100' : 'opacity-30'}`}>
                        <div className={`text-2xl transition-transform duration-300 ${(orlenaFlowState === 'receiving' && flowDirection === 'me_to_peer') ? 'animate-pulse text-indigo-400 translate-x-1' :
                            (orlenaFlowState === 'playing' && flowDirection === 'peer_to_me') ? 'animate-pulse text-emerald-400 -translate-x-1 rotate-180' :
                                'text-zinc-600'
                            }`}>
                            →
                        </div>
                        {(orlenaFlowState === 'receiving' && flowDirection === 'me_to_peer') && (
                            <p className="text-[10px] text-indigo-400 animate-pulse whitespace-nowrap">sending...</p>
                        )}
                        {(orlenaFlowState === 'playing' && flowDirection === 'peer_to_me') && (
                            <p className="text-[10px] text-emerald-400 animate-pulse whitespace-nowrap">hearing...</p>
                        )}
                    </div>

                    {/* Orlena - The Translator */}
                    <div className={`bg-gradient-to-br from-zinc-900 to-zinc-950 rounded-2xl p-6 flex flex-col items-center justify-center border relative overflow-hidden transition-all duration-500 min-w-[200px] ${orlenaFlowState === 'translating' ? 'border-purple-500 shadow-[0_0_40px_rgba(168,85,247,0.4)] scale-105' : orlenaFlowState !== 'idle' ? 'border-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'border-zinc-800'}`}>
                        <div className="relative w-20 h-20 mb-3">
                            {orlenaFlowState === 'translating' && (
                                <>
                                    <div className="absolute inset-0 rounded-full border-2 border-purple-500/50 waveform-ring" style={{ animationDelay: '0s' }} />
                                    <div className="absolute inset-0 rounded-full border-2 border-purple-500/30 waveform-ring" style={{ animationDelay: '0.4s' }} />
                                    <div className="absolute inset-0 rounded-full border-2 border-purple-500/20 waveform-ring" style={{ animationDelay: '0.8s' }} />
                                </>
                            )}
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-3xl transition-all ${orlenaFlowState === 'translating' ? 'bg-purple-500/30 ring-4 ring-purple-500/40' : orlenaFlowState !== 'idle' ? 'bg-indigo-500/20 ring-4 ring-indigo-500/20' : 'bg-zinc-800 ring-4 ring-zinc-700/30'}`}>
                                <span className={`transition-transform duration-500 ${orlenaFlowState === 'translating' ? 'animate-spin' : ''}`}>✨</span>
                            </div>
                        </div>
                        <p className={`font-bold text-base bg-clip-text text-transparent bg-gradient-to-r transition-all ${orlenaFlowState === 'translating' ? 'from-purple-400 to-pink-400' : orlenaFlowState !== 'idle' ? 'from-indigo-400 to-purple-400' : 'from-zinc-400 to-zinc-500'}`}>
                            Orlena AI
                        </p>
                        <div className="h-6 flex items-center justify-center">
                            {orlenaFlowState === 'translating' ? (
                                <p className="text-purple-400 text-xs font-medium animate-pulse">✨ Translating...</p>
                            ) : orlenaFlowState === 'receiving' ? (
                                <p className="text-indigo-400 text-xs animate-pulse">Receiving audio...</p>
                            ) : orlenaFlowState === 'playing' ? (
                                <p className="text-emerald-400 text-xs animate-pulse">Playing to {flowDirection === 'me_to_peer' ? 'peer' : 'you'}...</p>
                            ) : (
                                <p className="text-zinc-600 text-xs uppercase tracking-widest">TRANSLATOR</p>
                            )}
                        </div>
                    </div>

                    {/* Arrow: Orlena → Peer */}
                    <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${(orlenaFlowState === 'playing' && flowDirection === 'me_to_peer') || (orlenaFlowState === 'receiving' && flowDirection === 'peer_to_me') ? 'opacity-100' : 'opacity-30'}`}>
                        <div className={`text-2xl transition-transform duration-300 ${(orlenaFlowState === 'playing' && flowDirection === 'me_to_peer') ? 'animate-pulse text-emerald-400 translate-x-1' : (orlenaFlowState === 'receiving' && flowDirection === 'peer_to_me') ? 'animate-pulse text-indigo-400 -translate-x-1 rotate-180' : 'text-zinc-600'}`}>
                            →
                        </div>
                        {(orlenaFlowState === 'playing' && flowDirection === 'me_to_peer') && (
                            <p className="text-[10px] text-emerald-400 animate-pulse whitespace-nowrap">playing...</p>
                        )}
                    </div>

                    {/* Peer */}
                    <div className={`bg-zinc-900 rounded-2xl p-6 flex flex-col items-center justify-center border relative overflow-hidden transition-all duration-300 min-w-[180px] ${isPeerSpeaking || isTTSPlaying ? 'border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]' : 'border-zinc-800'}`}>
                        {participants.length > 1 ? (
                            <>
                                <div className="relative w-20 h-20 mb-3">
                                    {(isPeerSpeaking || isTTSPlaying) && (
                                        <>
                                            <div className="absolute inset-0 rounded-full border-2 border-emerald-500/40 waveform-ring" style={{ animationDelay: '0s' }} />
                                            <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 waveform-ring" style={{ animationDelay: '0.3s' }} />
                                        </>
                                    )}
                                    <div className={`w-full h-full rounded-full flex items-center justify-center text-3xl transition-all ${isPeerSpeaking || isTTSPlaying ? 'bg-emerald-500/20 ring-4 ring-emerald-500/30' : 'bg-zinc-800 ring-4 ring-zinc-700/30'}`}>
                                        {remoteProfile ? remoteProfile.avatar : (isPeerSpeaking ? '🗣️' : '👤')}
                                    </div>
                                </div>
                                <p className={`font-bold text-base transition-colors ${isPeerSpeaking || isTTSPlaying ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                    {remoteProfile ? remoteProfile.name : 'Peer'}
                                </p>
                                <div className="h-5 flex items-center justify-center">
                                    {isPeerSpeaking ? (
                                        <p className="text-emerald-400 text-xs animate-pulse">Speaking...</p>
                                    ) : (
                                        <p className="text-zinc-500 text-xs uppercase tracking-widest">PEER</p>
                                    )}
                                </div>
                                {isConnected && <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" title="Connected"></span>}
                            </>
                        ) : (
                            <div className="text-center p-4 space-y-3 opacity-50">
                                <div className="w-14 h-14 rounded-full bg-zinc-800 mx-auto animate-pulse" />
                                <p className="text-zinc-500 text-xs">Waiting for peer...</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Translation Status Bubble */}
                {isTranslating && (
                    <div className="w-full max-w-2xl flex justify-start mb-2">
                        <div className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 rounded-full flex items-center gap-2 animate-pulse">
                            <span className="animate-spin text-base">✨</span>
                            Translating to {translatingToLang}
                        </div>
                    </div>
                )}

                {/* Transcripts / Messages */}
                <div className="w-full max-w-2xl h-64 overflow-y-auto bg-zinc-900/50 rounded-xl p-4 space-y-3 border border-zinc-800/50">
                    {transcripts.length === 0 && <p className="text-zinc-600 text-center italic text-sm mt-10">Transcripts will appear here...</p>}
                    {transcripts.map((msg, i) => (
                        <div key={i} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${msg.sender === 'me'
                                ? 'bg-indigo-600 text-white rounded-br-none'
                                : 'bg-zinc-800 text-zinc-100 rounded-bl-none border border-zinc-700'
                                }`}>
                                {msg.text}
                                {msg.isTranslated && (
                                    <div className="text-[10px] opacity-50 mt-1 border-t border-white/10 pt-1">
                                        Original: {msg.originalText}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Connection Status */}
                <div className="flex flex-col items-center gap-4">
                    {!isConnected && participants.length > 1 && (
                        <button
                            onClick={startCall}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-full font-medium transition-all"
                        >
                            Connect Audio
                        </button>
                    )}

                    <button
                        onClick={toggleRecording}
                        disabled={!isDataChannelOpen}
                        className={`
                            w-20 h-20 rounded-full flex items-center justify-center border-4 transition-all duration-300
                            ${!isDataChannelOpen
                                ? 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed'
                                : isTalking
                                    ? 'border-indigo-500 bg-indigo-600 text-white scale-110 shadow-[0_0_30px_rgba(99,102,241,0.5)] animate-pulse'
                                    : 'border-white/20 bg-zinc-800 text-white hover:bg-zinc-700 hover:scale-105'
                            }
                        `}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill={isTalking ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {isTalking
                                ? <rect x="6" y="6" width="12" height="12" rx="2" stroke="none" />
                                : <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></>
                            }
                        </svg>
                    </button>
                    <p className="text-zinc-500 text-xs mt-2 font-medium uppercase tracking-wider">
                        {!isDataChannelOpen ? 'Connecting...' : isTalking ? 'Tap to Stop' : 'Tap to Speak'}
                    </p>
                </div>

                {/* Debug Info (Remove before production) */}
                <div className="w-full max-w-2xl bg-black/50 p-2 rounded text-[10px] text-zinc-600 font-mono mt-4">
                    <p>DEBUG INFO:</p>
                    <p>Last Transcript: {JSON.stringify(lastTranscript)}</p>
                    <p>My Hear Lang: {hearLang}</p>
                    <p>Remote Profile: {JSON.stringify(remoteProfile)}</p>
                    <p>Data Channel Open: {isDataChannelOpen ? 'YES' : 'NO'}</p>
                    <p>My Profile Set: {profile.isSet ? 'YES' : 'NO'}</p>
                </div>
            </div>
        </main >
    );
}
