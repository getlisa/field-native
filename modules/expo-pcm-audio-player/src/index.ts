// Reexport the native module. On web, it will be resolved to ExpoPcmAudioPlayerModule.web.ts
// and on native platforms to ExpoPcmAudioPlayerModule.ts
export { default } from './ExpoPcmAudioPlayerModule';
export * from  './ExpoPcmAudioPlayer.types';
