import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS || '5000'),
});

pool.on('error', (err) => {
  console.error('Database connection error:', err);
});

export default pool;
