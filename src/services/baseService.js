const { getPool, sql } = require('../../config/database');

/**
 * Base Service - يحتوي على الدوال المشتركة للقراءة من قاعدة البيانات
 */
class BaseService {
    constructor(tableName) {
        this.tableName = tableName;
    }

    /**
     * جلب جميع السجلات من الجدول
     */
    async getAll(options = {}) {
        try {
            const pool = await getPool();
            const { orderBy = null, limit = null, offset = 0 } = options;

            let query = `SELECT * FROM [${this.tableName}]`;
            
            if (orderBy) {
                query += ` ORDER BY ${orderBy}`;
            }
            
            if (limit) {
                query += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
            }

            const result = await pool.request().query(query);
            return result.recordset;
        } catch (error) {
            console.error(`خطأ في جلب البيانات من ${this.tableName}:`, error.message);
            throw error;
        }
    }

    /**
     * جلب سجل واحد بناءً على ID
     */
    async getById(id, idColumn = 'id') {
        try {
            const pool = await getPool();
            
            const result = await pool
                .request()
                .input('id', sql.Int, id)
                .query(`SELECT * FROM [${this.tableName}] WHERE [${idColumn}] = @id`);

            return result.recordset[0] || null;
        } catch (error) {
            console.error(`خطأ في جلب السجل من ${this.tableName}:`, error.message);
            throw error;
        }
    }

    /**
     * البحث في الجدول بشروط مخصصة
     */
    async search(conditions = {}, options = {}) {
        try {
            const pool = await getPool();
            const request = pool.request();
            
            let query = `SELECT * FROM [${this.tableName}]`;
            const whereClauses = [];
            
            // بناء شروط WHERE
            Object.keys(conditions).forEach((key, index) => {
                const paramName = `param${index}`;
                whereClauses.push(`[${key}] = @${paramName}`);
                request.input(paramName, conditions[key]);
            });
            
            if (whereClauses.length > 0) {
                query += ` WHERE ${whereClauses.join(' AND ')}`;
            }
            
            // إضافة الترتيب
            if (options.orderBy) {
                query += ` ORDER BY ${options.orderBy}`;
            }
            
            // إضافة Pagination
            if (options.limit) {
                const offset = options.offset || 0;
                query += ` OFFSET ${offset} ROWS FETCH NEXT ${options.limit} ROWS ONLY`;
            }

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error(`خطأ في البحث في ${this.tableName}:`, error.message);
            throw error;
        }
    }

    /**
     * البحث بنص (LIKE)
     */
    async searchByText(column, searchText, options = {}) {
        try {
            const pool = await getPool();
            const request = pool.request();
            
            let query = `SELECT * FROM [${this.tableName}] WHERE [${column}] LIKE @searchText`;
            request.input('searchText', sql.NVarChar, `%${searchText}%`);
            
            if (options.orderBy) {
                query += ` ORDER BY ${options.orderBy}`;
            }
            
            if (options.limit) {
                const offset = options.offset || 0;
                query += ` OFFSET ${offset} ROWS FETCH NEXT ${options.limit} ROWS ONLY`;
            }

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error(`خطأ في البحث النصي في ${this.tableName}:`, error.message);
            throw error;
        }
    }

    /**
     * عد السجلات
     */
    async count(conditions = {}) {
        try {
            const pool = await getPool();
            const request = pool.request();
            
            let query = `SELECT COUNT(*) as total FROM [${this.tableName}]`;
            const whereClauses = [];
            
            Object.keys(conditions).forEach((key, index) => {
                const paramName = `param${index}`;
                whereClauses.push(`[${key}] = @${paramName}`);
                request.input(paramName, conditions[key]);
            });
            
            if (whereClauses.length > 0) {
                query += ` WHERE ${whereClauses.join(' AND ')}`;
            }

            const result = await request.query(query);
            return result.recordset[0].total;
        } catch (error) {
            console.error(`خطأ في عد السجلات من ${this.tableName}:`, error.message);
            throw error;
        }
    }

    /**
     * تنفيذ استعلام مخصص
     */
    async executeQuery(query, params = {}) {
        try {
            const pool = await getPool();
            const request = pool.request();
            
            // إضافة المعاملات
            Object.keys(params).forEach(key => {
                request.input(key, params[key]);
            });

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('خطأ في تنفيذ الاستعلام:', error.message);
            throw error;
        }
    }
}

module.exports = BaseService;