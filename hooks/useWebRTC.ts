import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set, push, onChildAdded, off, remove, onDisconnect } from 'firebase/database';

// GLOBAL AUDIO GUARD: Intercepts ANY attempt to play local microphone audio through speakers
if (typeof window !== 'undefined') {
    const originalSrcObjectSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')?.set;

    if (originalSrcObjectSetter) {
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
            set: function (val) {
                if (val instanceof MediaStream) {
                    const tracks = val.getTracks();
                    const isLocalMic = tracks.some(t =>
                        t.label.toLowerCase().includes('mic') ||
                        t.label.toLowerCase().includes('input') ||
                        t.label.toLowerCase().includes('default')
                    );

                    if (isLocalMic) {
                        console.warn('Blocked local microphone playback attempt globally.');
                        this.muted = true;
                        this.volume = 0;
                        // Still allow assignment for WebRTC internal sinks, but force silence
                        return originalSrcObjectSetter.call(this, val);
                    }
                }
                return originalSrcObjectSetter.call(this, val);
            }
        });
    }

    // MutationObserver to catch rogue elements added by React or extensions
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node instanceof HTMLMediaElement) {
                    const val = node.srcObject;
                    if (val instanceof MediaStream) {
                        const isLocalMic = val.getTracks().some(t =>
                            t.label.toLowerCase().includes('mic') ||
                            t.label.toLowerCase().includes('input') ||
                            t.label.toLowerCase().includes('default')
                        );
                        if (isLocalMic) {
                            node.muted = true;
                            node.volume = 0;
                            console.warn('Silenced new local microphone element.');
                        }
                    }
                }
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

