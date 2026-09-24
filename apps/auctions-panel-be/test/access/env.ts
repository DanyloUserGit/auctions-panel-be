// jest setupFiles: runs BEFORE AppModule is imported, so modules that read process.env at import time
// (ConfigModule, the RabbitMQ client of SessionsModule) see the test values. ConfigModule does not
// override variables that are already set, so the real .env values are never used by these tests.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL ?? 'amqp://localhost:55672';
process.env.JWT_SECRET = 'e2e-test-jwt-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.ENCRYPT_PASS = 'e2e-test-encrypt-pass';
process.env.ENCRYPT_SALT = 'e2e-test-encrypt-salt';
process.env.SENDGRID_API_KEY = 'SG.e2e-test-disabled';
process.env.TURNSTILE_SECRET_KEY = 'e2e-test-disabled';
