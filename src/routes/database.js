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
        // const dataQuery = `
        //     SELECT TOP (@limit) *
        //     FROM [${tableName}]
        // `;
        const dataQuery = `
            SELECT  *
            FROM [${tableName}]
        `;


        const dataResult = await pool.request()
            // .input('limit', sql.Int, safeLimit)
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
/**
 * جلب المواد حسب المستودعات مع فلتر الفترة الزمنية
 * Query Parameters:
 * - period: last_month, last_week, last_3_months, last_year, today
 */
/**
 * جلب المواد حسب المستودعات مع فلتر الفترة الزمنية
 * Query Parameters:
 * - limit: عدد المواد المطلوبة (اختياري - يتم تجاهله إذا كان هناك فلتر تاريخ)
 * - period: last_month, last_week, last_3_months, last_year, today
 */
/**
 * جلب جميع المواد حسب المستودعات - بدون limit
 * GET /api/database/materials-by-stores
 */
router.get('/materials-by-stores', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        // قراءة البارامترات - بدون limit
        const storeCodeFilter = req.query.storeCode;
        const search = req.query.search;
        const minQty = parseFloat(req.query.minQty) || 0;
        
        // بناء شروط WHERE ديناميكية
        let whereConditions = ["st.Code IN ('12', '101', '102')"];
        let havingConditions = [];
        
        if (storeCodeFilter && ['12', '101', '102'].includes(storeCodeFilter)) {
            whereConditions.push(`st.Code = @storeCodeFilter`);
        }
        
        if (search) {
            whereConditions.push(`(mt.Name LIKE @search OR mt.Code LIKE @search)`);
        }
        
        if (minQty > 0) {
            havingConditions.push(`SUM(ISNULL(mi.Qty, 0)) >= @minQty`);
        } else {
            havingConditions.push(`SUM(ISNULL(mi.Qty, 0)) > 0`);
        }
        
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        const havingClause = havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : '';
        
        // الاستعلام بدون TOP - سيجلب كل المواد
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
                    SUM(ISNULL(mi.Qty, 0)) AS store_qty,
                    AVG(ISNULL(mi.Price, 0)) AS avg_price,
                    MAX(mi.ProductionDate) AS last_production_date,
                    MIN(mi.ExpireDate) AS nearest_expire_date,
                    COUNT(mi.GUID) AS transactions_count
                FROM st000 st
                CROSS JOIN mt000 mt
                LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID AND mt.GUID = mi.MatGUID
                LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
                ${whereClause}
                GROUP BY 
                    st.Code, st.Name, st.GUID,
                    mt.Code, mt.Name, mt.GUID, mt.Unity, mt.Qty,
                    tg.Name, tg.GUID
                ${havingClause}
            )
            SELECT *
            FROM MaterialsInStores
            ORDER BY store_code, material_name
        `;
        
        let request = pool.request();
        
        if (storeCodeFilter) {
            request = request.input('storeCodeFilter', sql.NVarChar, storeCodeFilter);
        }
        if (search) {
            request = request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (minQty > 0) {
            request = request.input('minQty', sql.Float, minQty);
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
        
        let response = Object.values(stores);
        
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
            message: 'تم جلب جميع المواد حسب المستودعات بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                storeCode: storeCodeFilter || 'الكل',
                search: search || null,
                minQty: minQty || 0
            },
            total_stores: response.length,
            total_materials: response.reduce((sum, store) => sum + store.materials_count, 0),
            total_records_fetched: result.recordset.length,
            stores: response
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب المواد لمستودع محدد - بدون limit
 * GET /api/database/materials-by-store/:storeCode
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
        
        // قراءة البارامترات - بدون limit
        const search = req.query.search;
        const minQty = parseFloat(req.query.minQty) || 0;
        const sortBy = req.query.sortBy || 'name'; // name, code, qty
        const sortOrder = req.query.sortOrder || 'asc'; // asc, desc
        
        // بناء شروط WHERE
        let whereConditions = ['st.Code = @storeCode'];
        
        if (search) {
            whereConditions.push('(mt.Name LIKE @search OR mt.Code LIKE @search)');
        }
        
        // فلتر الكمية سيتم تطبيقه في HAVING
        const havingConditions = [];
        if (minQty > 0) {
            havingConditions.push('SUM(ISNULL(mi.Qty, 0)) >= @minQty');
        } else {
            havingConditions.push('SUM(ISNULL(mi.Qty, 0)) > 0');
        }
        
        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        const havingClause = havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : '';
        
        // بناء ORDER BY
        let orderByClause = 'ORDER BY ';
        switch (sortBy) {
            case 'code':
                orderByClause += 'material_code';
                break;
            case 'qty':
                orderByClause += 'store_qty';
                break;
            case 'name':
            default:
                orderByClause += 'material_name';
        }
        orderByClause += ` ${sortOrder.toUpperCase()}`;
        
        // استعلام بدون TOP - سيجلب كل المواد
        const query = `
            WITH MaterialsInStore AS (
                SELECT 
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
                    SUM(ISNULL(mi.Qty, 0)) AS store_qty,
                    AVG(ISNULL(mi.Price, 0)) AS avg_price,
                    MAX(mi.ExpireDate) AS expire_date,
                    MAX(mi.ProductionDate) AS production_date,
                    COUNT(mi.GUID) AS transaction_count
                FROM st000 st
                CROSS JOIN mt000 mt
                LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID AND mt.GUID = mi.MatGUID
                LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
                ${whereClause}
                GROUP BY 
                    st.Code, st.Name, st.GUID,
                    mt.Code, mt.Name, mt.GUID, mt.Unity, mt.Qty,
                    mt.BarCode, mt.Company, mt.Origin,
                    tg.Name, tg.GUID
                ${havingClause}
            )
            SELECT *
            FROM MaterialsInStore
            ${orderByClause}
        `;
        
        let request = pool.request()
            .input('storeCode', sql.NVarChar, storeCode);
        
        if (search) {
            request = request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (minQty > 0) {
            request = request.input('minQty', sql.Float, minQty);
        }
        
        const result = await request.query(query);
        
        if (result.recordset.length === 0) {
            return res.json({
                success: true,
                message: 'لا توجد مواد تطابق معايير البحث',
                store: {
                    code: storeCode,
                    name: '',
                    materials: [],
                    materials_count: 0,
                    total_quantity: 0
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
            avg_price: row.avg_price,
            total_qty: row.total_qty,
            expire_date: row.expire_date,
            production_date: row.production_date,
            group_name: row.group_name,
            group_guid: row.group_guid,
            transaction_count: row.transaction_count
        }));
        
        res.json({
            success: true,
            message: 'تم جلب جميع المواد بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
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
                total_value: materials.reduce((sum, mat) => sum + (mat.quantity * mat.avg_price), 0),
                materials: materials
            }
        });
        
    } catch (error) {
        next(error);
    }
});







/**
 * جلب معلومات المستودعات مع عدد المواد
 * GET /api/database/stores-summary
 */
router.get('/stores-summary', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        const query = `
            SELECT 
                st.Code AS store_code,
                st.Name AS store_name,
                st.GUID AS store_guid,
                st.IsActive AS is_active,
                COUNT(DISTINCT mt.GUID) AS materials_count,
                SUM(ISNULL(mi.Qty, 0)) AS total_quantity,
                COUNT(mi.GUID) AS total_transactions
            FROM st000 st
            LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID
            LEFT JOIN mt000 mt ON mi.MatGUID = mt.GUID
            GROUP BY st.Code, st.Name, st.GUID, st.IsActive
            ORDER BY st.Code
        `;
        
        const result = await pool.request().query(query);
        
        const stores = result.recordset.map(row => ({
            code: row.store_code,
            name: row.store_name,
            guid: row.store_guid,
            is_active: row.is_active,
            materials_count: row.materials_count,
            total_quantity: row.total_quantity,
            total_transactions: row.total_transactions
        }));
        
        // إحصائيات إجمالية
        const summary = {
            total_stores: stores.length,
            total_materials_all_stores: stores.reduce((sum, s) => sum + s.materials_count, 0),
            total_quantity_all_stores: stores.reduce((sum, s) => sum + s.total_quantity, 0),
            active_stores: stores.filter(s => s.is_active).length
        };
        
        res.json({
            success: true,
            message: 'تم جلب معلومات المستودعات بنجاح',
            timestamp: new Date().toISOString(),
            summary: summary,
            stores: stores
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب معلومات مستودع واحد
 * GET /api/database/store-summary/:storeCode
 */
router.get('/store-summary/:storeCode', async (req, res, next) => {
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
        
        const query = `
            SELECT 
                st.Code AS store_code,
                st.Name AS store_name,
                st.GUID AS store_guid,
                st.IsActive AS is_active,
                st.Address AS address,
                st.Keeper AS keeper,
                COUNT(DISTINCT mt.GUID) AS materials_count,
                SUM(ISNULL(mi.Qty, 0)) AS total_quantity,
                COUNT(mi.GUID) AS total_transactions,
                AVG(ISNULL(mi.Price, 0)) AS avg_price,
                MAX(mi.ProductionDate) AS last_transaction_date
            FROM st000 st
            LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID
            LEFT JOIN mt000 mt ON mi.MatGUID = mt.GUID
            WHERE st.Code = @storeCode
            GROUP BY st.Code, st.Name, st.GUID, st.IsActive, st.Address, st.Keeper
        `;
        
        const result = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(query);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'المستودع غير موجود'
            });
        }
        
        const store = result.recordset[0];
        
        res.json({
            success: true,
            message: 'تم جلب معلومات المستودع بنجاح',
            timestamp: new Date().toISOString(),
            store: {
                code: store.store_code,
                name: store.store_name,
                guid: store.store_guid,
                is_active: store.is_active,
                address: store.address,
                keeper: store.keeper,
                materials_count: store.materials_count,
                total_quantity: store.total_quantity,
                total_transactions: store.total_transactions,
                avg_price: store.avg_price,
                last_transaction_date: store.last_transaction_date
            }
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب قائمة بسيطة بأسماء المستودعات فقط
 * GET /api/database/stores-list
 */
router.get('/stores-list', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        const query = `
            SELECT 
                Code AS code,
                Name AS name,
                GUID AS guid,
                IsActive AS is_active
            FROM st000
            WHERE Code IN ('12', '101', '102')
            ORDER BY Code
        `;
        
        const result = await pool.request().query(query);
        
        res.json({
            success: true,
            message: 'تم جلب قائمة المستودعات بنجاح',
            count: result.recordset.length,
            stores: result.recordset
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * جلب إحصائيات مفصلة لكل مستودع مع تصنيف المواد
 * GET /api/database/stores-detailed-stats
 */
router.get('/stores-detailed-stats', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        const query = `
            SELECT 
                st.Code AS store_code,
                st.Name AS store_name,
                tg.Name AS group_name,
                COUNT(DISTINCT mt.GUID) AS materials_count,
                SUM(ISNULL(mi.Qty, 0)) AS total_quantity
            FROM st000 st
            LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID
            LEFT JOIN mt000 mt ON mi.MatGUID = mt.GUID
            LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
            WHERE st.Code IN ('12', '101', '102')
            GROUP BY st.Code, st.Name, tg.Name
            HAVING SUM(ISNULL(mi.Qty, 0)) > 0
            ORDER BY st.Code, tg.Name
        `;
        
        const result = await pool.request().query(query);
        
        // تجميع البيانات حسب المستودع
        const storesMap = {};
        
        result.recordset.forEach(row => {
            if (!storesMap[row.store_code]) {
                storesMap[row.store_code] = {
                    code: row.store_code,
                    name: row.store_name,
                    total_materials: 0,
                    total_quantity: 0,
                    groups: []
                };
            }
            
            storesMap[row.store_code].total_materials += row.materials_count;
            storesMap[row.store_code].total_quantity += row.total_quantity;
            storesMap[row.store_code].groups.push({
                group_name: row.group_name || 'غير مصنف',
                materials_count: row.materials_count,
                quantity: row.total_quantity
            });
        });
        
        const stores = Object.values(storesMap);
        
        res.json({
            success: true,
            message: 'تم جلب الإحصائيات المفصلة بنجاح',
            timestamp: new Date().toISOString(),
            total_stores: stores.length,
            stores: stores
        });
        
    } catch (error) {
        next(error);
    }
});



/**
 * جلب جميع المواد مع الفلاتر و Pagination
 * GET /api/database/materials
 * Query Parameters:
 * - search: البحث في اسم أو كود المادة أو الباركود
 * - groupGuid: فلترة حسب GUID المجموعة
 * - unity: فلترة حسب الوحدة
 * - page: رقم الصفحة (افتراضي: 1)
 * - limit: عدد النتائج في الصفحة (افتراضي: 50)
 * - sortBy: الترتيب حسب (name, code, qty) - افتراضي: name
 * - sortOrder: اتجاه الترتيب (asc, desc) - افتراضي: asc
 */
router.get('/materials', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        // قراءة البارامترات
        const search = req.query.search;
        const groupGuid = req.query.groupGuid;
        const unity = req.query.unity;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const sortBy = req.query.sortBy || 'name';
        const sortOrder = req.query.sortOrder || 'asc';
        
        // حساب OFFSET
        const offset = (page - 1) * limit;
        
        // بناء شروط WHERE
        let whereConditions = [];
        
        if (search) {
            whereConditions.push(`(mt.Name LIKE @search OR mt.Code LIKE @search OR mt.BarCode LIKE @search)`);
        }
        
        if (groupGuid) {
            whereConditions.push(`mt.GroupGUID = @groupGuid`);
        }
        
        if (unity) {
            whereConditions.push(`mt.Unity = @unity`);
        }
        
        const whereClause = whereConditions.length > 0 
            ? `WHERE ${whereConditions.join(' AND ')}` 
            : '';
        
        // بناء ORDER BY
        let orderByField = 'mt.Name';
        switch (sortBy) {
            case 'code':
                orderByField = 'mt.Code';
                break;
            case 'qty':
                orderByField = 'mt.Qty';
                break;
            case 'name':
            default:
                orderByField = 'mt.Name';
        }
        const orderByClause = `ORDER BY ${orderByField} ${sortOrder.toUpperCase()}`;
        
        // استعلام العد الإجمالي
        const countQuery = `
            SELECT COUNT(*) AS total_count
            FROM mt000 mt
            ${whereClause}
        `;
        
        // استعلام البيانات مع Pagination
        const dataQuery = `
            SELECT 
                mt.GUID AS guid,
                mt.Code AS code,
                mt.Name AS name,
                mt.LatinName AS latin_name,
                mt.Unity AS unity,
                mt.Qty AS quantity,
                mt.BarCode AS barcode,
                mt.BarCode2 AS barcode2,
                mt.BarCode3 AS barcode3,
                mt.Company AS company,
                mt.Origin AS origin,
                mt.Spec AS spec,
                mt.High AS high_price,
                mt.Low AS low_price,
                mt.Whole AS wholesale_price,
                mt.Retail AS retail_price,
                mt.LastPrice AS last_price,
                mt.AvgPrice AS avg_price,
                mt.LastPriceDate AS last_price_date,
                mt.Unit2 AS unit2,
                mt.Unit2Fact AS unit2_factor,
                mt.Unit3 AS unit3,
                mt.Unit3Fact AS unit3_factor,
                mt.ExpireFlag AS expire_flag,
                mt.ProductionFlag AS production_flag,
                mt.bHide AS is_hidden,
                mt.OrderLimit AS order_limit,
                tg.GUID AS group_guid,
                tg.Name AS group_name,
                tg.Code AS group_code
            FROM mt000 mt
            LEFT JOIN TypesGroup000 tg ON mt.GroupGUID = tg.GUID
            ${whereClause}
            ${orderByClause}
            OFFSET @offset ROWS 
            FETCH NEXT @limit ROWS ONLY
        `;
        
        // بناء الـ requests
        let countRequest = pool.request();
        let dataRequest = pool.request();
        
        // إضافة البارامترات
        if (search) {
            const searchParam = `%${search}%`;
            countRequest = countRequest.input('search', sql.NVarChar, searchParam);
            dataRequest = dataRequest.input('search', sql.NVarChar, searchParam);
        }
        
        if (groupGuid) {
            countRequest = countRequest.input('groupGuid', sql.UniqueIdentifier, groupGuid);
            dataRequest = dataRequest.input('groupGuid', sql.UniqueIdentifier, groupGuid);
        }
        
        if (unity) {
            countRequest = countRequest.input('unity', sql.NVarChar, unity);
            dataRequest = dataRequest.input('unity', sql.NVarChar, unity);
        }
        
        dataRequest = dataRequest
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);
        
        // تنفيذ الاستعلامات
        const [countResult, dataResult] = await Promise.all([
            countRequest.query(countQuery),
            dataRequest.query(dataQuery)
        ]);
        
        const totalCount = countResult.recordset[0].total_count;
        const totalPages = Math.ceil(totalCount / limit);
        
        res.json({
            success: true,
            message: 'تم جلب المواد بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                search: search || null,
                groupGuid: groupGuid || null,
                unity: unity || null,
                sortBy: sortBy,
                sortOrder: sortOrder
            },
            pagination: {
                current_page: page,
                per_page: limit,
                total_items: totalCount,
                total_pages: totalPages,
                from: offset + 1,
                to: Math.min(offset + limit, totalCount),
                has_previous: page > 1,
                has_next: page < totalPages
            },
            materials: dataResult.recordset.map(row => ({
                guid: row.guid,
                code: row.code,
                name: row.name,
                latin_name: row.latin_name,
                unity: row.unity,
                quantity: row.quantity,
                barcode: row.barcode,
                barcode2: row.barcode2,
                barcode3: row.barcode3,
                company: row.company,
                origin: row.origin,
                spec: row.spec,
                prices: {
                    high: row.high_price,
                    low: row.low_price,
                    wholesale: row.wholesale_price,
                    retail: row.retail_price,
                    last: row.last_price,
                    avg: row.avg_price,
                    last_price_date: row.last_price_date
                },
                units: {
                    unit2: row.unit2,
                    unit2_factor: row.unit2_factor,
                    unit3: row.unit3,
                    unit3_factor: row.unit3_factor
                },
                flags: {
                    expire_flag: row.expire_flag,
                    production_flag: row.production_flag,
                    is_hidden: row.is_hidden
                },
                order_limit: row.order_limit,
                group: row.group_guid ? {
                    guid: row.group_guid,
                    name: row.group_name,
                    code: row.group_code
                } : null
            }))
        });
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;