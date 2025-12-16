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
router.get('/materials-by-stores', async (req, res, next) => {
    try {
        const pool = await getPool();
        
        // قراءة البارامترات
        const storeCodeFilter = req.query.storeCode;
        let startDate = req.query.startDate;
        let endDate = req.query.endDate;
        const period = req.query.period;
        const groupGuid = req.query.groupGuid;
        const search = req.query.search;
        const minQty = parseFloat(req.query.minQty) || 0;
        
        // تحديد الـ limit بذكاء:
        // - إذا كان هناك فلتر تاريخ (period أو startDate/endDate) ولم يتم تحديد limit صراحةً → لا limit
        // - إذا لم يكن هناك فلتر تاريخ → استخدام limit الافتراضي (100)
        // - إذا تم تحديد limit صراحةً → استخدامه دائماً
        
        const hasDateFilter = period || startDate || endDate;
        const limitProvided = req.query.limit !== undefined;
        
        let useLimit = false;
        let safeLimit = 10000; // قيمة افتراضية كبيرة
        
        if (limitProvided) {
            // المستخدم حدد limit صراحةً
            useLimit = true;
            const limit = parseInt(req.query.limit, 10);
            safeLimit = Math.min(Math.max(limit, 1), 10000);
        } else if (!hasDateFilter) {
            // لا يوجد فلتر تاريخ ولم يتم تحديد limit → استخدام الافتراضي
            useLimit = true;
            safeLimit = 100;
        }
        // else: يوجد فلتر تاريخ ولم يتم تحديد limit → لا نستخدم limit
        
        // حساب التاريخ بناءً على الفترة المحددة
        if (period && !startDate && !endDate) {
            const now = new Date();
            
            switch (period) {
                case 'today':
                    const todayStart = new Date(now.setHours(0, 0, 0, 0));
                    const todayEnd = new Date(now.setHours(23, 59, 59, 999));
                    startDate = todayStart.toISOString().split('T')[0];
                    endDate = todayEnd.toISOString().split('T')[0];
                    break;
                    
                case 'last_week':
                    const lastWeek = new Date();
                    lastWeek.setDate(lastWeek.getDate() - 7);
                    startDate = lastWeek.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'last_month':
                    const lastMonth = new Date();
                    lastMonth.setMonth(lastMonth.getMonth() - 1);
                    startDate = lastMonth.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'last_3_months':
                    const last3Months = new Date();
                    last3Months.setMonth(last3Months.getMonth() - 3);
                    startDate = last3Months.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'last_6_months':
                    const last6Months = new Date();
                    last6Months.setMonth(last6Months.getMonth() - 6);
                    startDate = last6Months.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'last_year':
                    const lastYear = new Date();
                    lastYear.setFullYear(lastYear.getFullYear() - 1);
                    startDate = lastYear.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'current_month':
                    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                    startDate = firstDayOfMonth.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
                    
                case 'current_year':
                    const firstDayOfYear = new Date(now.getFullYear(), 0, 1);
                    startDate = firstDayOfYear.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                    break;
            }
        }
        
        // بناء شروط WHERE ديناميكية
        let whereConditions = ["st.Code IN ('12', '101', '102')"];
        let havingConditions = [];
        
        if (storeCodeFilter && ['12', '101', '102'].includes(storeCodeFilter)) {
            whereConditions.push(`st.Code = @storeCodeFilter`);
        }
        
        if (groupGuid) {
            whereConditions.push(`mt.GroupGUID = @groupGuid`);
        }
        
        if (search) {
            whereConditions.push(`(mt.Name LIKE @search OR mt.Code LIKE @search)`);
        }
        
        if (minQty > 0) {
            havingConditions.push(`SUM(mi.Qty) >= @minQty`);
        }
        
        // فلتر التاريخ
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
        
        // بناء الاستعلام مع أو بدون TOP
        const topClause = useLimit ? `TOP (@limit)` : '';
        
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
            SELECT ${topClause} *
            FROM MaterialsInStores
            WHERE store_qty > 0
            ORDER BY store_code, material_name
        `;
        
        let request = pool.request();
        
        // إضافة limit فقط إذا كان سيتم استخدامه
        if (useLimit) {
            request = request.input('limit', sql.Int, safeLimit);
        }
        
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
            message: 'تم جلب المواد حسب المستودعات بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                limit_applied: useLimit,
                limit_value: useLimit ? safeLimit : 'غير محدد',
                storeCode: storeCodeFilter || 'الكل',
                period: period || 'custom',
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
        const limitProvided = req.query.limit !== undefined;
        const limit = parseInt(req.query.limit, 10) || 10000;
        const safeLimit = Math.min(Math.max(limit, 1), 100000);
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
            // جلب المواد التي لها كمية أكبر من 0 فقط
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
        
        // استعلام محدث مع GROUP BY للحصول على جميع المواد
        const topClause = limitProvided ? `TOP (@limit)` : '';
        
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
            SELECT ${topClause} *
            FROM MaterialsInStore
            ${orderByClause}
        `;
        
        let request = pool.request()
            .input('storeCode', sql.NVarChar, storeCode);
        
        if (limitProvided) {
            request = request.input('limit', sql.Int, safeLimit);
        }
        
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
            message: 'تم جلب المواد بنجاح',
            timestamp: new Date().toISOString(),
            filters: {
                limit_applied: limitProvided,
                limit_value: limitProvided ? safeLimit : 'غير محدد',
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
 * Route تجريبي لجلب جميع المواد في المستودع (بدون فلاتر)
 * GET /api/database/materials-by-store/:storeCode/all
 */
router.get('/materials-by-store/:storeCode/all', async (req, res, next) => {
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
        
        // استعلام بسيط لجلب كل المواد
        const query = `
            SELECT 
                st.Code AS store_code,
                st.Name AS store_name,
                mt.Code AS material_code,
                mt.Name AS material_name,
                mt.Unity AS unity,
                ISNULL(SUM(mi.Qty), 0) AS store_qty
            FROM st000 st
            CROSS JOIN mt000 mt
            LEFT JOIN MI000 mi ON st.GUID = mi.StoreGUID AND mt.GUID = mi.MatGUID
            WHERE st.Code = @storeCode
            GROUP BY st.Code, st.Name, mt.Code, mt.Name, mt.Unity
            HAVING ISNULL(SUM(mi.Qty), 0) > 0
            ORDER BY mt.Name
        `;
        
        const result = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(query);
        
        res.json({
            success: true,
            message: 'تم جلب جميع المواد',
            store_code: storeCode,
            total_materials: result.recordset.length,
            materials: result.recordset
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * Route للتشخيص - فحص عدد المواد في كل جدول
 * GET /api/database/materials-diagnostic/:storeCode
 */
router.get('/materials-diagnostic/:storeCode', async (req, res, next) => {
    try {
        const { storeCode } = req.params;
        const pool = await getPool();
        
        // 1. عدد السجلات في MI000 للمستودع
        const mi000Count = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(`
                SELECT COUNT(*) AS count
                FROM MI000 mi
                INNER JOIN st000 st ON mi.StoreGUID = st.GUID
                WHERE st.Code = @storeCode
            `);
        
        // 2. عدد المواد المختلفة في MI000 للمستودع
        const uniqueMaterials = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(`
                SELECT COUNT(DISTINCT mi.MatGUID) AS count
                FROM MI000 mi
                INNER JOIN st000 st ON mi.StoreGUID = st.GUID
                WHERE st.Code = @storeCode
            `);
        
        // 3. إجمالي الكميات
        const totalQty = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(`
                SELECT SUM(mi.Qty) AS total_qty
                FROM MI000 mi
                INNER JOIN st000 st ON mi.StoreGUID = st.GUID
                WHERE st.Code = @storeCode
            `);
        
        // 4. عدد المواد في جدول mt000
        const mt000Count = await pool.request()
            .query(`SELECT COUNT(*) AS count FROM mt000`);
        
        // 5. عدد المواد ذات الكمية > 0
        const materialsWithQty = await pool.request()
            .input('storeCode', sql.NVarChar, storeCode)
            .query(`
                SELECT COUNT(DISTINCT mi.MatGUID) AS count
                FROM MI000 mi
                INNER JOIN st000 st ON mi.StoreGUID = st.GUID
                WHERE st.Code = @storeCode AND mi.Qty > 0
            `);
        
        res.json({
            success: true,
            store_code: storeCode,
            diagnostics: {
                total_transactions_in_MI000: mi000Count.recordset[0].count,
                unique_materials_in_MI000: uniqueMaterials.recordset[0].count,
                materials_with_quantity: materialsWithQty.recordset[0].count,
                total_quantity: totalQty.recordset[0].total_qty,
                total_materials_in_mt000: mt000Count.recordset[0].count
            }
        });
        
    } catch (error) {
        next(error);
    }
});





// // 1. جلب أول 50 مادة من جميع المستودعات
// GET /api/database/materials-by-stores?limit=50

// // 2. جلب مواد المستودع 102 فقط
// GET /api/database/materials-by-stores?storeCode=102

// // 3. جلب المواد حسب تاريخ الإنتاج
// GET /api/database/materials-by-stores?startDate=2024-01-01&endDate=2024-12-31

// // 4. البحث عن مادة معينة
// GET /api/database/materials-by-stores?search=كيتامين

// // 5. جلب المواد بكمية أكبر من 100
// GET /api/database/materials-by-stores?minQty=100

// // 6. دمج عدة فلاتر
// GET /api/database/materials-by-stores?storeCode=102&limit=20&minQty=50&search=فرو

// // 7. جلب مواد مستودع محدد مع ترتيب
// GET /api/database/materials-by-store/102?sortBy=qty&sortOrder=desc&limit=30


module.exports = router;