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

    // Firebase Signaling
    useEffect(() => {
        if (!roomId || !userId) return;

        console.log(`[FIREBASE] Joining room: ${roomId} as ${userId}`);

        const roomRef = ref(db, `rooms/${roomId}`);
        const participantsRef = ref(db, `rooms/${roomId}/participants`);
        const myParticipantRef = ref(db, `rooms/${roomId}/participants/${userId}`);
        const offerRef = ref(db, `rooms/${roomId}/offer`);
        const answerRef = ref(db, `rooms/${roomId}/answer`);
        const myCandidatesRef = ref(db, `rooms/${roomId}/candidates/${userId}`);

        // 1. Join & Presence
        set(myParticipantRef, true);
        onDisconnect(myParticipantRef).remove();

        // 2. Sync Participants
        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const plist = Object.keys(data);
                console.log('[FIREBASE] Participants updated:', plist);
                setParticipants(plist);
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
                console.log('[FIREBASE] Offer received');
                await handleIncomingOffer(offerMsg);
            }
        });

        // 5. Listen for Answer (Caller side)
        const unsubAnswer = onValue(answerRef, async (snapshot) => {
            const answerMsg = snapshot.val();
            if (answerMsg && answerMsg.senderId !== userId) {
                console.log('[FIREBASE] Answer received');
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
        };
    }, [roomId, userId]);

    const handleIncomingOffer = async (msg: any) => {
        let pc = peerConnection.current;
        if (!pc) pc = initializePeerConnection();

        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
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
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        }
    };

    const handleIncomingCandidate = async (candidateData: any) => {
        const pc = peerConnection.current;
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
                console.error('Error adding ICE candidate', e);
            }
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
            setIsConnected(pc.connectionState === 'connected');
        };

        pc.ondatachannel = (event) => {
            const receiveChannel = event.channel;
            setupDataChannelEvents(receiveChannel);
            dataChannel.current = receiveChannel;
        };

        peerConnection.current = pc;
        return pc;
    };

    const startCall = async () => {
        const targetId = participants.find(p => p !== userId);
        if (!targetId) return;

        const pc = initializePeerConnection();
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
