// Provider IDs and capabilities are server-owned; clients cannot choose upstream URLs.
var providers = [
  { id: 'openai', name: 'OpenAI', icon: '/codex-avatar.png', url: 'https://platform.openai.com/api-keys' },
  { id: 'elevenlabs', name: 'ElevenLabs', icon: '/icons/speech/elevenlabs.svg', url: 'https://elevenlabs.io/app/settings/api-keys' },
  { id: 'soniox', name: 'Soniox', icon: '/icons/speech/soniox.png', url: 'https://console.soniox.com/' },
  { id: 'groq', name: 'Groq', icon: '/icons/speech/groq.svg', url: 'https://console.groq.com/keys' },
  { id: 'deepgram', name: 'Deepgram', icon: '/icons/speech/deepgram.svg', url: 'https://console.deepgram.com/' }
];
var models = [
  ['openai-live', 'openai', 'GPT Live Transcribe', 'live', 'gpt-live-transcribe', 'Low-latency transcription with text appearing as you speak.'],
  ['openai-transcribe', 'openai', 'GPT Transcribe', 'recorded', 'gpt-transcribe', 'Transcribes your recording after you stop.'],
  ['openai-whisper', 'openai', 'Whisper', 'recorded', 'whisper-1', 'General-purpose multilingual transcription.'],
  ['browser', 'browser', 'Browser speech', 'live', '', 'Uses your browser’s speech service. No API key required.'],
  ['elevenlabs-live', 'elevenlabs', 'Scribe v2 Realtime', 'live', 'scribe_v2_realtime', 'Live multilingual dictation with partial text as you speak.'],
  ['elevenlabs-file', 'elevenlabs', 'Scribe v2', 'recorded', 'scribe_v2', 'Multilingual transcription of completed recordings.'],
  ['soniox-live', 'soniox', 'Soniox Realtime', 'live', 'stt-rt-v5', 'Live transcription with automatic language recognition.'],
  ['soniox-file', 'soniox', 'Soniox Async', 'recorded', 'stt-async-v5', 'Asynchronous transcription of completed recordings.'],
  ['groq-whisper', 'groq', 'Whisper Large v3', 'recorded', 'whisper-large-v3', 'Multilingual Whisper transcription hosted by Groq.'],
  ['groq-turbo', 'groq', 'Whisper Turbo', 'recorded', 'whisper-large-v3-turbo', 'A faster Whisper variant hosted by Groq.'],
  ['deepgram-live', 'deepgram', 'Nova-3', 'live', 'nova-3', 'Live transcription in your selected language.'],
  ['deepgram-file', 'deepgram', 'Nova-3', 'recorded', 'nova-3', 'Recorded-audio transcription in your selected language.']
].map(function (row) { return { id: row[0], provider: row[1], name: row[2], mode: row[3], model: row[4], description: row[5] }; });
function findModel(id) { return models.find(function (model) { return model.id === id; }); }
function findProvider(id) { return providers.find(function (provider) { return provider.id === id; }); }
module.exports = { models: models, providers: providers, findModel: findModel, findProvider: findProvider };
