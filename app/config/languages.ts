export const SUPPORTED_LANGUAGES = [
    { code: 'hi-IN', label: 'Hindi (हिंदी) 🇮🇳' },
    { code: 'en-IN', label: 'English (India) 🇮🇳' },
    { code: 'bn-IN', label: 'Bengali (বাংলা) 🇮🇳' },
    { code: 'gu-IN', label: 'Gujarati (ગુજરાતી) 🇮🇳' },
    { code: 'kn-IN', label: 'Kannada (ಕನ್ನಡ) 🇮🇳' },
    { code: 'ml-IN', label: 'Malayalam (മലയാളം) 🇮🇳' },
    { code: 'mr-IN', label: 'Marathi (मराठी) 🇮🇳' },
    { code: 'od-IN', label: 'Odia (ଓଡ଼ିଆ) 🇮🇳' },
    { code: 'pa-IN', label: 'Punjabi (ਪੰਜਾਬੀ) 🇮🇳' },
    { code: 'ta-IN', label: 'Tamil (தமிழ்) 🇮🇳' },
    { code: 'te-IN', label: 'Telugu (తెలుగు) 🇮🇳' }
];

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];
