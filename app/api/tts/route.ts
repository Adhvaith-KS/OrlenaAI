import { NextRequest, NextResponse } from 'next/server';
import { getVoiceForGender, Gender } from '../../config/voices';
import { TTS_MODELS, TTSModelId } from '../../config/models';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const NO_CACHE_HEADERS = { 'Cache-Control': 'no-store' };
    try {
        const { text, targetLang, gender, model } = await req.json();

        if (!text || !targetLang) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_CACHE_HEADERS });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Config error' }, { status: 500, headers: NO_CACHE_HEADERS });
        }

        const modelId: TTSModelId = model || 'bulbul:v3-beta';
        const modelConfig = TTS_MODELS[modelId] || TTS_MODELS['bulbul:v3-beta'];
        const speaker = getVoiceForGender(gender || 'neutral', modelId);

        const isV3 = modelId.includes('v3');
        const payload: any = {
            target_language_code: targetLang,
            speaker: speaker,
            model: modelId,
            pace: modelConfig.defaultPace
        };

        if (isV3) payload.text = text;
        else payload.inputs = [text];

        const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const err = await response.text();
            return NextResponse.json({ error: 'TTS Error', details: err }, { status: response.status, headers: NO_CACHE_HEADERS });
        }

        const data = await response.json();
        const audio = data.audio_content || data.audios?.[0];

        if (!audio) return NextResponse.json({ error: 'No audio' }, { status: 500, headers: NO_CACHE_HEADERS });

        return NextResponse.json({ audio }, { headers: NO_CACHE_HEADERS });

    } catch (error: any) {
        console.error('[TTS] Error:', error.message);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500, headers: NO_CACHE_HEADERS });
    }
}
