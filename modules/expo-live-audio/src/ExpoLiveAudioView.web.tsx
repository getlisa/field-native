import * as React from 'react';

import { ExpoLiveAudioViewProps } from './ExpoLiveAudio.types';

export default function ExpoLiveAudioView(props: ExpoLiveAudioViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
