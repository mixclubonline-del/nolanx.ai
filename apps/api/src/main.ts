import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import { isAllowedWebOrigin } from './common/utils/web-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(bodyParser.json({ limit: '10mb' }));

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || isAllowedWebOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin denied: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const server = await app.listen(process.env.PORT ?? 8080);
  server.setTimeout(900000);

  console.log('Environment:', process.env.NODE_ENV);
  console.log(`Application is running on: http://localhost:${process.env.PORT ?? 8080}`);
}

bootstrap();
