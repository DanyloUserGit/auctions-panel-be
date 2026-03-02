import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { AppModule } from './app.module';
config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://127.0.0.1:5672'],
      queue: 'api_responses_queue',
      queueOptions: {
        durable: false,
      },
    },
  });
  const configDoc = new DocumentBuilder()
    .setTitle('Auctions-Panel API Docs')
    .setVersion('1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, configDoc);
  app.setGlobalPrefix('api');
  SwaggerModule.setup('/api/docs', app, documentFactory);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://auctions-be.duckdns.org'],
    credentials: true,
  });
  app.use(cookieParser());

  await app.startAllMicroservices();

  await app.listen(process.env.PORT ?? 8000);
  console.log(`The server is running on: http://localhost:${process.env.PORT}`);
}
bootstrap();