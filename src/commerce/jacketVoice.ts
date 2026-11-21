/// <reference types="vite/client" />
import workletUrl from './microphone.worklet.js?url';
import { jacketVoiceSetup } from '../shared/jacketVoiceSetup';

type ToolCall = { id: string; name: string; args?: Record<string, unknown> };
type LiveMessage = {
  setupComplete?: object;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    outputTranscription?: { text: string };
    modelTurn?: { parts: { inlineData?: { data: string; mimeType: string } }[] };
  };
  toolCall?: { functionCalls: ToolCall[] };
};

export class JacketVoice {
  private socket?: WebSocket;
  private audio?: AudioContext;
  private microphone?: MediaStream;
  private playback = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private controller?: AbortController;
  private timeout?: number;

  constructor(
    private onStatus: (status: string, active: boolean) => void,
    private onCaption: (text: string, complete: boolean) => void,
    private onTool: (call: ToolCall) => Promise<object>,
  ) {}

  async start(intro: Promise<string>): Promise<void> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.onStatus('Starting Gemini voice…', true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS or localhost.');
      const audio = new AudioContext({ sampleRate: 16000 });
      this.audio = audio;
      void audio.resume().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (controller.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.microphone = stream;
      const response = await fetch('/api/jacket/voice', { method: 'POST', signal: controller.signal });
      const { token, model, error } = await response.json();
      if (!response.ok) throw new Error(error || 'Gemini voice is unavailable.');
      await audio.audioWorklet.addModule(workletUrl);
      if (controller.signal.aborted) return;
      const socket = new WebSocket(
        'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=' +
        encodeURIComponent(token)
      );
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      const send = (message: object) => {
        if (socket.readyState === WebSocket.OPEN && !controller.signal.aborted) {
          socket.send(JSON.stringify(message));
        }
      };
      const fail = (message: string) => {
        if (controller.signal.aborted) return;
        this.stop();
        this.onStatus(message, false);
      };
      this.timeout = window.setTimeout(() => fail('Gemini voice timed out. Try again.'), 15_000);
      socket.onopen = () => send({ setup: jacketVoiceSetup(model) });
      socket.onclose = () => fail('Gemini voice disconnected. You can restart it or shop below.');
      socket.onerror = () => fail('Gemini voice could not connect. You can still shop below.');
      socket.onmessage = async (event) => {
        if (controller.signal.aborted) return;
        try {
          const message: LiveMessage = JSON.parse(typeof event.data === 'string'
            ? event.data : new TextDecoder().decode(event.data));
          if (message.setupComplete) {
            window.clearTimeout(this.timeout);
            const source = audio.createMediaStreamSource(stream);
            const capture = new AudioWorkletNode(audio, 'jacket-microphone');
            const muted = audio.createGain();
            muted.gain.value = 0;
            source.connect(capture).connect(muted).connect(audio.destination);
            capture.port.onmessage = (chunk: MessageEvent<ArrayBuffer>) => {
              if (socket.bufferedAmount > 256_000) return;
              const data = btoa(String.fromCharCode(...new Uint8Array(chunk.data)));
              send({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } });
            };
            this.onStatus('Microphone on · Gemini is listening', true);
            send({ clientContent: { turns: [{ role: 'user', parts: [{ text: await intro }] }], turnComplete: true } });
          }
          const content = message.serverContent;
          if (content?.interrupted) this.clearPlayback();
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
              this.play(audio, part.inlineData.data, part.inlineData.mimeType);
            }
          }
          if (content?.outputTranscription || content?.turnComplete || content?.interrupted) {
            this.onCaption(content.outputTranscription?.text ?? '', !!(content.turnComplete || content.interrupted));
          }
          if (message.toolCall) {
            const functionResponses = [];
            for (const call of message.toolCall.functionCalls) {
              if (controller.signal.aborted) return;
              const response = await this.onTool(call).catch(() => ({ error: 'The shopping request failed.' }));
              functionResponses.push({ id: call.id, name: call.name, response });
            }
            send({ toolResponse: { functionResponses } });
          }
        } catch {
          fail('Gemini voice stopped unexpectedly. You can still shop below.');
        }
      };
    } catch (error) {
      if (controller.signal.aborted) return;
      this.stop();
      this.onStatus(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Allow it to use voice.'
        : error instanceof Error ? error.message : 'Gemini voice is unavailable.', false);
    }
  }

  private play(audio: AudioContext, data: string, mime: string) {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const samples = new DataView(bytes.buffer);
    const buffer = audio.createBuffer(1, Math.floor(bytes.length / 2), Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000));
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = samples.getInt16(i * 2, true) / 32768;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.onended = () => this.playback.delete(source);
    this.playback.add(source);
    const start = Math.max(audio.currentTime, this.nextAudio);
    source.start(start);
    this.nextAudio = start + buffer.duration;
  }

  private clearPlayback() {
    for (const source of this.playback) source.stop();
    this.playback.clear();
    this.nextAudio = 0;
  }

  stop() {
    this.controller?.abort();
    this.controller = undefined;
    window.clearTimeout(this.timeout);
    this.socket?.close();
    this.socket = undefined;
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = undefined;
    this.clearPlayback();
    if (this.audio) void this.audio.close().catch(() => {});
    this.audio = undefined;
  }
}
