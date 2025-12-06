// const sql = require('mssql');
require('dotenv').config();
const sql = require('mssql/msnodesqlv8');


const config = {
    server: 'localhost\\SQLEXPRESS',
    database: 'hr_arabic',
    driver: 'ODBC Driver 17 for SQL Server',
    options: {
        trustedConnection: true
    }
};





// Pool للاتصال
let pool = null;

/**
 * الحصول على اتصال بقاعدة البيانات
 */
const getPool = async () => {
    try {
        if (pool) {
            return pool;
        }
        
        pool = await sql.connect(config);
        console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
        
        return pool;
    } catch (error) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', error.message);
        throw error;
    }
};

/**
 * إغلاق الاتصال
 */
const closePool = async () => {
    try {
        if (pool) {
            await pool.close();
            pool = null;
            console.log('✅ تم إغلاق الاتصال بقاعدة البيانات');
        }
    } catch (error) {
        console.error('❌ خطأ في إغلاق الاتصال:', error.message);
    }
};

module.exports = {
    sql,
    getPool,
    closePool,
    config
};