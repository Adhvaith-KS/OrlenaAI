import { NextRequest, NextResponse } from 'next/server';
import { getVoiceForGender, Gender } from '@/app/config/voices';
import { TTS_MODELS, TTSModelId } from '@/app/config/models';

export async function POST(req: NextRequest) {
    try {
        const { text, targetLang, gender, model } = await req.json();

        if (!text || !targetLang) {
            return NextResponse.json({ error: 'Missing text or targetLang' }, { status: 400 });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            console.error('SARVAM_API_KEY is missing');
            return NextResponse.json({ error: 'Server config error' }, { status: 500 });
        }

        const modelId: TTSModelId = model || 'bulbul:v3-beta';
        const modelConfig = TTS_MODELS[modelId] || TTS_MODELS['bulbul:v3-beta'];

        // Get voice based on gender (default to neutral if not provided)
        const voiceGender: Gender = gender || 'neutral';
        const speaker = getVoiceForGender(voiceGender, modelId);

        const isV3 = modelId.includes('v3');
        const payload: any = {
            target_language_code: targetLang,
            speaker: speaker,
            model: modelId,
            pace: modelConfig.defaultPace
        };

        if (isV3) {
            payload.text = text;
        } else {
            payload.inputs = [text];
        }

        console.log(`[TTS] Request Payload (${modelId}):`, JSON.stringify(payload));

        const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TTS] API Error:', response.status, errorText);
            return NextResponse.json({ error: `Sarvam TTS error: ${response.status}`, details: errorText }, { status: response.status });
        }

        const data = await response.json();
        console.log('[TTS] Full API Response:', JSON.stringify(data, null, 2));

        // Bulbul v3 returns 'audio_content', v2 returns 'audios' array
        const audioBase64 = data.audio_content || data.audios?.[0];

        if (!audioBase64) {
            console.error('[TTS] No audio field found in response.');
            console.error('[TTS] Response keys:', Object.keys(data));
            console.error('[TTS] Full response:', JSON.stringify(data));
            return NextResponse.json({
                error: 'No audio returned',
                responseKeys: Object.keys(data),
                fullResponse: data
            }, { status: 500 });
        }

        console.log('[TTS] Success (Bulbul v3), audio length:', audioBase64.length);
        return NextResponse.json({ audio: audioBase64 });

    } catch (error) {
        console.error('[TTS] Internal Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
