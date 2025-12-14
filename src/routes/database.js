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


///////////

/**
 * جلب المواد حسب المستودعات (12، 101، 102) مع الفلاتر
 * GET /api/database/materials-by-stores
 * Query Parameters:
 * - limit: عدد المواد المطلوبة (افتراضي: 100)
 * - storeCode: كود المستودع للفلترة (12, 101, 102)
 * - startDate: تاريخ البداية (YYYY-MM-DD)
 * - endDate: تاريخ النهاية (YYYY-MM-DD)
 * - groupGuid: معرف مجموعة المواد
 * - search: البحث في اسم أو كود المادة
 */
router.get('/materials-by-stores', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        // قراءة البارامترات
        const limit = parseInt(req.query.limit, 10) || 100;
        const safeLimit = Math.min(Math.max(limit, 1), 10000);
        const storeCodeFilter = req.query.storeCode; // '12', '101', '102' أو null
        const startDate = req.query.startDate; // YYYY-MM-DD
        const endDate = req.query.endDate; // YYYY-MM-DD
        const groupGuid = req.query.groupGuid;
        const search = req.query.search;
        const minQty = parseFloat(req.query.minQty) || 0;
        
        // بناء شروط WHERE ديناميكية
        let whereConditions = ["st.Code IN ('12', '101', '102')"];
        let havingConditions = [];
        
        // فلتر المستودع
        if (storeCodeFilter && ['12', '101', '102'].includes(storeCodeFilter)) {
            whereConditions.push(`st.Code = @storeCodeFilter`);
        }
        
        // فلتر المجموعة
        if (groupGuid) {
            whereConditions.push(`mt.GroupGUID = @groupGuid`);
        }
        
        // فلتر البحث
        if (search) {
            whereConditions.push(`(mt.Name LIKE @search OR mt.Code LIKE @search)`);
        }
        
        // فلتر الكمية الدنيا
        if (minQty > 0) {
            havingConditions.push(`SUM(mi.Qty) >= @minQty`);
        }
        
        // فلتر التاريخ (على جدول MI000)
        let dateFilter = '';
        if (startDate || endDate) {
            const dateConditions = [];
            if (startDate) {
                dateConditions.push(`mi.ProductionDate >= @startDate`);
            }
            if (endDate) {
                dateConditions.push(`mi.ProductionDate <= @endDate`);
            }
            if (dateConditions.length > 0) {
                whereConditions.push(`(${dateConditions.join(' AND ')})`);
            }
        }
        
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        const havingClause = havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : '';
        
        // الاستعلام الرئيسي
        const query = `
            WITH MaterialsInStores AS (
                SELECT 
                    st.Code AS store_code,
                    st.Name AS store_name,
                    st.GUID AS store_guid,
                    mt.Code AS material_code,
                    mt.Name AS material_name,
                    mt.GUID AS material_guid,
                    mt.Unity AS unity,
                    mt.Qty AS total_qty,
                    tg.Name AS group_name,
                    tg.GUID AS group_guid,
                    SUM(mi.Qty) AS store_qty,
                    AVG(mi.Price) AS avg_price,
                    MAX(mi.ProductionDate) AS last_production_date,
                    MIN(mi.ExpireDate) AS nearest_expire_date,
                    COUNT(mi.GUID) AS transactions_count
                FROM st000 st
                LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID
                LEFT JOIN mt000 mt ON mi.MatGUID = mt.GUID
                LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
                ${whereClause}
                GROUP BY 
                    st.Code, st.Name, st.GUID,
                    mt.Code, mt.Name, mt.GUID, mt.Unity, mt.Qty,
                    tg.Name, tg.GUID
                ${havingClause}
            )
            SELECT TOP (@limit) *
            FROM MaterialsInStores
            WHERE store_qty > 0
            ORDER BY store_code, material_name
        `;
        
        // إنشاء الطلب وإضافة البارامترات
        let request = pool.request().input('limit', sql.Int, safeLimit);
        
        if (storeCodeFilter) {
            request = request.input('storeCodeFilter', sql.NVarChar, storeCodeFilter);
        }
        if (groupGuid) {
            request = request.input('groupGuid', sql.UniqueIdentifier, groupGuid);
        }
        if (search) {
            request = request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (minQty > 0) {
            request = request.input('minQty', sql.Float, minQty);
        }
        if (startDate) {
            request = request.input('startDate', sql.DateTime, new Date(startDate));
        }
        if (endDate) {
            request = request.input('endDate', sql.DateTime, new Date(endDate));
        }
        
        const result = await request.query(query);
        
        // تجميع النتائج حسب المستودع
        const stores = {
            '12': {
                code: '12',
                name: 'مستودع المواد الجاهزة',
                guid: null,
                materials: []
            },
            '101': {
                code: '101',
                name: 'مستودع المواد الاولية المساعدة',
                guid: null,
                materials: []
            },
            '102': {
                code: '102',
                name: 'مستودع المواد الاولية الفعالة',
                guid: null,
                materials: []
            }
        };
        
        // ملء البيانات
        result.recordset.forEach(row => {
            const storeCode = row.store_code;
            
            if (stores[storeCode]) {
                if (!stores[storeCode].guid) {
                    stores[storeCode].guid = row.store_guid;
                    stores[storeCode].name = row.store_name;
                }
                
                stores[storeCode].materials.push({
                    code: row.material_code,
                    name: row.material_name,
                    guid: row.material_guid,
                    unity: row.unity,
                    quantity: row.store_qty,
                    avg_price: row.avg_price,
                    total_qty: row.total_qty,
                    last_production_date: row.last_production_date,
                    nearest_expire_date: row.nearest_expire_date,
                    transactions_count: row.transactions_count,
                    group_name: row.group_name,
                    group_guid: row.group_guid
                });
            }
        });
        
        // تحويل إلى مصفوفة وحذف المستودعات الفارغة إذا كان هناك فلتر
        let response = Object.values(stores);
        
        // إذا كان هناك فلتر مستودع، نعرض المستودع المطلوب فقط
        if (storeCodeFilter) {
            response = response.filter(store => store.code === storeCodeFilter);
        }
        
        response = response.map(store => ({
            ...store,
            materials_count: store.materials.length,
            total_quantity: store.materials.reduce((sum, mat) => sum + mat.quantity, 0)
        }));
        
        res.json({
            success: true,
            message: 'تم جلب المواد حسب المستودعات بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                limit: safeLimit,
                storeCode: storeCodeFilter || 'الكل',
                startDate: startDate || null,
                endDate: endDate || null,
                groupGuid: groupGuid || null,
                search: search || null,
                minQty: minQty || 0
            },
            total_stores: response.length,
            total_materials: response.reduce((sum, store) => sum + store.materials_count, 0),
            stores: response
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب المواد لمستودع محدد مع الفلاتر
 * GET /api/database/materials-by-store/:storeCode
 * Query Parameters:
 * - limit: عدد المواد (افتراضي: 100)
 * - startDate: تاريخ البداية
 * - endDate: تاريخ النهاية
 * - groupGuid: معرف المجموعة
 * - search: البحث
 * - minQty: الكمية الدنيا
 * - sortBy: الترتيب (name, code, qty, date)
 * - sortOrder: اتجاه الترتيب (asc, desc)
 */
router.get('/materials-by-store/:storeCode', async (req, res, next) => {
    try {
        const { storeCode } = req.params;
        const pool = await getPool();
        
        // التحقق من كود المستودع
        if (!['12', '101', '102'].includes(storeCode)) {
            return res.status(400).json({
                success: false,
                message: 'كود المستودع غير صحيح. يجب أن يكون: 12، 101، أو 102'
            });
        }
        
        // قراءة البارامترات
        const limit = parseInt(req.query.limit, 10) || 100;
        const safeLimit = Math.min(Math.max(limit, 1), 10000);
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const groupGuid = req.query.groupGuid;
        const search = req.query.search;
        const minQty = parseFloat(req.query.minQty) || 0;
        const sortBy = req.query.sortBy || 'name'; // name, code, qty, date
        const sortOrder = req.query.sortOrder || 'asc'; // asc, desc
        
        // بناء شروط WHERE
        let whereConditions = ['st.Code = @storeCode'];
        
        if (groupGuid) {
            whereConditions.push('mt.GroupGUID = @groupGuid');
        }
        
        if (search) {
            whereConditions.push('(mt.Name LIKE @search OR mt.Code LIKE @search)');
        }
        
        if (minQty > 0) {
            whereConditions.push('mi.Qty >= @minQty');
        }
        
        if (startDate) {
            whereConditions.push('mi.ProductionDate >= @startDate');
        }
        
        if (endDate) {
            whereConditions.push('mi.ProductionDate <= @endDate');
        }
        
        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        
        // بناء ORDER BY
        let orderByClause = 'ORDER BY ';
        switch (sortBy) {
            case 'code':
                orderByClause += 'mt.Code';
                break;
            case 'qty':
                orderByClause += 'mi.Qty';
                break;
            case 'date':
                orderByClause += 'mi.ProductionDate';
                break;
            case 'name':
            default:
                orderByClause += 'mt.Name';
        }
        orderByClause += ` ${sortOrder.toUpperCase()}`;
        
        const query = `
            SELECT TOP (@limit)
                st.Code AS store_code,
                st.Name AS store_name,
                st.GUID AS store_guid,
                mt.Code AS material_code,
                mt.Name AS material_name,
                mt.GUID AS material_guid,
                mt.Unity AS unity,
                mt.Qty AS total_qty,
                mt.BarCode AS barcode,
                mt.Company AS company,
                mt.Origin AS origin,
                tg.Name AS group_name,
                tg.GUID AS group_guid,
                mi.Qty AS store_qty,
                mi.Price AS price,
                mi.ExpireDate AS expire_date,
                mi.ProductionDate AS production_date,
                mi.GUID AS transaction_guid,
                mi.ParentGUID AS bill_guid
            FROM st000 st
            INNER JOIN MI000 mi ON st.GUID = mi.StoreGUID
            INNER JOIN mt000 mt ON mi.MatGUID = mt.GUID
            LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
            ${whereClause}
            ${orderByClause}
        `;
        
        let request = pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .input('limit', sql.Int, safeLimit);
        
        if (groupGuid) {
            request = request.input('groupGuid', sql.UniqueIdentifier, groupGuid);
        }
        if (search) {
            request = request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (minQty > 0) {
            request = request.input('minQty', sql.Float, minQty);
        }
        if (startDate) {
            request = request.input('startDate', sql.DateTime, new Date(startDate));
        }
        if (endDate) {
            request = request.input('endDate', sql.DateTime, new Date(endDate));
        }
        
        const result = await request.query(query);
        
        if (result.recordset.length === 0) {
            return res.json({
                success: true,
                message: 'لا توجد مواد تطابق معايير البحث',
                store: {
                    code: storeCode,
                    materials: []
                }
            });
        }
        
        const storeInfo = result.recordset[0];
        const materials = result.recordset.map(row => ({
            code: row.material_code,
            name: row.material_name,
            guid: row.material_guid,
            unity: row.unity,
            barcode: row.barcode,
            company: row.company,
            origin: row.origin,
            quantity: row.store_qty,
            price: row.price,
            total_qty: row.total_qty,
            expire_date: row.expire_date,
            production_date: row.production_date,
            group_name: row.group_name,
            group_guid: row.group_guid,
            transaction_guid: row.transaction_guid,
            bill_guid: row.bill_guid
        }));
        
        res.json({
            success: true,
            message: 'تم جلب المواد بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                limit: safeLimit,
                startDate: startDate || null,
                endDate: endDate || null,
                groupGuid: groupGuid || null,
                search: search || null,
                minQty: minQty || 0,
                sortBy: sortBy,
                sortOrder: sortOrder
            },
            store: {
                code: storeInfo.store_code,
                name: storeInfo.store_name,
                guid: storeInfo.store_guid,
                materials_count: materials.length,
                total_quantity: materials.reduce((sum, mat) => sum + mat.quantity, 0),
                total_value: materials.reduce((sum, mat) => sum + (mat.quantity * mat.price), 0),
                materials: materials
            }
        });
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;