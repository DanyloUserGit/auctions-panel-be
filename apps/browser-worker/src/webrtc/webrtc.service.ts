import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import * as dgram from 'dgram';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from 'werift';
import { BrowserService } from '../browser-worker.service';

@Injectable()
export class WebrtcService {
  private readonly logger = new Logger(WebrtcService.name);

  private connections = new Map<string, Map<string, RTCPeerConnection>>();
  private videoTracks = new Map<string, Map<string, MediaStreamTrack>>();
  private ffmpegDrainState = new Map<string, boolean>();

  // Ключі тепер: `${sessionId}_${clientId}` для абсолютної ізоляції
  private ffmpegProcesses = new Map<string, ChildProcess>();
  private udpSockets = new Map<string, dgram.Socket>();

  constructor(private browserService: BrowserService) { }

  async handleOffer(
    userId: string,
    sessionId: string,
    clientId: string,
    offer: any,
    viewport: { width: number; height: number },
    onIceCandidate: (candidate: any) => void
  ): Promise<any> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      icePortRange: [10000, 10050],
    });

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
          // ОНОВЛЕНО: Передаємо clientId, щоб клікати по його власній вкладці
          this.browserService.interact(sessionId, clientId, userId, action);
        } catch (e) { }
      });
    });

    const codec = new RTCRtpCodecParameters({
      mimeType: 'video/VP8',
      clockRate: 90000,
      payloadType: 96,
      parameters: 'x-google-start-bitrate=2500',
    });

    const videoTrack = new MediaStreamTrack({ kind: 'video', codec });
    this.videoTracks.get(sessionId)!.set(clientId, videoTrack);

    pc.addTransceiver(videoTrack, { direction: 'sendonly' });

    pc.onIceCandidate.subscribe((candidate) => {
      // 1. werift може відправити null, коли збір кандидатів закінчено
      if (!candidate) return;

      // 2. Правильно перетворюємо екземпляр класу в звичайний JSON-об'єкт
      const candidateObj = candidate.toJSON ? candidate.toJSON() : JSON.parse(JSON.stringify(candidate));

      // (Опціонально) Можеш просто логувати оригінального кандидата, щоб бачити, що генерує werift
      if (candidateObj.candidate) {
        this.logger.debug(`[WebRTC] Згенеровано кандидата: ${candidateObj.candidate}`);
      }

      // 3. Відправляємо оригінальний об'єкт без змін IP
      onIceCandidate(candidateObj);
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

    const clientKey = `${sessionId}_${clientId}`;

    if (this.ffmpegProcesses.has(clientKey)) {
      this.logger.debug(`[WebRTC] Очищення старого процесу для ${clientKey}`);
      await this.closeClientConnection(sessionId, clientId).catch(() => { });
    }

    // 1. Запускаємо FFmpeg для цього конкретного клієнта
    if (!this.ffmpegProcesses.has(clientKey)) {
      this.startVideoStreaming(sessionId, clientId, viewport);
    }

    // 2. 🛑 ВИПРАВЛЕННЯ: Запускаємо Playwright АСИНХРОННО (без await!)
    // Це дозволить миттєво повернути Answer клієнту, поки сторінка вантажиться
    this.browserService.addClientPage(userId, sessionId, clientId, (frameBuffer) => {
      const ffmpegProcess = this.ffmpegProcesses.get(clientKey);
      if (ffmpegProcess && ffmpegProcess.stdin && ffmpegProcess.stdin.writable) {
        try {
          // ПЕРЕВІРЯЄМО BACKPRESSURE
          if (this.ffmpegDrainState.get(clientKey) !== false) {
            // Записуємо кадр. Якщо write повертає false - буфер переповнений!
            const canAcceptMore = ffmpegProcess.stdin.write(frameBuffer);
            if (!canAcceptMore) {
              // FFmpeg не встигає! Зупиняємо відправку нових кадрів до події 'drain'
              this.ffmpegDrainState.set(clientKey, false);
            }
          } else {
            // ПРОПУСКАЄМО КАДР (Drop frame)! 
            // Це критично важливо. Краще відео трохи "смикнеться", ніж сервер зависне.
          }
        } catch (e) {
          this.logger.debug(`Помилка запису кадру у FFmpeg`);
        }
      }
    }).catch(e => this.logger.error(`Помилка створення вкладки для ${clientId}:`, e));

    // 3. Миттєво повертаємо Answer, щоб WebRTC успішно з'єднався!
    return answer;

  }

  private startVideoStreaming(sessionId: string, clientId: string, viewport: { width: number; height: number }) {
    const port = Math.floor(Math.random() * (60000 - 50000) + 50000);
    const udpSocket = dgram.createSocket('udp4');
    udpSocket.bind(port, () => {
      udpSocket.setRecvBufferSize(4 * 1024 * 1024);
    });

    const clientKey = `${sessionId}_${clientId}`;

    udpSocket.on('message', (buffer) => {
      const track = this.videoTracks.get(sessionId)?.get(clientId);
      if (track) {
        try { track.writeRtp(buffer); } catch (e) { }
      }
    });

    this.udpSockets.set(clientKey, udpSocket);

    const ffmpegCmd = spawn('ffmpeg', [
      '-loglevel', 'error',     // Залишаємо error, щоб не спамити
      '-f', 'image2pipe',
      '-framerate', '24',       // Вказуємо, що на вхід йде 30 FPS
      '-vcodec', 'mjpeg',
      '-i', '-',
      // ПОВЕРТАЄМО ФІЛЬТР ДЛЯ ПАРНИХ ПІКСЕЛІВ (ЖИТТЄВО ВАЖЛИВО ДЛЯ VP8)
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libvpx',
      '-b:v', '2.5M',
      '-threads', '2',
      '-deadline', 'realtime',
      '-cpu-used', '5',
      '-lag-in-frames', '0',
      '-g', '24',
      '-keyint_min', '24',
      '-payload_type', '96',
      '-slice-max-size', '1200',
      '-f', 'rtp',
      `rtp://127.0.0.1:${port}`,
    ]);

    // ДОДАЄМО ЛОГУВАННЯ ПОМИЛОК FFMPEG!
    ffmpegCmd.stderr.on('data', (data) => {
      console.error(`[FFMPEG ERROR - ${clientId}]:`, data.toString());
    });

    this.ffmpegProcesses.set(clientKey, ffmpegCmd);
    this.ffmpegDrainState.set(clientKey, true);

    // Коли FFmpeg звільняє буфер, він каже Node.js "я знову готовий"
    ffmpegCmd.stdin.on('drain', () => {
      this.ffmpegDrainState.set(clientKey, true);
    });
  }

  // Закриття підключення одного клієнта
  async closeClientConnection(sessionId: string, clientId: string) {
    this.logger.log(`Відключення клієнта ${clientId} від сесії ${sessionId}`);
    const clientKey = `${sessionId}_${clientId}`;

    const pc = this.connections.get(sessionId)?.get(clientId);
    if (pc) {
      await pc.close().catch(() => { });
      this.connections.get(sessionId)?.delete(clientId);
      this.videoTracks.get(sessionId)?.delete(clientId);
    }

    const ffmpegProcess = this.ffmpegProcesses.get(clientKey);
    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGKILL');
      this.ffmpegProcesses.delete(clientKey);
    }

    const udpSocket = this.udpSockets.get(clientKey);
    if (udpSocket) {
      udpSocket.close();
      this.udpSockets.delete(clientKey);
    }

    await this.browserService.removePageForClient(sessionId, clientId).catch(() => { });
    this.ffmpegDrainState.delete(clientKey);
  }

  async closeConnection(sessionId: string) {
    for (const [key, process] of this.ffmpegProcesses.entries()) {
      if (key.startsWith(`${sessionId}_`)) {
        process.kill('SIGKILL');
        this.ffmpegProcesses.delete(key);
      }
    }
    for (const [key, socket] of this.udpSockets.entries()) {
      if (key.startsWith(`${sessionId}_`)) {
        socket.close();
        this.udpSockets.delete(key);
      }
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
      await pc.addIceCandidate(candidate).catch(() => { });
    }
  }
}