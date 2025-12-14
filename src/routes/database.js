const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../../config/database');

/**
 * فحص اتصال قاعدة البيانات
 * GET /api/database/check-connection
 */
router.get('/check-connection', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        // تنفيذ استعلام بسيط للتحقق من الاتصال
        const result = await pool.request().query('SELECT 1 AS connected');
        
        if (result.recordset && result.recordset.length > 0) {
            res.json({
                success: true,
                message: 'الاتصال بقاعدة البيانات يعمل بنجاح',
                timestamp: new Date().toISOString(),
                database: pool.config.database,
                server: pool.config.server
            });
        } else {
            throw new Error('فشل في التحقق من الاتصال');
        }
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب جميع جداول قاعدة البيانات
 * GET /api/database/tables
 */
router.get('/tables', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        const query = `
            SELECT 
                t.TABLE_SCHEMA AS schema_name,
                t.TABLE_NAME AS table_name,
                t.TABLE_TYPE AS table_type,
                (
                    SELECT COUNT(*) 
                    FROM INFORMATION_SCHEMA.COLUMNS c 
                    WHERE c.TABLE_NAME = t.TABLE_NAME 
                    AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
                ) AS column_count
            FROM INFORMATION_SCHEMA.TABLES t
            WHERE t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME
        `;
        
        const result = await pool.request().query(query);
        
        // التحقق من الجداول
        const tables = result.recordset.map(table => ({
            schema: table.schema_name,
            name: table.table_name,
            type: table.table_type,
            columns: table.column_count,
            status: 'موجود'
        }));
        
        res.json({
            success: true,
            message: 'تم جلب الجداول بنجاح',
            count: tables.length,
            tables: tables
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب محتويات جدول معين
 * GET /api/database/table/:tableName
 */
router.get('/table/:tableName', async (req, res, next) => {
    try {
        const { tableName } = req.params;

        // قراءة limit من query ووضع قيمة افتراضية
        const limit = parseInt(req.query.limit, 10) || 100;

        // حماية إضافية (اختياري)
        const safeLimit = Math.min(Math.max(limit, 1), 1000);

        const pool = await getPool();

        // التحقق من وجود الجدول
        const checkTableQuery = `
            SELECT COUNT(*) AS table_exists
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = @tableName
            AND TABLE_TYPE = 'BASE TABLE'
        `;

        const checkResult = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(checkTableQuery);

        if (checkResult.recordset[0].table_exists === 0) {
            return res.status(404).json({
                success: false,
                message: `الجدول '${tableName}' غير موجود`
            });
        }

        // جلب معلومات الأعمدة
        const columnsQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE,
                COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @tableName
            ORDER BY ORDINAL_POSITION
        `;

        const columnsResult = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(columnsQuery);

        // جلب البيانات مع limit
        const dataQuery = `
            SELECT TOP (@limit) *
            FROM [${tableName}]
        `;

        const dataResult = await pool.request()
            .input('limit', sql.Int, safeLimit)
            .query(dataQuery);

        // جلب عدد السجلات الكامل
        const countQuery = `SELECT COUNT(*) AS total_rows FROM [${tableName}]`;
        const countResult = await pool.request().query(countQuery);

        res.json({
            success: true,
            message: 'تم جلب محتويات الجدول بنجاح',
            table_name: tableName,
            total_rows: countResult.recordset[0].total_rows,
            returned_rows: dataResult.recordset.length,
            limit: safeLimit,
            columns: columnsResult.recordset.map(col => ({
                name: col.COLUMN_NAME,
                type: col.DATA_TYPE,
                max_length: col.CHARACTER_MAXIMUM_LENGTH,
                nullable: col.IS_NULLABLE === 'YES',
                default_value: col.COLUMN_DEFAULT
            })),
            data: dataResult.recordset
        });

    } catch (error) {
        next(error);
    }
});


/**
 * جلب معلومات تفصيلية عن جدول معين
 * GET /api/database/table/:tableName/info
 */
router.get('/table/:tableName/info', async (req, res, next) => {
    try {
        const { tableName } = req.params;
        const pool = await getPool();
        
        // معلومات الجدول
        const tableInfoQuery = `
            SELECT 
                t.TABLE_SCHEMA,
                t.TABLE_NAME,
                t.TABLE_TYPE
            FROM INFORMATION_SCHEMA.TABLES t
            WHERE t.TABLE_NAME = @tableName
        `;
        
        // معلومات الأعمدة
        const columnsQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                ORDINAL_POSITION
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @tableName
            ORDER BY ORDINAL_POSITION
        `;
        
        // المفاتيح الأساسية
        const primaryKeysQuery = `
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = @tableName
            AND CONSTRAINT_NAME LIKE 'PK_%'
        `;
        
        const tableInfo = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(tableInfoQuery);
        
        if (tableInfo.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `الجدول '${tableName}' غير موجود`
            });
        }
        
        const columns = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(columnsQuery);
        
        const primaryKeys = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(primaryKeysQuery);
        
        res.json({
            success: true,
            table: tableInfo.recordset[0],
            columns: columns.recordset,
            primary_keys: primaryKeys.recordset.map(pk => pk.COLUMN_NAME),
            columns_count: columns.recordset.length
        });
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;