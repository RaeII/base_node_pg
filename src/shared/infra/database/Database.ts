/* eslint-disable @typescript-eslint/no-explicit-any */
import MysqlService from './MySQLService';
import { PoolConnection } from 'mysql2/promise';

export default class Database {
    protected connection: PoolConnection | null = null;
    protected isInTransaction: boolean = false;

    constructor() {}

    async getConnection(): Promise<PoolConnection> {
        return await MysqlService.getConnection();
    }

    protected async query(sql: string, value: any = null): Promise<any> {
        let connection: PoolConnection | null = null;
        try {
            connection = await this.getConnection();
            if (value) {
                return await connection.query(sql, value);
            } else {
                return await connection.query(sql);
            }
        } catch (error) {
            if (await Database.isInTransaction()) await Database.rollback();
            throw error;
        } finally {
            if (!MysqlService.isInTransaction()) await MysqlService.release();
        }
    }

    public static async startTransaction() {
        return await MysqlService.beginTransaction();
    }

    public static async rollback() {
        return await MysqlService.rollback();
    }

    public static async commit() {
        return await MysqlService.commit();
    }

    public static isInTransaction() {
        return MysqlService.isInTransaction();
    }
}
