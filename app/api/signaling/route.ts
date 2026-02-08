import { NextRequest, NextResponse } from 'next/server';
import { Room } from '../../types';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
};

// --- In-Memory Fallback ---
const globalRooms = (globalThis as any).rooms || {};
(globalThis as any).rooms = globalRooms;
const MEMORY_ROOMS: { [roomId: string]: Room } = globalRooms;

// --- Vercel KV Persistence (Best for Production) ---
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvRequest(command: string, ...args: any[]) {
    if (!KV_URL || !KV_TOKEN) return null;
    try {
        const res = await fetch(`${KV_URL}/${command}/${args.join('/')}`, {
            headers: { Authorization: `Bearer ${KV_TOKEN}` },
            cache: 'no-store'
        });
        return (await res.json()).result;
    } catch (e) {
        console.error('[KV_ERROR]', e);
        return null;
    }
}

async function getRoom(roomId: string): Promise<Room | null> {
    if (KV_URL && KV_TOKEN) {
        const data = await kvRequest('get', `room:${roomId}`);
        return data ? JSON.parse(data) : null;
    }
    return MEMORY_ROOMS[roomId] || null;
}

async function saveRoom(roomId: string, room: Room) {
    if (KV_URL && KV_TOKEN) {
        await kvRequest('set', `room:${roomId}`, JSON.stringify(room), 'EX', '3600'); // 1h expiry
    } else {
        MEMORY_ROOMS[roomId] = room;
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { type, roomId, userId, targetId, data } = body;

        if (!roomId || !userId) {
            return NextResponse.json({ error: 'Missing roomId or userId' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        let room = await getRoom(roomId);

        if (!room) {
            console.log(`[VERCEL_DEBUG] INIT_ROOM: ${roomId}`);
            room = {
                id: roomId,
                participants: [],
                messages: {},
                ttsModel: body.ttsModel
            };
        }

        if (type === 'join') {
            if (body.ttsModel && !room.ttsModel) room.ttsModel = body.ttsModel;

            if (!room.participants.includes(userId)) {
                if (room.participants.length >= 2) {
                    return NextResponse.json({ error: 'Room full' }, { status: 400, headers: NO_CACHE_HEADERS });
                }
                room.participants.push(userId);
                room.messages[userId] = [];
            }
            await saveRoom(roomId, room);
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
            await saveRoom(roomId, room);
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

        const room = await getRoom(roomId);
        if (!room) {
            return NextResponse.json({ messages: [], participants: [], ttsModel: null }, { headers: NO_CACHE_HEADERS });
        }

        const myMessages = room.messages[userId] || [];

        if (myMessages.length > 0) {
            room.messages[userId] = []; // Clear inbox
            await saveRoom(roomId, room);
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
