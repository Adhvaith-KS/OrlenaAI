
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('audio');

        if (!file) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            console.error('SARVAM_API_KEY is missing');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Prepare FormData for Sarvam API
        const apiFormData = new FormData();
        apiFormData.append('file', file); // Sarvam expects 'file'
        apiFormData.append('model', 'saarika:v2.5'); // Valid models: saarika:v2.5, saaras:v3
        // apiFormData.append('language_code', 'en-IN'); // Optional, implicit detection usually works


        console.log('Sending request to Sarvam API...');

        const response = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            headers: {
                'api-subscription-key': apiKey,
                // Do NOT set 'Content-Type': 'multipart/form-data' manually with fetch + FormData, 
                // let the browser/node set it with boundary.
            },
            body: apiFormData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Sarvam API Error Response:', response.status, errorText);
            return NextResponse.json({
                error: `Sarvam API error: ${response.statusText}`,
                details: errorText
            }, { status: response.status });
        }

        const data = await response.json();
        console.log('Sarvam API Success:', data);

        // Sarvam usually returns { "transcript": "..." }
        return NextResponse.json(data);

    } catch (error) {
        console.error('STT API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
