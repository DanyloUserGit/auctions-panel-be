// apps/browser-worker/src/webrtc/webrtc.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import * as dgram from 'dgram';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from 'werift';
import { BrowserService } from '../src/browser-worker.service';
import { RtpPacket } from 'werift';


@Injectable()
export class WebrtcService {
    private readonly logger = new Logger(WebrtcService.name);
    private connections = new Map<string, RTCPeerConnection>();

    private ffmpegProcesses = new Map<string, ChildProcess>();

    private udpSockets = new Map<string, dgram.Socket>();

    constructor(private browserService: BrowserService) { }

    async handleOffer(sessionId: string, offer: any, viewport: { width: number; height: number }, onIceCandidate: (candidate: any) => void): Promise<any> {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            icePortRange: [10000, 10050]
        });

        this.connections.set(sessionId, pc);

        const codec = new RTCRtpCodecParameters({
            mimeType: "video/VP8",
            clockRate: 90000,
            payloadType: 96,
            rtcpFeedback: [
                { type: "ccm", parameter: "fir" },
                { type: "nack" },
                { type: "nack", parameter: "pli" },
                { type: "goog-remb" },
            ],
            parameters: "x-google-start-bitrate=1000",
        });

        const videoTrack = new MediaStreamTrack({ kind: "video", codec });
        pc.addTrack(videoTrack);

        pc.onicecandidate = (event) => {
            if (event.candidate) onIceCandidate(event.candidate);
        };

        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // 🛑 НОВИЙ БЛОК: Чекаємо, поки werift знайде свої Docker IP та порти
        await new Promise<void>((resolve) => {
            if (pc.iceGatheringState === 'complete') return resolve();

            // Чекаємо максимум 1.5 секунди на збір кандидатів
            const timeout = setTimeout(resolve, 1500);

            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    resolve();
                }
            };
        });

        // Запускаємо трансляцію, якщо ще не запущена
        if (!this.ffmpegProcesses.has(sessionId)) {
            this.startVideoStreaming(sessionId, videoTrack, viewport);
        }

        if (!pc.localDescription) {
            this.logger.warn(`[WebrtcService] localDescription відсутній, повертаємо базовий answer`);
            return { type: answer.type, sdp: answer.sdp };
        }

        // ✅ Тепер pc.localDescription містить всі IP-адреси та порти!
        return {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
        };
    }

    private startVideoStreaming(sessionId: string, videoTrack: MediaStreamTrack, viewport: { width: number; height: number }) {
        const w = viewport?.width ? Number(viewport.width) : 1280;
        const h = viewport?.height ? Number(viewport.height) : 720;
        const safeWidth = Math.min(w, 1920);
        const safeHeight = Math.min(h, 1080);

        // Цей порт використовується лише всередині контейнера між FFmpeg та Node.js (його не треба прокидати в Docker)
        const port = Math.floor(Math.random() * (60000 - 50000) + 50000);

        const udpSocket = dgram.createSocket('udp4');
        udpSocket.bind(port);

        // ЗАЛИШАЄМО ТІЛЬКИ ОДИН ОБРОБНИК ПОВІДОМЛЕНЬ!
        udpSocket.on('message', (buffer) => {
            try {
                videoTrack.writeRtp(buffer);
            } catch (e) {
                this.logger.error('Error writing RTP packet', e);
            }
        });

        this.udpSockets.set(sessionId, udpSocket);
        const display = process.env.DISPLAY || ':99';

        const ffmpegCmd = spawn('ffmpeg', [
            '-f', 'x11grab',
            '-video_size', `${safeWidth}x${safeHeight}`,
            '-framerate', '30',
            '-i', `${display}.0+0,0`,
            '-c:v', 'libvpx',
            '-b:v', '1.5M',
            '-deadline', 'realtime',
            '-cpu-used', '4',
            '-g', '30',
            '-keyint_min', '30',
            '-payload_type', '96',
            '-f', 'rtp',
            '-slice-max-size', '1200',
            `rtp://127.0.0.1:${port}`
        ]);
        this.ffmpegProcesses.set(sessionId, ffmpegCmd);

        udpSocket.on('message', (buffer) => {
            try {
                // Якщо FFmpeg надсилає чистий RTP, werift має його прийняти
                // Але переконайтеся, що ви не отримуєте заголовок RTP-контейнера (SDP file)
                videoTrack.writeRtp(buffer);
            } catch (e) {
                this.logger.error('Error writing RTP packet', e);
            }
        });

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