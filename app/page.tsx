"use client";

import { VoiceProvider } from "@humeai/voice-react";
import CoreConversation from "@/components/CoreConversation";

export default function Home() {
  return (
    <VoiceProvider enableAudioWorklet={false}>
      <CoreConversation />
    </VoiceProvider>
  );
}

