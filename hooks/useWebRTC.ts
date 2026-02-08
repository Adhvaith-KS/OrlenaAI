import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set, push, onChildAdded, off, remove, onDisconnect } from 'firebase/database';

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
    const localStream = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize remote audio element once
    useEffect(() => {
        const audio = new Audio();
        audio.autoplay = true;
        remoteAudioRef.current = audio;
    }, []);

    // Firebase Signaling
    useEffect(() => {
        if (!roomId || !userId) return;

        console.log(`[FIREBASE] Joining room: ${roomId} as ${userId}`);

        const participantsRef = ref(db, `rooms/${roomId}/participants`);
        const myParticipantRef = ref(db, `rooms/${roomId}/participants/${userId}`);
        const offerRef = ref(db, `rooms/${roomId}/offer`);
        const answerRef = ref(db, `rooms/${roomId}/answer`);
        const myCandidatesRef = ref(db, `rooms/${roomId}/candidates/${userId}`);

        // 1. Join & Presence (Join with timestamp to determine role)
        set(myParticipantRef, Date.now());
        onDisconnect(myParticipantRef).remove();

        // 2. Sync Participants
        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Sort by join time to establish fixed roles
                const sorted = Object.keys(data).sort((a, b) => data[a] - data[b]);
                console.log('[FIREBASE] Participants updated:', sorted);
                setParticipants(sorted);
            } else {
                setParticipants([]);
            }
        });

        // 3. Sync TTS Model
        const unsubModel = onValue(ref(db, `rooms/${roomId}/ttsModel`), (snapshot) => {
            const model = snapshot.val();
            if (model) setTtsModel(model);
        });
        if (initialModel) {
            set(ref(db, `rooms/${roomId}/ttsModel`), initialModel);
        }

        // 4. Listen for Offer (Joiner side)
        const unsubOffer = onValue(offerRef, async (snapshot) => {
            const offerMsg = snapshot.val();
            if (offerMsg && offerMsg.senderId !== userId) {
                console.log('[FIREBASE] Offer received from:', offerMsg.senderId);
                await handleIncomingOffer(offerMsg);
            }
        });

        // 5. Listen for Answer (Caller side)
        const unsubAnswer = onValue(answerRef, async (snapshot) => {
            const answerMsg = snapshot.val();
            if (answerMsg && answerMsg.senderId !== userId) {
                console.log('[FIREBASE] Answer received from:', answerMsg.senderId);
                await handleIncomingAnswer(answerMsg);
            }
        });

        // 6. Listen for ICE Candidates
        const unsubCandidates = onChildAdded(myCandidatesRef, (snapshot) => {
            const candidate = snapshot.val();
            if (candidate && candidate.senderId !== userId) {
                console.log('[FIREBASE] ICE candidate received');
                handleIncomingCandidate(candidate.data);
            }
        });

        return () => {
            off(participantsRef);
            off(offerRef);
            off(answerRef);
            off(myCandidatesRef);
            unsubParticipants();
            unsubModel();
            unsubOffer();
            unsubAnswer();
            remove(myParticipantRef);
            if (localStream.current) {
                localStream.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [roomId, userId]);

    const handleIncomingOffer = async (msg: any) => {
        let pc = peerConnection.current;
        if (!pc) pc = initializePeerConnection();

        console.log('[WEBRTC] Processing offer...');
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));

        // Before answering, ensure we also have our mic ready if possible
        if (!localStream.current) {
            await setupMediaStream(pc);
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        console.log('[FIREBASE] writing answer');
        set(ref(db, `rooms/${roomId}/answer`), {
            type: 'answer',
            senderId: userId,
            data: { sdp: answer.sdp, type: answer.type }
        });
    };

    const handleIncomingAnswer = async (msg: any) => {
        const pc = peerConnection.current;
        if (pc) {
            console.log('[WEBRTC] Processing answer...');
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        }
    };

    const handleIncomingCandidate = async (candidateData: any) => {
        const pc = peerConnection.current;
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
                console.error('[WEBRTC] Error adding ICE candidate', e);
            }
        }
    };

    const setupMediaStream = async (pc: RTCPeerConnection) => {
        try {
            console.log('[WEBRTC] requesting mic');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('[WEBRTC] mic granted');
            localStream.current = stream;
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
                console.log('[WEBRTC] audio track added:', track.label);
            });
            return stream;
        } catch (e) {
            console.error('[WEBRTC] mic error:', e);
            return null;
        }
    };

    const handleDataMessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === 'transcript') {
                    setLastTranscript({
                        text: parsed.text,
                        sender: 'remote',
                        language: parsed.language
                    });
                } else if (parsed.type === 'peer-profile') {
                    setRemoteProfile(parsed.profile);
                } else if (parsed.type === 'speaking_status') {
                    setIsPeerSpeaking(parsed.isSpeaking);
                }
            } catch (e) {
                console.error('Error parsing text message', e);
            }
            return;
        }

        // Binary playback (fallback or data-channel specific)
        const arrayBuffer = event.data;
        if (!(arrayBuffer instanceof ArrayBuffer)) return;

        try {
            const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.load();
            setIsRemoteSpeaking(true);
            audio.onended = () => {
                setIsRemoteSpeaking(false);
                URL.revokeObjectURL(url);
            };
            audio.play().catch(() => setIsRemoteSpeaking(false));
        } catch (e) {
            console.error('Error handling audio message', e);
            setIsRemoteSpeaking(false);
        }
    };

    const setupDataChannelEvents = (channel: RTCDataChannel) => {
        channel.binaryType = 'arraybuffer';
        if (channel.readyState === 'open') setDataChannelOpen(true);
        channel.onopen = () => setDataChannelOpen(true);
        channel.onclose = () => setDataChannelOpen(false);
        channel.onmessage = handleDataMessage;
    };

    const initializePeerConnection = () => {
        if (peerConnection.current) return peerConnection.current;

        console.log('[WEBRTC] Initializing PeerConnection');
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const targetId = participants.find(p => p !== userId);
                if (targetId) {
                    console.log('[FIREBASE] Sending ICE candidate to:', targetId);
                    const targetCandidatesRef = ref(db, `rooms/${roomId}/candidates/${targetId}`);
                    push(targetCandidatesRef, {
                        senderId: userId,
                        data: event.candidate.toJSON()
                    });
                }
            }
        };

        pc.onconnectionstatechange = () => {
            console.log('[WEBRTC] connectionState:', pc.connectionState);
            setIsConnected(pc.connectionState === 'connected');
        };

        pc.oniceconnectionstatechange = () => {
            console.log('[WEBRTC] iceConnectionState:', pc.iceConnectionState);
        };

        pc.ontrack = (event) => {
            console.log('[WEBRTC] remote audio received');
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = event.streams[0];
            }
        };

        pc.ondatachannel = (event) => {
            console.log('[WEBRTC] DataChannel received');
            const receiveChannel = event.channel;
            setupDataChannelEvents(receiveChannel);
            dataChannel.current = receiveChannel;
        };

        peerConnection.current = pc;
        return pc;
    };

    const startCall = async () => {
        const targetId = participants.find(p => p !== userId);
        if (!targetId) {
            console.warn('[WEBRTC] No peer to call yet');
            return;
        }

        // Role check: Ensure ONLY ONE peer creates the offer
        // Let's make the SECOND person (joiner) the caller so they have someone to call.
        if (participants[1] !== userId) {
            console.log('[WEBRTC] Waiting for joiner to initiate call...');
            return;
        }

        console.log('[WEBRTC] Starting call (Initiating offer)');
        const pc = initializePeerConnection();

        // Setup Media
        await setupMediaStream(pc);

        // Setup Data
        const channel = pc.createDataChannel('audio-channel');
        setupDataChannelEvents(channel);
        dataChannel.current = channel;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log('[FIREBASE] offer written');
        set(ref(db, `rooms/${roomId}/offer`), {
            type: 'offer',
            senderId: userId,
            data: { sdp: offer.sdp, type: offer.type }
        });
    };

    const sendAudio = async (blob: Blob) => {
        if (dataChannel.current?.readyState === 'open') {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                dataChannel.current.send(arrayBuffer);
            } catch (e) {
                console.error('[SEND] Error sending audio:', e);
            }
        }
    };

    const sendText = (text: string, language?: string) => {
        if (dataChannel.current?.readyState === 'open') {
            dataChannel.current.send(JSON.stringify({ type: 'transcript', text, language }));
        }
    };

    const sendProfile = (profile: { name: string; avatar: string; gender?: string }) => {
        if (dataChannel.current?.readyState === 'open') {
            dataChannel.current.send(JSON.stringify({ type: 'peer-profile', profile }));
        }
    };

    const sendSpeakingStatus = (isSpeaking: boolean) => {
        if (dataChannel.current?.readyState === 'open') {
            dataChannel.current.send(JSON.stringify({ type: 'speaking_status', isSpeaking }));
        }
    };

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
        ttsModel
    };
};
