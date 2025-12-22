// Reexport the native module. On web, it will be resolved to ExpoLiveAudioModule.web.ts
// and on native platforms to ExpoLiveAudioModule.ts
export { default } from './ExpoLiveAudioModule';
export * from './ExpoLiveAudio.types';