const ICE_SERVERS = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const useWebRTC = (roomId: string, userId: string, initialModel?: string) => {
    const [isConnected, setIsConnected] = useState(false);
    const [participants, setParticipants] = useState<string[]>([]);
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    const [dataChannelOpen, setDataChannelOpen] = useState(false);
    const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
    const [isPeerSpeaking, setIsPeerSpeaking] = useState(false);
    const [lastTranscript, setLastTranscript] = useState<{ text: string; sender: 'me' | 'remote'; language?: string } | null>(null);
    const [remoteProfile, setRemoteProfile] = useState<{ name: string; avatar: string; gender?: string } | null>(null);
    const [ttsModel, setTtsModel] = useState<string>(initialModel || 'bulbul:v3-beta');
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize remote audio element once
    useEffect(() => {
        const audio = new Audio();
        audio.autoplay = true;
        // DEFENSIVE DEFAULT: Muted and zero volume until verified remote audio arrives
        audio.muted = true;
        audio.volume = 0;
        remoteAudioRef.current = audio;
    }, []);

    // Firebase Signaling & Profile Sync
    useEffect(() => {
        if (!roomId || !userId) return;

        console.log(`[FIREBASE] Joining room: ${roomId} as ${userId}`);

        const participantsRef = ref(db, `rooms/${roomId}/participants`);
        const myParticipantRef = ref(db, `rooms/${roomId}/participants/${userId}`);
        const profilesRef = ref(db, `rooms/${roomId}/profiles`);
        const offerRef = ref(db, `rooms/${roomId}/offer`);
        const answerRef = ref(db, `rooms/${roomId}/answer`);
        const myCandidatesRef = ref(db, `rooms/${roomId}/candidates/${userId}`);

        // 1. Join & Presence
        set(myParticipantRef, Date.now());
        onDisconnect(myParticipantRef).remove();

        // 2. Sync Participants
        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const sorted = Object.keys(data).sort((a, b) => data[a] - data[b]);
                setParticipants(sorted);
            } else {
                setParticipants([]);
            }
        });

        // 3. Sync Profiles (Replaces buggy DataChannel sync)
        const unsubProfiles = onValue(profilesRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const remoteId = Object.keys(data).find(id => id !== userId);
                if (remoteId && data[remoteId]) {
                    setRemoteProfile(data[remoteId]);
                }
            }
        });

        // 4. Sync TTS Model
        const unsubModel = onValue(ref(db, `rooms/${roomId}/ttsModel`), (snapshot) => {
            const model = snapshot.val();
            if (model) setTtsModel(model);
        });
        if (initialModel) {
            set(ref(db, `rooms/${roomId}/ttsModel`), initialModel);
        }

        // 5. Signaling Listeners
        const unsubOffer = onValue(offerRef, async (snapshot) => {
            const offerMsg = snapshot.val();
            if (offerMsg && offerMsg.senderId !== userId) {
                console.log('[FIREBASE] Offer received');
                await handleIncomingOffer(offerMsg);
            }
        });

        const unsubAnswer = onValue(answerRef, async (snapshot) => {
            const answerMsg = snapshot.val();
            if (answerMsg && answerMsg.senderId !== userId) {
                console.log('[FIREBASE] Answer received');
                await handleIncomingAnswer(answerMsg);
            }
        });

        const unsubCandidates = onChildAdded(myCandidatesRef, (snapshot) => {
            const candidate = snapshot.val();
            if (candidate && candidate.senderId !== userId) {
                handleIncomingCandidate(candidate.data);
            }
        });

        return () => {
            off(participantsRef);
            off(profilesRef);
            off(offerRef);
            off(answerRef);
            off(myCandidatesRef);
            unsubParticipants();
            unsubProfiles();
            unsubModel();
            unsubOffer();
            unsubAnswer();
            remove(myParticipantRef);
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [roomId, userId]);

    const handleIncomingOffer = async (msg: any) => {
        let pc = peerConnection.current;
        if (!pc) pc = initializePeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        if (!localStreamRef.current) await setupMediaStream(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        set(ref(db, `rooms/${roomId}/answer`), {
            type: 'answer',
            senderId: userId,
            data: { sdp: answer.sdp, type: answer.type }
        });
    };

    const handleIncomingAnswer = async (msg: any) => {
        const pc = peerConnection.current;
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
    };

    const handleIncomingCandidate = async (candidateData: any) => {
        const pc = peerConnection.current;
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
                console.error('[WEBRTC] ICE Error', e);
            }
        }
    };

    const setupMediaStream = async (pc: RTCPeerConnection) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // MANDATORY CLONING: Separate the capture tracks from potential accidental sinks
            const clonedStream = stream.clone();
            console.log('[WEBRTC] local microphone cloned and isolated');

            localStreamRef.current = clonedStream;
            clonedStream.getTracks().forEach(track => pc.addTrack(track, clonedStream));
            return clonedStream;
        } catch (e) {
            console.error('[WEBRTC] Mic Error', e);
        }
    };

    const handleDataMessage = useCallback((event: MessageEvent) => {
        if (typeof event.data === 'string') {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === 'transcript') {
                    setLastTranscript({ text: parsed.text, sender: 'remote', language: parsed.language });
                } else if (parsed.type === 'speaking_status') {
                    setIsPeerSpeaking(parsed.isSpeaking);
                }
            } catch (e) {
                console.error('Error parsing text message', e);
            }
            return;
        }
        // Audio playback fallback
        const arrayBuffer = event.data;
        if (!(arrayBuffer instanceof ArrayBuffer)) return;
        try {
            const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.load();
            setIsRemoteSpeaking(true);
            audio.onended = () => { setIsRemoteSpeaking(false); URL.revokeObjectURL(url); };
            audio.play().catch(() => setIsRemoteSpeaking(false));
        } catch (e) {
            console.error('Error handling audio message', e);
            setIsRemoteSpeaking(false);
        }
    }, []);

    const setupDataChannelEvents = useCallback((channel: RTCDataChannel) => {
        channel.binaryType = 'arraybuffer';
        if (channel.readyState === 'open') setDataChannelOpen(true);
        channel.onopen = () => setDataChannelOpen(true);
        channel.onclose = () => setDataChannelOpen(false);
        channel.onmessage = handleDataMessage;
    }, [handleDataMessage]);

    const initializePeerConnection = useCallback(() => {
        if (peerConnection.current) return peerConnection.current;
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const targetId = participants.find(p => p !== userId);
                if (targetId) {
                    push(ref(db, `rooms/${roomId}/candidates/${targetId}`), {
                        senderId: userId,
                        data: event.candidate.toJSON()
                    });
                }
            }
        };
        pc.onconnectionstatechange = () => {
            setIsConnected(pc.connectionState === 'connected');
        };
        pc.ontrack = (event) => {
            const incomingStream = event.streams[0];
            const tracks = incomingStream.getTracks();

            // 1. Label-Based Guard (Microphone/Input Detection)
            const isLocalMicrophone = tracks.some(t =>
                t.label.toLowerCase().includes('mic') ||
                t.label.toLowerCase().includes('input') ||
                t.label.toLowerCase().includes('default')
            );

            // 2. ID-Based Guard (Identity Check)
            const isLocalId = localStreamRef.current && incomingStream.id === localStreamRef.current.id;

            if (isLocalMicrophone || isLocalId) {
                console.error('ERROR: Local microphone routed to speaker — prevented.');
                if (remoteAudioRef.current) {
                    remoteAudioRef.current.muted = true;
                    remoteAudioRef.current.volume = 0;
                }
                return;
            }

            console.log('[WEBRTC] Verified remote stream received. Unmuting playback.');
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = incomingStream;
                remoteAudioRef.current.muted = false;
                remoteAudioRef.current.volume = 1.0;
            }
        };
        pc.ondatachannel = (event) => {
            const receiveChannel = event.channel;
            setupDataChannelEvents(receiveChannel);
            dataChannel.current = receiveChannel;
        };
        peerConnection.current = pc;
        return pc;
    }, [participants, roomId, userId, setupDataChannelEvents]);

    const startCall = useCallback(async () => {
        const targetId = participants.find(p => p !== userId);
        if (!targetId || participants[1] !== userId) return;

        const pc = initializePeerConnection();
        await setupMediaStream(pc);
        const channel = pc.createDataChannel('audio-channel');
        setupDataChannelEvents(channel);
        dataChannel.current = channel;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        set(ref(db, `rooms/${roomId}/offer`), {
            type: 'offer',
            senderId: userId,
            data: { sdp: offer.sdp, type: offer.type }
        });
    }, [participants, roomId, userId, initializePeerConnection, setupDataChannelEvents]);

    const sendAudio = useCallback(async (blob: Blob) => {
        if (dataChannel.current?.readyState === 'open') {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                dataChannel.current.send(arrayBuffer);
            } catch (e) {
                console.error('[SEND] Error sending audio:', e);
            }
        }
    }, []);

    const sendText = useCallback((text: string, language?: string) => {
        if (dataChannel.current?.readyState === 'open') {
            dataChannel.current.send(JSON.stringify({ type: 'transcript', text, language }));
        }
    }, []);

    const sendProfile = useCallback((profileData: { name: string; avatar: string; gender?: string }) => {
        // Now writes to Firebase instead of DataChannel to break the loop
        console.log('[FIREBASE] Updating profile');
        set(ref(db, `rooms/${roomId}/profiles/${userId}`), profileData);
    }, [roomId, userId]);

    const sendSpeakingStatus = useCallback((isSpeaking: boolean) => {
        if (dataChannel.current?.readyState === 'open') {
            dataChannel.current.send(JSON.stringify({ type: 'speaking_status', isSpeaking }));
        }
    }, []);

    return {
        isConnected,
        participants,
        isDataChannelOpen: dataChannelOpen,
        isRemoteSpeaking,
        isPeerSpeaking,
        lastTranscript,
        startCall,
        sendAudio,
        sendText,
        remoteProfile,
        sendProfile,
        sendSpeakingStatus,
        ttsModel,
        localStream: localStreamRef.current
    };
};
