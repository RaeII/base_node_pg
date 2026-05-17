import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { env } from '@/config';
import { getStore } from '@/shared/utils/async_local_storage';

const { DB_HOSTNAME, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME } = env;

export default class MysqlService {
    private static pool: Pool;

    static initialize() {
        this.pool = mysql.createPool({
            host: DB_HOSTNAME,
            user: DB_USERNAME,
            password: DB_PASSWORD,
            database: DB_NAME,
            port: Number(DB_PORT),
            waitForConnections: true,
            connectionLimit: 10,
            connectTimeout: 15000,
            queueLimit: 0,
            enableKeepAlive: true,
            timezone: '+00:00',
        });
    }

    static async getConnection(): Promise<PoolConnection> {
        const context = getStore<PoolConnection>('mysql');
        if (!context) {
            throw new Error('No connection context available. Ensure the middleware is properly set up.');
        }

        if (!context.connection) {
            context.connection = await this.pool.getConnection();
        }
        return context.connection;
    }

    static isInTransaction(): boolean {
        const context = getStore<PoolConnection>('mysql');
        return context.is_in_transaction;
    }

    static async beginTransaction(): Promise<void> {
        let context = getStore<PoolConnection>('mysql');

        if (!context?.connection) {
            await this.getConnection();
            context = getStore<PoolConnection>('mysql');
        }
        if (!context) {
            throw new Error('No connection context available');
        }

        if (context.connection && !context.is_in_transaction) {
            await context.connection.beginTransaction();
            context.is_in_transaction = true;
        }
    }

    static async commit(): Promise<void> {
        const context = getStore<PoolConnection>('mysql');

        if (context && context.connection && context.is_in_transaction) {
            await context.connection.commit();
            context.is_in_transaction = false;
            await this.release();
        } else {
            throw new Error('No active transaction');
        }
    }

    static async rollback(): Promise<void> {
        const context = getStore<PoolConnection>('mysql');
        if (context && context.connection && context.is_in_transaction) {
            await context.connection.rollback();
            context.is_in_transaction = false;
            await this.release();
        } else {
            throw new Error('No active transaction');
        }
    }

    static async release(context: any = null) {
        const _context = context || getStore<PoolConnection>('mysql');
        if (_context && _context.connection) {
            _context.connection.release();
            _context.connection = null;
            _context.is_in_transaction = false;
        }
    }
}
