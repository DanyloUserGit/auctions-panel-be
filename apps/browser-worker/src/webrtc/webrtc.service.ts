import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import * as dgram from 'dgram';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from 'werift';
import { BrowserService } from '../browser-worker.service';

@Injectable()
export class WebrtcService {
  private readonly logger = new Logger(WebrtcService.name);

  // Тепер ми зберігаємо підключення та треки для КОЖНОГО КЛІЄНТА окремо
  // Map<sessionId, Map<clientId, RTCPeerConnection>>
  private connections = new Map<string, Map<string, RTCPeerConnection>>();
  private videoTracks = new Map<string, Map<string, MediaStreamTrack>>();

  private ffmpegProcesses = new Map<string, ChildProcess>();
  private udpSockets = new Map<string, dgram.Socket>();

  constructor(private browserService: BrowserService) { }

  async handleOffer(
    sessionId: string,
    clientId: string, // ДОДАНО ІДЕНТИФІКАТОР КЛІЄНТА
    offer: any,
    viewport: { width: number; height: number },
    onIceCandidate: (candidate: any) => void
  ): Promise<any> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      icePortRange: [10000, 10050],
    });

    // Ініціалізуємо Map для сесії, якщо його ще немає
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Map());
      this.videoTracks.set(sessionId, new Map());
    }

    this.connections.get(sessionId)!.set(clientId, pc);

    // Слухаємо DataChannel для мишки/клавіатури
    pc.onDataChannel.subscribe((channel) => {
      channel.onMessage.subscribe((data) => {
        try {
          const action = JSON.parse(data.toString());
          if (action.x !== undefined && action.y !== undefined) {
            action.x = Math.round(action.x * viewport.width);
            action.y = Math.round(action.y * viewport.height);
          }
          this.browserService.interact(sessionId, action);
        } catch (e) { }
      });
    });

    const codec = new RTCRtpCodecParameters({
      mimeType: 'video/VP8',
      clockRate: 90000,
      payloadType: 96,
    });

    const videoTrack = new MediaStreamTrack({ kind: 'video', codec });
    this.videoTracks.get(sessionId)!.set(clientId, videoTrack);

    const transceiver = pc.addTransceiver(videoTrack, { direction: 'sendonly' });

    transceiver.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe(() => { });
    });

    pc.onIceCandidate.subscribe((candidate) => {
      if (candidate) onIceCandidate(candidate);
    });

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Запускаємо FFmpeg ЛИШЕ ЯКЩО він ще не запущений для цієї сесії
    if (!this.ffmpegProcesses.has(sessionId)) {
      this.startVideoStreaming(sessionId, viewport);
    }

    return answer;
  }

  private startVideoStreaming(sessionId: string, viewport: { width: number; height: number }) {
    const port = Math.floor(Math.random() * (60000 - 50000) + 50000);
    const udpSocket = dgram.createSocket('udp4');
    udpSocket.bind(port);

    // Роздаємо отриманий кадр ВСІМ клієнтам у цій сесії
    udpSocket.on('message', (buffer) => {
      const tracks = this.videoTracks.get(sessionId);
      if (tracks) {
        tracks.forEach((track) => {
          try {
            track.writeRtp(buffer);
          } catch (e) { }
        });
      }
    });

    this.udpSockets.set(sessionId, udpSocket);
    const display = process.env.DISPLAY || ':99';

    const ffmpegCmd = spawn('ffmpeg', [
      '-f', 'x11grab',
      '-draw_mouse', '0',
      '-video_size', `${viewport.width || 1280}x${viewport.height || 720}`,
      '-framerate', '30',
      '-i', `${display}.0+0,0`,
      '-c:v', 'libvpx',
      '-b:v', '1.5M',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-payload_type', '96',
      '-f', 'rtp',
      `rtp://127.0.0.1:${port}`,
    ]);

    this.ffmpegProcesses.set(sessionId, ffmpegCmd);
  }

  // ДОДАНО: Закриття з'єднання для ОДНОГО клієнта
  async closeClientConnection(sessionId: string, clientId: string) {
    this.logger.log(`Відключення клієнта ${clientId} від сесії ${sessionId}`);
    const pc = this.connections.get(sessionId)?.get(clientId);
    if (pc) {
      await pc.close().catch(() => { });
      this.connections.get(sessionId)?.delete(clientId);
      this.videoTracks.get(sessionId)?.delete(clientId);
    }
  }

  // Повне закриття сесії (викликається, коли activeConnections = 0)
  async closeConnection(sessionId: string) {
    const ffmpegProcess = this.ffmpegProcesses.get(sessionId);
    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGKILL');
      this.ffmpegProcesses.delete(sessionId);
    }

    const udpSocket = this.udpSockets.get(sessionId);
    if (udpSocket) {
      udpSocket.close();
      this.udpSockets.delete(sessionId);
    }

    const clients = this.connections.get(sessionId);
    if (clients) {
      for (const [clientId, pc] of clients.entries()) {
        await pc.close().catch(() => { });
      }
      this.connections.delete(sessionId);
      this.videoTracks.delete(sessionId);
    }
  }
}