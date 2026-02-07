// Voice configuration for Sarvam Bulbul v3 TTS
// Based on official Sarvam AI documentation

export type Gender = 'male' | 'female' | 'neutral';

export interface VoiceOption {
    id: string;
    name: string;
    description: string;
}

// Bulbul v3 Voice Options
export const V3_VOICE_CONFIG: Record<Gender, VoiceOption> = {
    male: {
        id: 'aditya',
        name: 'Aditya',
        description: 'Male, Deep, Authoritative'
    },
    female: {
        id: 'priya',
        name: 'Priya',
        description: 'Female, Friendly, Conversational'
    },
    neutral: {
        id: 'aditya',
        name: 'Aditya',
        description: 'Default voice'
    }
};

// Bulbul v2 Voice Options
export const V2_VOICE_CONFIG: Record<Gender, VoiceOption> = {
    male: {
        id: 'abhilash',
        name: 'Abhilash',
        description: 'Male Voice'
    },
    female: {
        id: 'anushka',
        name: 'Anushka',
        description: 'Female Voice'
    },
    neutral: {
        id: 'anushka',
        name: 'Anushka',
        description: 'Default voice'
    }
};

// Get voice ID for gender and model
export function getVoiceForGender(gender: Gender, modelId: string = 'bulbul:v3-beta'): string {
    const config = modelId.includes('v3') ? V3_VOICE_CONFIG : V2_VOICE_CONFIG;
    return config[gender]?.id || config.neutral.id;
}
