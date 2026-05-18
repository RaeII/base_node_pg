import type { QueryResult, QueryResultRow } from "pg";
import { query as pgQuery, type QueryOptions } from "@/db/client";

/**
 * Classe base para repositórios.
 *
 * Métodos do repositório chamam `this.query(sql, params)`.
 * O wrapper resolve automaticamente:
 * - O cliente da transação ativa (via `withTransaction`), se houver.
 * - Caso contrário, usa o `writePool` em autocommit.
 *
 * Subclasses não precisam — e não devem — abrir/fechar conexões manualmente.
 * Para transações, envolva a operação com `withTransaction` no controller/service.
 */
export default class Database {
    constructor() {}

    protected async query<T extends QueryResultRow = QueryResultRow>(
        sql: string,
        params?: unknown[],
        opts?: QueryOptions
    ): Promise<QueryResult<T>> {
        return await pgQuery<T>(sql, params, opts);
    }
}

// Re-exporta para conveniência
export { withTransaction, isInTransaction } from "@/db/transaction";
