// apps/browser-worker/src/webrtc/webrtc.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { MediaStreamTrack, RTCPeerConnection } from 'werift';
import { BrowserService } from '../src/browser-worker.service';


@Injectable()
export class WebrtcService {
    private readonly logger = new Logger(WebrtcService.name);
    private connections = new Map<string, RTCPeerConnection>();

    constructor(private browserService: BrowserService) { }

    async handleOffer(sessionId: string, offer: any, viewport: {width: number; height:number}): Promise<any> {
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
                // ... логіка відправки кандидата ...
            }
        };

        // 5. Встановлюємо Remote Description (Офер від React)
        await pc.setRemoteDescription(offer);

        // 6. Створюємо Answer і встановлюємо Local Description
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // 7. ЗАПУСКАЄМО FFMPEG ДЛЯ СТРІМІНГУ ЕКРАНУ
        this.startVideoStreaming(sessionId, videoTrack, viewport);

        return answer;
    }

    private startVideoStreaming(sessionId: string, videoTrack: MediaStreamTrack, viewport: {width: number; height:number}) {
        // Відкриваємо локальний UDP порт для werift, щоб він міг приймати RTP потік від FFmpeg
        // (werift має вбудовану підтримку прийому RTP)
        // УВАГА: Це концептуальний код. werift вимагає налаштування RTP receiver'а.

        const safeWidth = Math.min(viewport.width, 1920);
        const safeHeight = Math.min(viewport.height, 1080);

        const ffmpegCmd = spawn('ffmpeg', [
            '-f', 'x11grab',
            // 1. Вказуємо динамічний розмір захоплення
            '-video_size', `${safeWidth}x${safeHeight}`,
            '-framerate', '30',
            // 2. Вказуємо дисплей Xvfb і відступ (offset). +0,0 означає з верхнього лівого кута
            '-i', ':99.0+0,0',
            '-c:v', 'libvpx',
            '-b:v', '1.5M', // Бітрейт можна робити меншим для малих екранів
            '-deadline', 'realtime',
            '-f', 'rtp',
            'rtp://127.0.0.1:5004'
        ]);

        ffmpegCmd.stderr.on('data', (data) => {
            // ffmpeg пише логи в stderr
            // console.log(`ffmpeg: ${data}`); 
        });

        ffmpegCmd.on('close', (code) => {
            this.logger.log(`FFmpeg зупинився для сесії ${sessionId}`);
        });
    }
}