import * as React from 'react';

import { ExpoLiveAudioViewProps } from './ExpoLiveAudio.types';

export default function ExpoLiveAudioView(props: ExpoLiveAudioViewProps) {
  const handleLoad = () => {
    if (props.onLoad && props.url) {
      props.onLoad({ nativeEvent: { url: props.url } });
    }
  };

  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url || ''}
        onLoad={handleLoad}
      />
    </div>
  );
}
