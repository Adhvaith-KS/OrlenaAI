import { NextRequest, NextResponse } from 'next/server';
import { Room } from '../../types';

export const dynamic = 'force-dynamic';

/**
 * VERCEL SERVERLESS SIGNALING STORE (EPHEMERAL)
 * Note: Redis/KV is required for true cross-instance reliability.
 */
const globalRooms = (globalThis as any).rooms || {};
(globalThis as any).rooms = globalRooms;

const ROOMS: { [roomId: string]: Room } = globalRooms;

const NO_CACHE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { type, roomId, userId, targetId, data } = body;

        if (!roomId || !userId) {
            return NextResponse.json({ error: 'Missing roomId or userId' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        // Lazy Room Creation
        if (!ROOMS[roomId]) {
            console.log(`[VERCEL_DEBUG] LAZY_ROOM_CREATE: ${roomId}`);
            ROOMS[roomId] = {
                id: roomId,
                participants: [],
                messages: {},
                ttsModel: body.ttsModel
            };
        }

        const room = ROOMS[roomId];

        if (type === 'join') {
            if (body.ttsModel && !room.ttsModel) room.ttsModel = body.ttsModel;

            if (!room.participants.includes(userId)) {
                if (room.participants.length >= 2) {
                    return NextResponse.json({ error: 'Room full' }, { status: 400, headers: NO_CACHE_HEADERS });
                }
                room.participants.push(userId);
                room.messages[userId] = [];
            }

            return NextResponse.json({
                success: true,
                participants: room.participants,
                ttsModel: room.ttsModel
            }, { headers: NO_CACHE_HEADERS });
        }

        if (['offer', 'answer', 'ice-candidate'].includes(type) && targetId) {
            if (!room.messages[targetId]) room.messages[targetId] = [];
            console.log(`[VERCEL_DEBUG] SIGNAL: ${type} from ${userId} to ${targetId}`);
            room.messages[targetId].push({ type, senderId: userId, data });
            return NextResponse.json({ success: true }, { headers: NO_CACHE_HEADERS });
        }

        return NextResponse.json({ error: 'Unknown signal type' }, { status: 400, headers: NO_CACHE_HEADERS });
    } catch (e: any) {
        console.error('[VERCEL_DEBUG] POST_ERROR:', e.message);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500, headers: NO_CACHE_HEADERS });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const roomId = searchParams.get('roomId');
        const userId = searchParams.get('userId');

        if (!roomId || !userId) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        if (!ROOMS[roomId]) {
            return NextResponse.json({ messages: [], participants: [], ttsModel: null }, { headers: NO_CACHE_HEADERS });
        }

        const room = ROOMS[roomId];
        const myMessages = room.messages[userId] || [];

        if (myMessages.length > 0) {
            room.messages[userId] = []; // Clear inbox
        }

        return NextResponse.json({
            messages: myMessages,
            participants: room.participants,
            ttsModel: room.ttsModel
        }, { headers: NO_CACHE_HEADERS });
    } catch (e: any) {
        console.error('[VERCEL_DEBUG] GET_ERROR:', e.message);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500, headers: NO_CACHE_HEADERS });
    }
}
