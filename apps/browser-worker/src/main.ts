import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { BrowserWorkerModule } from './browser-worker.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(BrowserWorkerModule, {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'browser_sessions_queue',
      noAck: false,
      prefetchCount: 1,
      queueOptions: { durable: true },
    },
  });
  await app.listen();
  console.log('Browser Worker is listening for tasks...');
}
bootstrap();
