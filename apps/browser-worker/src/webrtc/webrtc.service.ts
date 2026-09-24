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
          this.browserService.interact(sessionId, clientId, userId, action).catch((e) => {
            this.logger.debug(`[WebRTC] Помилка обробки дії від клієнта ${clientId}: ${e}`);
          });
        } catch (e) {
          this.logger.debug(`[WebRTC] Некоректне повідомлення від клієнта ${clientId}: ${e}`);
        }
      });
      channel.onerror = (err: any) => {
        this.logger.debug(`[WebRTC] Помилка DataChannel для ${clientId}: ${err}`);
      };
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
      try {
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
      } catch (e) {
        this.logger.debug(`[WebRTC] Помилка обробки ICE-кандидата для ${clientId}: ${e}`);
      }
    });

    let answer: any;
    try {
      await pc.setRemoteDescription(offer);
      answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timeout = setTimeout(resolve, 1500);
        try {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              resolve();
            }
          };
        } catch (e) {
          clearTimeout(timeout);
          resolve();
        }
      });
    } catch (e) {
      this.logger.error(`[WebRTC] Помилка узгодження SDP для ${sessionId}/${clientId}:`, e);
      // Прибираємо часткові дані, щоб не лишити "сирітське" з'єднання в мапах
      this.connections.get(sessionId)?.delete(clientId);
      this.videoTracks.get(sessionId)?.delete(clientId);
      await pc.close().catch(() => { });
      throw e;
    }

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
    const clientKey = `${sessionId}_${clientId}`;
    const udpSocket = dgram.createSocket('udp4');

    udpSocket.on('message', (buffer) => {
      const track = this.videoTracks.get(sessionId)?.get(clientId);
      if (track) {
        try { track.writeRtp(buffer); } catch (e) { }
      }
    }).on("error", (err) => {
      this.logger.error(`[UDP ${clientKey}] Помилка сокета:`, err);
    });

    try {
      udpSocket.bind(port, () => {
        try {
          udpSocket.setRecvBufferSize(4 * 1024 * 1024);
        } catch (e) {
          this.logger.debug(`[UDP ${clientKey}] Не вдалось встановити розмір буфера: ${e}`);
        }
      });
    } catch (e) {
      this.logger.error(`[UDP ${clientKey}] Не вдалось прив'язати сокет до порту ${port}:`, e);
    }

    this.udpSockets.set(clientKey, udpSocket);

    let ffmpegCmd: ChildProcess;
    try {
      ffmpegCmd = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-f', 'image2pipe',
      '-framerate', '24',
      '-vcodec', 'mjpeg',
      '-i', '-',
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
    } catch (e) {
      this.logger.error(`[FFMPEG ${clientId}] Не вдалось запустити процес (spawn):`, e);
      try { udpSocket.close(); } catch (closeErr) { /* socket may already be closed */ }
      this.udpSockets.delete(clientKey);
      return;
    }

    // Помилка самого процесу (напр. бінарник ffmpeg не знайдено) приходить сюди,
    // а НЕ в 'error' на stdin - тому обробляємо окремо.
    ffmpegCmd.on('error', (err) => {
      this.logger.error(`[FFMPEG ${clientId}] Помилка процесу:`, err);
    });

    ffmpegCmd.stderr?.on('data', (data) => {
      console.error(`[FFMPEG ERROR - ${clientId}]:`, data.toString());
    });
    ffmpegCmd.stderr?.on('error', (err) => {
      this.logger.debug(`[FFMPEG ${clientId}] Помилка потоку stderr: ${err}`);
    });

    this.ffmpegProcesses.set(clientKey, ffmpegCmd);
    this.ffmpegDrainState.set(clientKey, true);

    // Коли FFmpeg звільняє буфер, він каже Node.js "я знову готовий"
    ffmpegCmd.stdin?.on('drain', () => {
      this.ffmpegDrainState.set(clientKey, true);
    }).on("error", (err) => {
      // EPIPE / ECONNRESET тощо, коли процес вже завершився, а ми ще пишемо
      this.logger.debug(`[FFMPEG ${clientId}] Помилка запису в stdin: ${err}`);
    });

    ffmpegCmd.on("exit", (code, signal) => {
      this.logger.warn(`[FFMPEG ${clientId}] Завершився: code=${code} signal=${signal}`);
      this.ffmpegDrainState.set(clientKey, false);
    });
  }

  // Закриття підключення одного клієнта
  async closeClientConnection(sessionId: string, clientId: string) {
    this.logger.log(`Відключення клієнта ${clientId} від сесії ${sessionId}`);
    const clientKey = `${sessionId}_${clientId}`;

    try {
      const pc = this.connections.get(sessionId)?.get(clientId);
      if (pc) {
        await pc.close().catch(() => { });
      }
    } catch (e) {
      this.logger.debug(`[WebRTC] Помилка закриття peer connection ${clientKey}: ${e}`);
    } finally {
      this.connections.get(sessionId)?.delete(clientId);
      this.videoTracks.get(sessionId)?.delete(clientId);
    }

    try {
      const ffmpegProcess = this.ffmpegProcesses.get(clientKey);
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
      }
    } catch (e) {
      this.logger.debug(`[WebRTC] Помилка завершення ffmpeg для ${clientKey}: ${e}`);
    } finally {
      this.ffmpegProcesses.delete(clientKey);
    }

    try {
      const udpSocket = this.udpSockets.get(clientKey);
      if (udpSocket) {
        udpSocket.close();
      }
    } catch (e) {
      this.logger.debug(`[WebRTC] Помилка закриття UDP-сокета для ${clientKey}: ${e}`);
    } finally {
      this.udpSockets.delete(clientKey);
    }

    await this.browserService.removePageForClient(sessionId, clientId).catch((e) => {
      this.logger.debug(`[WebRTC] Помилка видалення сторінки для ${clientKey}: ${e}`);
    });
    this.ffmpegDrainState.delete(clientKey);
  }

  async closeConnection(sessionId: string) {
    for (const [key, process] of this.ffmpegProcesses.entries()) {
      if (key.startsWith(`${sessionId}_`)) {
        try {
          process.kill('SIGKILL');
        } catch (e) {
          this.logger.debug(`[WebRTC] Помилка завершення ffmpeg (${key}): ${e}`);
        } finally {
          this.ffmpegProcesses.delete(key);
        }
      }
    }
    for (const [key, socket] of this.udpSockets.entries()) {
      if (key.startsWith(`${sessionId}_`)) {
        try {
          socket.close();
        } catch (e) {
          this.logger.debug(`[WebRTC] Помилка закриття UDP-сокета (${key}): ${e}`);
        } finally {
          this.udpSockets.delete(key);
        }
      }
    }
    const clients = this.connections.get(sessionId);
    if (clients) {
      for (const [clientId, pc] of clients.entries()) {
        try {
          await pc.close().catch(() => { });
        } catch (e) {
          this.logger.debug(`[WebRTC] Помилка закриття peer connection (${sessionId}/${clientId}): ${e}`);
        }
      }
      this.connections.delete(sessionId);
      this.videoTracks.delete(sessionId);
    }
  }

  async addIceCandidate(sessionId: string, clientId: string, candidate: any) {
    try {
      const pc = this.connections.get(sessionId)?.get(clientId);
      if (pc && candidate) {
        await pc.addIceCandidate(candidate).catch((e) => {
          this.logger.debug(`[WebRTC] Помилка додавання ICE-кандидата для ${sessionId}/${clientId}: ${e}`);
        });
      }
    } catch (e) {
      this.logger.debug(`[WebRTC] Неочікувана помилка addIceCandidate для ${sessionId}/${clientId}: ${e}`);
    }
  }
}