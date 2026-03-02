// apps/browser-worker/src/webrtc/webrtc.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import * as dgram from 'dgram';
import { MediaStreamTrack, RTCPeerConnection } from 'werift';
import { BrowserService } from '../src/browser-worker.service';


@Injectable()
export class WebrtcService {
    private readonly logger = new Logger(WebrtcService.name);
    private connections = new Map<string, RTCPeerConnection>();

    private ffmpegProcesses = new Map<string, ChildProcess>();

    private udpSockets = new Map<string, dgram.Socket>();

    constructor(private browserService: BrowserService) { }

    async handleOffer(sessionId: string, offer: any, viewport: { width: number; height: number }, onIceCandidate: (candidate: any) => void): Promise<any> {
        // 1. Створюємо PeerConnection
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        this.connections.set(sessionId, pc);

        // 2. Створюємо Video Track (для потоку від FFmpeg)
        const videoTrack = new MediaStreamTrack({ kind: 'video' });
        pc.addTrack(videoTrack);

        // 3. Налаштовуємо Data Channel для інтерактивності (мишка, клавіатура)
        pc.ondatachannel = (event) => {
            const channel = event.channel;
            channel.onMessage.subscribe((msg) => {
                try {
                    const action = JSON.parse(msg.toString());
                    // Передаємо дію в Playwright
                    this.browserService.interact(sessionId, action);
                } catch (e) {
                    this.logger.error('Помилка парсингу DataChannel', e);
                }
            });
        };

        // 4. Обробка ICE кандидатів (збираємо їх і відправляємо назад в Main API)
        // В реальному коді тут треба надсилати кандидатів через RabbitMQ назад
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                onIceCandidate(event.candidate);
            }
        };
        // 5. Встановлюємо Remote Description (Офер від React)
        await pc.setRemoteDescription(offer);

        // 6. Створюємо Answer і встановлюємо Local Description
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // 7. ЗАПУСКАЄМО FFMPEG ДЛЯ СТРІМІНГУ ЕКРАНУ
        if (!this.ffmpegProcesses.has(sessionId)) {
            this.startVideoStreaming(sessionId, videoTrack, viewport);
        }

        return answer;
    }

    private startVideoStreaming(sessionId: string, videoTrack: MediaStreamTrack, viewport: { width: number; height: number }) {
        // ДОДАНО: Безпечне перетворення. Якщо прийшов undefined, ставимо дефолт 1280x720
        const w = viewport?.width ? Number(viewport.width) : 1280;
        const h = viewport?.height ? Number(viewport.height) : 720;

        const safeWidth = Math.min(w, 1920);
        const safeHeight = Math.min(h, 1080);

        const port = Math.floor(Math.random() * (50000 - 10000) + 10000);

        const udpSocket = dgram.createSocket('udp4');
        udpSocket.bind(port);

        udpSocket.on('message', (buffer) => {
            // ПЕРЕДАЄМО ПАКЕТИ У WEBRTC ТРЕК!
            videoTrack.writeRtp(buffer);
        });

        this.udpSockets.set(sessionId, udpSocket);

        const ffmpegCmd = spawn('ffmpeg', [
            '-f', 'x11grab',
            '-video_size', `${safeWidth}x${safeHeight}`, // Тепер тут завжди будуть числа!
            '-framerate', '30',
            '-i', process.env.DISPLAY || ':99.0+0,0', // Не забудьте про змінну середовища для дисплея
            '-c:v', 'libvpx',
            '-b:v', '1.5M',
            '-deadline', 'realtime',
            '-payload_type', '96',
            '-f', 'rtp',
            `rtp://127.0.0.1:${port}`
        ]);
        this.ffmpegProcesses.set(sessionId, ffmpegCmd);

        ffmpegCmd.stderr.on('error', (data) => {
            this.logger.error(`[FFmpeg Error]: ${data.toString()}`);
        });

        ffmpegCmd.stderr.on('data', (data) => {
            const msg = data.toString();
            if (!msg.includes('frame=')) {
                this.logger.warn(`[FFmpeg]: ${msg.trim()}`);
            }
        });

        ffmpegCmd.on('close', (code) => {
            this.logger.log(`FFmpeg зупинився для сесії ${sessionId} з кодом ${code}`);
            this.ffmpegProcesses.delete(sessionId);
        });
    }
    async closeConnection(sessionId: string): Promise<void> {
        this.logger.log(`[WebrtcService] Починаємо закриття WebRTC та стріму для сесії: ${sessionId}`);

        // 1. Зупиняємо процес FFmpeg
        const ffmpegProcess = this.ffmpegProcesses.get(sessionId);
        if (ffmpegProcess) {
            this.logger.log(`[WebrtcService] Вбиваємо процес FFmpeg для сесії: ${sessionId}`);
            // SIGKILL надійно і миттєво вбиває дочірній процес
            ffmpegProcess.kill('SIGKILL');
            this.ffmpegProcesses.delete(sessionId);
        } else {
            this.logger.warn(`[WebrtcService] Процес FFmpeg для сесії ${sessionId} не знайдено.`);
        }

        // 2. Закриваємо WebRTC з'єднання
        const pc = this.connections.get(sessionId);
        if (pc) {
            try {
                // Закриваємо всі треки, трансівери та саме з'єднання
                await pc.close();
                this.logger.log(`[WebrtcService] RTCPeerConnection успішно закрито для сесії: ${sessionId}`);
            } catch (error) {
                this.logger.error(`[WebrtcService] Помилка під час закриття RTCPeerConnection для ${sessionId}:`, error);
            } finally {
                // Видаляємо з пам'яті незалежно від того, чи була помилка
                this.connections.delete(sessionId);
            }
        } else {
            this.logger.warn(`[WebrtcService] WebRTC з'єднання для сесії ${sessionId} не знайдено в пам'яті.`);
        }

        const socket = this.udpSockets.get(sessionId);
        if (socket) {
            socket.close();
            this.udpSockets.delete(sessionId);
            this.logger.log(`[WebrtcService] UDP сокет закрито для ${sessionId}`);
        }
    }
}