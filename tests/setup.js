process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-placeholder';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
