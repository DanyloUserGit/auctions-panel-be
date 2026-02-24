import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config } from 'dotenv';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = new DocumentBuilder()
    .setTitle('Auctions-Panel API Docs')
    .setVersion('1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://155.117.43.95'],
    credentials: true,
  });
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 8000);
  console.log(`The server is running on: http://localhost:${process.env.PORT}`);
}
bootstrap();
