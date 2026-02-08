import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set, push, onChildAdded, off, remove, onDisconnect } from 'firebase/database';

// Module-level set to track ALL local stream IDs (original + clones)
const LOCAL_STREAM_IDS = new Set<string>();
const LOCAL_TRACK_IDS = new Set<string>();

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

                    const isLocalTrack = tracks.some(t => LOCAL_TRACK_IDS.has(t.id));

                    if (isLocalMic || LOCAL_STREAM_IDS.has(val.id) || isLocalTrack) {
                        console.warn(`[Global Audio Guard] Blocked playback of local stream ${val.id}`);
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
                        const isLocalTrack = val.getTracks().some(t => LOCAL_TRACK_IDS.has(t.id));
                        if (isLocalMic || LOCAL_STREAM_IDS.has(val.id) || isLocalTrack) {
                            node.muted = true;
                            node.volume = 0;
                            console.warn(`[Global Audio Guard] Silenced new local microphone element for stream ${val.id}`);
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
    // Unique ID for this browser session to prevent self-loop signaling
    const [clientId] = useState(() => Math.random().toString(36).substring(7) + Date.now());
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
    const [remoteFlowStatus, setRemoteFlowStatus] = useState<'idle' | 'receiving' | 'translating' | 'playing'>('idle');
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize remote audio element once - DISABLED for loopback fix
    // We don't actually need this element since audio is handled via TTS
    useEffect(() => {
        // AUDIO LOOPBACK FIX: Don't create an auto-playing audio element
        // The app uses STT -> Translate -> TTS, so WebRTC audio streams are not needed
        remoteAudioRef.current = null;
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
            if (offerMsg) {
                if (offerMsg.senderClientId === clientId) {
                    console.log('[WEBRTC] Ignoring self offer message');
                    return;
                }
                console.log(`[FIREBASE] Processing remote peer signaling (Offer) from ${offerMsg.senderId}`);
                await handleIncomingOffer(offerMsg);
            }
        });

        const unsubAnswer = onValue(answerRef, async (snapshot) => {
            const answerMsg = snapshot.val();
            if (answerMsg) {
                if (answerMsg.senderClientId === clientId) {
                    console.log('[WEBRTC] Ignoring self answer message');
                    return;
                }
                console.log(`[FIREBASE] Processing remote peer signaling (Answer) from ${answerMsg.senderId}`);
                await handleIncomingAnswer(answerMsg);
            }
        });

        const unsubCandidates = onChildAdded(myCandidatesRef, (snapshot) => {
            const candidate = snapshot.val();
            if (candidate) {
                if (candidate.senderClientId === clientId) {
                    console.log('[WEBRTC] Ignoring self ICE candidate');
                    return;
                }
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
            senderClientId: clientId,
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

            // Track the original stream ID
            LOCAL_STREAM_IDS.add(stream.id);
            stream.getTracks().forEach(t => LOCAL_TRACK_IDS.add(t.id));

            // MANDATORY CLONING: Separate the capture tracks from potential accidental sinks
            const clonedStream = stream.clone();
            LOCAL_STREAM_IDS.add(clonedStream.id);
            clonedStream.getTracks().forEach(t => LOCAL_TRACK_IDS.add(t.id));

            console.log(`[WEBRTC] local microphone cloned and isolated. Blocked Stream IDs:`, Array.from(LOCAL_STREAM_IDS));
            console.log(`[WEBRTC] Blocked Track IDs:`, Array.from(LOCAL_TRACK_IDS));

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
                } else if (parsed.type === 'flow_status') {
                    setRemoteFlowStatus(parsed.status);
                }
            } catch (e) {
                console.error('Error parsing text message', e);
            }
            return;
        }
        // AUDIO LOOPBACK FIX: Disable binary audio playback from DataChannel
        // The app uses TTS for audio, so we don't need to play raw audio blobs
        console.log('[WEBRTC] Binary data received on DataChannel - audio playback DISABLED');
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
                        senderClientId: clientId,
                        data: event.candidate.toJSON()
                    });
                }
            }
        };
        pc.onconnectionstatechange = () => {
            setIsConnected(pc.connectionState === 'connected');
        };
        pc.ontrack = (event) => {
            // AUDIO LOOPBACK FIX: Completely disable WebRTC audio playback.
            // The app uses STT -> Translate -> TTS flow, so raw audio streaming
            // is not needed and was causing users to hear their own microphone.
            // 
            // The peer connection is still used for:
            // 1. DataChannel (text transcripts, speaking status)
            // 2. Presence detection (knowing a peer is connected)
            //
            // Audio is reconstructed via TTS on the receiving end.
            console.log('[WEBRTC] ontrack fired - audio playback DISABLED to prevent loopback');

            // Keep the audio element permanently muted
            if (remoteAudioRef.current) {
                remoteAudioRef.current.muted = true;
                remoteAudioRef.current.volume = 0;
                // Do NOT assign srcObject to avoid any playback
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
        if (!targetId) return;

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
            senderClientId: clientId,
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
        localStream: localStreamRef.current,
        remoteFlowStatus,
        sendDataMessage: (msg: any) => {
            if (dataChannel.current && dataChannel.current.readyState === 'open') {
                dataChannel.current.send(JSON.stringify(msg));
            }
        }
    };
};

if (typeof window !== 'undefined') {
    (window as any).DEBUG_AUDIO_ELEMENTS = () => {
        console.log('--- DEBUG AUDIO ELEMENTS ---');
        console.log('LOCAL_STREAM_IDS:', Array.from(LOCAL_STREAM_IDS));
        console.log('LOCAL_TRACK_IDS:', Array.from(LOCAL_TRACK_IDS));
        const elements = document.querySelectorAll('audio, video');
        elements.forEach((el, i) => {
            const mediaEl = el as HTMLMediaElement;
            const srcObject = mediaEl.srcObject as MediaStream | null;
            console.log(`Element ${i} [${mediaEl.tagName}]:`, {
                src: mediaEl.src,
                srcObject: srcObject ? { id: srcObject.id, tracks: srcObject.getTracks().map(t => ({ id: t.id, label: t.label, kind: t.kind })) } : null,
                muted: mediaEl.muted,
                volume: mediaEl.volume,
                paused: mediaEl.paused,
                autoplay: mediaEl.autoplay,
                error: mediaEl.error,
                readyState: mediaEl.readyState
            });
        });
        console.log('--- END DEBUG ---');
    };
    console.log('[DEBUG] window.DEBUG_AUDIO_ELEMENTS() is available');
}
