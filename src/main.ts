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

  app.enableCors({ origin: '*' });
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 8000);
  console.log(`The server is running on: http://localhost:${process.env.PORT}`);
}
bootstrap();
