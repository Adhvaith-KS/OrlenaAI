import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const NO_CACHE_HEADERS = { 'Cache-Control': 'no-store' };
    try {
        const { text, sourceLang, targetLang } = await req.json();

        if (!text || !sourceLang || !targetLang) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Config error' }, { status: 500, headers: NO_CACHE_HEADERS });
        }

        const response = await fetch('https://api.sarvam.ai/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': apiKey,
            },
            body: JSON.stringify({
                input: text,
                source_language_code: sourceLang,
                target_language_code: targetLang,
                model: 'sarvam-translate:v1'
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            return NextResponse.json({ error: 'API Error', details: err }, { status: response.status, headers: NO_CACHE_HEADERS });
        }

        const data = await response.json();
        return NextResponse.json({ translated_text: data.translated_text }, { headers: NO_CACHE_HEADERS });

    } catch (error: any) {
        console.error('[TRANSLATE] Error:', error.message);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500, headers: NO_CACHE_HEADERS });
    }
}
