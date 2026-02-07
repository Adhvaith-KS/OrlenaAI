import { NextRequest, NextResponse } from 'next/server';
import { Room, SignalMessage } from '@/app/types';

/**
 * Vercel Serverless Signaling Store
 * Note: In a production environment, this MUST be replaced with Redis or Vercel KV.
 * For a hackathon/demo, we use globalThis as a best-effort ephemeral store.
 */
const globalRooms = (globalThis as any).rooms || {};
(globalThis as any).rooms = globalRooms;

const ROOMS: { [roomId: string]: Room } = globalRooms;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { type, roomId, userId, targetId, data } = body;

        if (!roomId || !userId) {
            return NextResponse.json({ error: 'Missing roomId or userId' }, { status: 400 });
        }

        if (type === 'join') {
            console.log(`[SIGNAL] USER_JOIN | Room: ${roomId} | User: ${userId}`);

            if (!ROOMS[roomId]) {
                ROOMS[roomId] = {
                    id: roomId,
                    participants: [],
                    messages: {},
                    ttsModel: body.ttsModel
                };
            }

            const room = ROOMS[roomId];

            if (body.ttsModel && !room.ttsModel) {
                room.ttsModel = body.ttsModel;
            }

            if (!room.participants.includes(userId)) {
                if (room.participants.length >= 2) {
                    console.warn(`[SIGNAL] JOIN_REJECTED | Room full: ${roomId}`);
                    return NextResponse.json({ error: 'Room full' }, { status: 400 });
                }
                room.participants.push(userId);
                room.messages[userId] = []; // Initialize inbox
                console.log(`[SIGNAL] PARTICIPANTS | Room: ${roomId} | Count: ${room.participants.length}`);
            }

            return NextResponse.json({
                success: true,
                participants: room.participants,
                ttsModel: room.ttsModel
            });
        }

        // WebRTC Signaling (Offer, Answer, ICE Candidate)
        if (['offer', 'answer', 'ice-candidate'].includes(type) && targetId) {
            if (!ROOMS[roomId]) {
                console.warn(`[SIGNAL] ${type.toUpperCase()}_FAILED | Room not found: ${roomId}`);
                return NextResponse.json({ error: 'Room not found' }, { status: 404 });
            }

            const room = ROOMS[roomId];

            if (!room.messages[targetId]) {
                room.messages[targetId] = [];
            }

            // Log basic info for debugging without leaking binary SDP data
            console.log(`[SIGNAL] ${type.toUpperCase()} | From: ${userId} -> To: ${targetId} | Room: ${roomId}`);

            room.messages[targetId].push({ type, senderId: userId, data });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown signal type' }, { status: 400 });
    } catch (e) {
        console.error('[SIGNAL] SERVER_ERROR:', e);
        return NextResponse.json({ error: 'Internal Signaling Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    const userId = searchParams.get('userId');

    if (!roomId || !userId) {
        return NextResponse.json({ error: 'Missing roomId or userId' }, { status: 400 });
    }

    const room = ROOMS[roomId];
    if (!room) {
        return NextResponse.json({ messages: [], participants: [] });
    }

    const myMessages = room.messages[userId] || [];

    // Clear the inbox after a successful poll (Standard polling-based signaling behavior)
    if (myMessages.length > 0) {
        console.log(`[SIGNAL] MESSAGES_DELIVERED | To: ${userId} | Count: ${myMessages.length}`);
        room.messages[userId] = [];
    }

    return NextResponse.json({
        messages: myMessages,
        participants: room.participants,
        ttsModel: room.ttsModel
    });
}
