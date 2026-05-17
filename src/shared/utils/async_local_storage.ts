import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import MysqlService from '@/shared/infra/database/MySQLService';

export interface ConnectionContext<T> {
    base_connection: T | null;
    connection: T | null;
    is_in_transaction: boolean;
    is_prepared: boolean;
}

type ConnectionMap = Map<string, ConnectionContext<any>>;
const asyncLocalStorage = new AsyncLocalStorage<ConnectionMap>();

const getStore = <T = PoolConnection>(key: string): ConnectionContext<T> => {
    const contexts = asyncLocalStorage.getStore();

    if (!contexts) {
        throw new Error(
            'AsyncLocalStorage não inicializado. Garanta que o `connectionMiddleware()` está registrado antes das rotas ou execute a lógica dentro de `runWithConnection()`.'
        );
    }

    const context = contexts.get(key);

    if (!context) {
        throw new Error('Contexto da base de dado não inicializado.');
    }

    return context;
};

const getConnectionsObject = () => {
    const connetcions: ConnectionMap = new Map();

    connetcions.set('mysql', { base_connection: null, connection: null, is_in_transaction: false, is_prepared: false });
    return connetcions;
};

const connectionMiddleware = () => {
    return (req: Request, res: Response, next: NextFunction) => {
        const connetcions = getConnectionsObject();
        const mysqlContext = connetcions.get('mysql') ?? null;

        asyncLocalStorage.run(connetcions, () => {
            // Garantir que todas as conexões sejam liberadas quando a resposta terminar
            res.on('finish', async () => {
                try {
                    if (mysqlContext) await MysqlService.release(mysqlContext);
                } catch (error) {
                    console.error('Error closing mysql connection on finish:', error);
                }
            });

            // Se a conexão for interrompida antes do finish
            res.on('close', async () => {
                try {
                    if (mysqlContext) await MysqlService.release(mysqlContext);
                } catch (error) {
                    console.error('Error closing mysql connection on close:', error);
                }
            });

            next();
        });
    };
};

const runWithConnection = async <T>(callback: () => Promise<T>): Promise<T> => {
    const connections = getConnectionsObject();
    const __callback = async () => {
        try {
            return await callback();
        } catch (error) {
            console.error('Error in runWithConnection:', error);
            throw error;
        } finally {
            for (const [key, con] of connections.entries()) {
                try {
                    // console.log('key', key, con)
                    await MysqlService.release(con);
                } catch (error) {
                    console.error(`Error closing connection ${key}:`, error);
                    // Continue to next connection even if this one fails
                }
            }
            connections.clear();
        }
    };
    return await asyncLocalStorage.run(connections, __callback);
};

export { getStore, connectionMiddleware, getConnectionsObject, runWithConnection };
