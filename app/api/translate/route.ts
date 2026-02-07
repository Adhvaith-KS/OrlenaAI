import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const { text, sourceLang, targetLang } = await req.json();

        if (!text || !sourceLang || !targetLang) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            console.error('SARVAM_API_KEY is missing');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const payload = {
            input: text,
            source_language_code: sourceLang,
            target_language_code: targetLang,
            model: 'sarvam-translate:v1' // Switch to flagship model
        };

        console.log('[TRANSLATE] Request Payload:', JSON.stringify(payload));

        const response = await fetch('https://api.sarvam.ai/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TRANSLATE] API Error:', response.status, errorText);
            return NextResponse.json({ error: `Sarvam API error: ${response.status}`, details: errorText }, { status: response.status });
        }

        const data = await response.json();
        console.log('[TRANSLATE] Success Response:', JSON.stringify(data));

        return NextResponse.json({ translated_text: data.translated_text });

    } catch (error) {
        console.error('[TRANSLATE] Handler Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
