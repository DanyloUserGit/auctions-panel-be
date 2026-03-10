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
      rtcpFeedback: [
        { type: 'nack' },
        { type: 'nack', parameter: 'pli' },
        { type: 'goog-remb' },
      ],
      parameters: 'x-google-start-bitrate=1000',
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
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();

      const timeout = setTimeout(resolve, 1500);

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Запускаємо FFmpeg ЛИШЕ ЯКЩО він ще не запущений для цієї сесії
    if (!this.ffmpegProcesses.has(sessionId)) {
      this.startVideoStreaming(sessionId, viewport);
    }

    if (!pc.localDescription) {
      this.logger.warn(`[WebrtcService] localDescription відсутній, повертаємо базовий answer`);
      return { type: answer.type, sdp: answer.sdp };
    }

    // ✅ Повертаємо localDescription, який вже містить зібрані IP
    // return {
    //   type: pc.localDescription.type,
    //   sdp: pc.localDescription.sdp,
    // };

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
      '-loglevel', 'debug',
      '-f', 'x11grab',
      '-s', `${viewport.width}x${viewport.height}`,
      '-i', `${display}.0+0,0`,
      // Обов'язково додаємо фільтр для парних пікселів (FFmpeg падає без цього на непарних екранах)
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libvpx',
      '-pix_fmt', 'yuv420p',
      '-threads', '4',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-b:v', '2M',
      '-g', '30', // Краще 30 (або як fps), а не 10
      '-keyint_min', '30',
      '-payload_type', '96',        // 🛑 ПОВЕРНУТО
      '-slice-max-size', '1200',    // 🛑 ПОВЕРНУТО (Життєво необхідно для WebRTC UDP)
      '-f', 'rtp',
      `rtp://127.0.0.1:${port}`,
    ]);

    // ffmpegCmd.stderr.on('data', (data) => {
    //   this.logger.debug(`[FFmpeg ${sessionId}]: ${data.toString()}`);
    // });

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
  async addIceCandidate(sessionId: string, clientId: string, candidate: any) {
    const pc = this.connections.get(sessionId)?.get(clientId);
    if (pc && candidate) {
      await pc.addIceCandidate(candidate).catch(e =>
        this.logger.error(`Помилка додавання кандидата для клієнта ${clientId}`, e)
      );
    }
  }
}