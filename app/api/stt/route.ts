import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const NO_CACHE_HEADERS = { 'Cache-Control': 'no-store' };
    try {
        const formData = await req.formData();
        const file = formData.get('audio');

        if (!file) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            console.error('[STT] Missing API Key');
            return NextResponse.json({ error: 'Config error' }, { status: 500, headers: NO_CACHE_HEADERS });
        }

        const apiFormData = new FormData();
        apiFormData.append('file', file);
        apiFormData.append('model', 'saarika:v2.5');

        const response = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            headers: { 'api-subscription-key': apiKey },
            body: apiFormData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json({ error: 'Sarvam API error', details: errorText }, { status: response.status, headers: NO_CACHE_HEADERS });
        }

        const data = await response.json();
        return NextResponse.json(data, { headers: NO_CACHE_HEADERS });

    } catch (error: any) {
        console.error('[STT] Handler Error:', error.message);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500, headers: NO_CACHE_HEADERS });
    }
}
