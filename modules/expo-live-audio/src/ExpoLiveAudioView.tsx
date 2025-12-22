import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoLiveAudioViewProps } from './ExpoLiveAudio.types';

const NativeView: React.ComponentType<ExpoLiveAudioViewProps> =
  requireNativeView('ExpoLiveAudio');

export default function ExpoLiveAudioView(props: ExpoLiveAudioViewProps) {
  return <NativeView {...props} />;
}
