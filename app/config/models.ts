export type TTSModelId = 'bulbul:v2' | 'bulbul:v3-beta';

export interface TTSModel {
    id: TTSModelId;
    name: string;
    subtitle: string;
    description: string;
    defaultPace: number;
}

export const TTS_MODELS: Record<TTSModelId, TTSModel> = {
    'bulbul:v2': {
        id: 'bulbul:v2',
        name: 'Bulbul v2',
        subtitle: 'Fast ⚡',
        description: 'Ultra-low latency, standard quality.',
        defaultPace: 1.15
    },
    'bulbul:v3-beta': {
        id: 'bulbul:v3-beta',
        name: 'Bulbul v3',
        subtitle: 'SOUNDS MORE HUMAN👨🏽🦱',
        description: 'Higher quality, natural prosody.',
        defaultPace: 1.1
    }
};

export const DEFAULT_MODEL_ID: TTSModelId = 'bulbul:v3-beta';
