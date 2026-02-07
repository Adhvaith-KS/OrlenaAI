import { NextResponse } from 'next/server';
import { Room, SignalMessage } from '@/app/types';

// In-memory store (Global to survive hot-reloads in dev to some extent, though unstable in serverless)
// For a hackathon/local demo, this is sufficient.
const globalRooms = (globalThis as any).rooms || {};
(globalThis as any).rooms = globalRooms;

const ROOMS: { [roomId: string]: Room } = globalRooms;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { type, roomId, userId, targetId, data } = body;

        console.log(`[Signal] POST ${type} from ${userId} in ${roomId}`);

        if (type === 'join') {
            if (!ROOMS[roomId]) {
                ROOMS[roomId] = { id: roomId, participants: [], messages: {}, ttsModel: body.ttsModel };
            }
            const room = ROOMS[roomId];

            // If creator didn't set it but it exists, keep it. 
            // If joiner comes in, they get whatever is already there.
            if (body.ttsModel && !room.ttsModel) {
                room.ttsModel = body.ttsModel;
            }

            if (!room.participants.includes(userId)) {
                if (room.participants.length >= 2) {
                    return NextResponse.json({ error: 'Room full' }, { status: 400 });
                }
                room.participants.push(userId);
                room.messages[userId] = []; // Inbox for this user
            }

            return NextResponse.json({
                success: true,
                participants: room.participants,
                ttsModel: room.ttsModel
            });
        }

        if (['offer', 'answer', 'ice-candidate'].includes(type) && targetId) {
            if (!ROOMS[roomId]) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

            const room = ROOMS[roomId];
            // Push to target's mailbox
            if (!room.messages[targetId]) {
                room.messages[targetId] = [];
            }

            room.messages[targetId].push({ type, senderId: userId, data });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
    }
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    const userId = searchParams.get('userId');

    if (!roomId || !userId) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const room = ROOMS[roomId];
    if (!room) {
        return NextResponse.json({ messages: [] });
    }

    const myMessages = room.messages[userId] || [];
    // Clear messages after reading (polling)
    room.messages[userId] = [];

    // Also return current participants so client knows when someone joins
    return NextResponse.json({
        messages: myMessages,
        participants: room.participants,
        ttsModel: room.ttsModel
    });
}
