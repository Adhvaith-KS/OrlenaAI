import { useEffect, useRef, useState } from 'react';
import { SignalMessage } from '@/app/types';

const ICE_SERVERS = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const useWebRTC = (roomId: string, userId: string, initialModel?: string) => {
    const [isConnected, setIsConnected] = useState(false);
    const [participants, setParticipants] = useState<string[]>([]);
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    const [remoteAudioUrl, setRemoteAudioUrl] = useState<string | null>(null);
    const [dataChannelOpen, setDataChannelOpen] = useState(false);
    const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
    const [isPeerSpeaking, setIsPeerSpeaking] = useState(false);
    const [lastTranscript, setLastTranscript] = useState<{ text: string; sender: 'me' | 'remote'; language?: string } | null>(null);
    const [remoteProfile, setRemoteProfile] = useState<{ name: string; avatar: string; gender?: string } | null>(null);
    const [ttsModel, setTtsModel] = useState<string>('bulbul:v3-beta');

    // Polling for signals
    useEffect(() => {
        if (!roomId || !userId) return;

        // Join room immediately
        fetch('/api/signaling', {
            method: 'POST',
            body: JSON.stringify({ type: 'join', roomId, userId, ttsModel: initialModel }),
        }).then(res => res.json()).then(data => {
            if (data.participants) setParticipants(data.participants);
            if (data.ttsModel) setTtsModel(data.ttsModel);
        });

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/signaling?roomId=${roomId}&userId=${userId}`);
                const data = await res.json();

                if (data.participants) {
                    setParticipants(data.participants);
                }

                if (data.ttsModel) {
                    setTtsModel(data.ttsModel);
                }

                if (data.messages) {
                    for (const msg of data.messages as SignalMessage[]) {
                        await handleSignal(msg);
                    }
                }
            } catch (e) {
                console.error('Polling error:', e);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [roomId, userId]);

    // Initiate connection if we are the second person or "caller" logic
    // Simplified: If we see another participant and we haven't connected, try to connect.
    // Actually, simpler: Allow manual "Start Call" or auto-start when 2 people exist.
    // Let's go with: The person who IS NOT the creator (the joiner) sends the offer? 
    // Or: Just checking if participants > 1 and I am the one with higher ID? 
    // To keep it VERY simple: The "Room" page will have a `useEffect` that triggers `initiateConnection` when `participants.length === 2`.
    // But we need to avoid race conditions. 
    // Let's add a function `startCall()` exposed by the hook.

    const handleDataMessage = (event: MessageEvent) => {
        // Handle Text Messages (Transcripts)
        if (typeof event.data === 'string') {
            console.log('[DATA] Received text message:', event.data);
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === 'transcript') {
                    setLastTranscript({
                        text: parsed.text,
                        sender: 'remote',
                        language: parsed.language // capture the language!
                    });
                } else if (parsed.type === 'peer-profile' || parsed.type === 'user_profile') {
                    console.log('[DATA] Received peer profile:', parsed.profile);
                    setRemoteProfile(parsed.profile);
                } else if (parsed.type === 'speaking_status') {
                    setIsPeerSpeaking(parsed.isSpeaking);
                }
            } catch (e) {
                console.error('Error parsing text message', e);
            }
            return;
        }

        // Handle Binary Messages (Audio)
        const arrayBuffer = event.data;
        // Verify it's actually an ArrayBuffer
        if (!(arrayBuffer instanceof ArrayBuffer)) {
            console.warn('[DATA] Received unknown data type:', typeof arrayBuffer);
            return;
        }

        console.log('[DATA] Received audio size:', arrayBuffer.byteLength);

        try {
            // Use generic type for playback to allow browser sniffing.
            // Strict 'audio/webm;codecs=opus' sometimes causes NotSupportedError in new Audio() if container/codec structure slightly varies.
            const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
            console.log(`[REC] Blob created: ${blob.size} bytes`);

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);

            // Explicitly load to check for source errors
            audio.load();

            setIsRemoteSpeaking(true);

            audio.onended = () => {
                setIsRemoteSpeaking(false);
                URL.revokeObjectURL(url);
            };

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.error('Audio play failed', e);
                    setIsRemoteSpeaking(false);
                });
            }

        } catch (e) {
            console.error('Error handling audio message', e);
            setIsRemoteSpeaking(false);
        }
    };

    const setupDataChannelEvents = (channel: RTCDataChannel) => {
        channel.binaryType = 'arraybuffer'; // Crucial: ensure we get raw bytes

        if (channel.readyState === 'open') {
            console.log('Data channel ALREADY OPEN');
            setDataChannelOpen(true);
        }
        channel.onopen = () => {
            console.log('Data channel OPEN');
            setDataChannelOpen(true);
        };
        channel.onclose = () => {
            console.log('Data channel CLOSED');
            setDataChannelOpen(false);
        };
        channel.onerror = (e) => console.error('Data channel error:', e);
        channel.onmessage = handleDataMessage;
    };

    const initializePeerConnection = () => {
        if (peerConnection.current) return peerConnection.current;

        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // Find the other participant
                const targetId = participants.find(p => p !== userId);
                if (targetId) {
                    sendSignal('ice-candidate', event.candidate, targetId);
                }
            }
        };

        pc.onconnectionstatechange = () => {
            console.log('Connection state:', pc.connectionState);
            setIsConnected(pc.connectionState === 'connected');
        };

        pc.ondatachannel = (event) => {
            console.log('Received DataChannel from remote');
            const receiveChannel = event.channel;
            setupDataChannelEvents(receiveChannel);
            dataChannel.current = receiveChannel;
        };

        peerConnection.current = pc;
        return pc;
    };

    const createDataChannel = (pc: RTCPeerConnection) => {
        console.log('Creating DataChannel locally');
        const channel = pc.createDataChannel('audio-channel');
        setupDataChannelEvents(channel);
        dataChannel.current = channel;
    };



    const sendSignal = (type: string, data: any, targetId: string) => {
        fetch('/api/signaling', {
            method: 'POST',
            body: JSON.stringify({ type, roomId, userId, targetId, data }),
        });
    };

    const handleSignal = async (msg: SignalMessage) => {
        // Only handle if it's from the other person
        if (msg.senderId === userId) return;

        let pc = peerConnection.current;
        if (!pc) pc = initializePeerConnection();

        if (msg.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal('answer', answer, msg.senderId);

            // Also setup data channel listener was invalid here, it's connected in ondatachannel
        } else if (msg.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        } else if (msg.type === 'ice-candidate') {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.data));
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
        }
    };

    const startCall = async () => {
        const targetId = participants.find(p => p !== userId);
        if (!targetId) return; // No one to call

        const pc = initializePeerConnection();
        createDataChannel(pc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal('offer', offer, targetId);
    };

    const sendAudio = async (blob: Blob) => {
        console.log(`[SEND] Sending audio. Size: ${blob.size}, Type: ${blob.type}`);

        if (dataChannel.current && dataChannel.current.readyState === 'open') {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                console.log(`[SEND] Converting to ArrayBuffer. ByteLength: ${arrayBuffer.byteLength}`);
                dataChannel.current.send(arrayBuffer);
            } catch (e) {
                console.error('[SEND] Error sending audio:', e);
            }
        } else {
            console.warn('[SEND] Data channel not open');
        }
    };

    const sendText = (text: string, language?: string) => {
        if (dataChannel.current && dataChannel.current.readyState === 'open') {
            const payload = JSON.stringify({ type: 'transcript', text, language });
            dataChannel.current.send(payload);
        }
    };

    const sendProfile = (profile: { name: string; avatar: string }) => {
        if (dataChannel.current && dataChannel.current.readyState === 'open') {
            console.log('[DATA] Sending profile (peer-profile):', profile);
            const payload = JSON.stringify({ type: 'peer-profile', profile });
            dataChannel.current.send(payload);
        } else {
            console.warn('[DATA] Cannot send profile: DataChannel not open (State: ' + dataChannel.current?.readyState + ')');
        }
    };

    const sendSpeakingStatus = (isSpeaking: boolean) => {
        if (dataChannel.current && dataChannel.current.readyState === 'open') {
            const payload = JSON.stringify({ type: 'speaking_status', isSpeaking });
            dataChannel.current.send(payload);
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
