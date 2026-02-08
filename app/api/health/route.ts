import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        env: {
            hasApiKey: !!process.env.SARVAM_API_KEY,
            nodeEnv: process.env.NODE_ENV
        }
    });
}
