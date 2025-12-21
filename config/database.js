require('dotenv').config();
const sql = require('mssql');

const config = {
    user: "sa",
    password: "SqlServer@2025",
    server: "172.18.0.2", 
    port: 1433,
    database: "AmnDb076",
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};



// Pool للاتصال
let pool = null;

/**
 * الحصول على اتصال بقاعدة البيانات
 */
const getPool = async () => {
    if (pool) return pool;

    try {
        pool = await sql.connect(config);
        console.log("✅ Connected to MSSQL");
        return pool;
    } catch (err) {
        console.error("❌ خطأ في الاتصال بقاعدة البيانات:", err.message);
        throw err;
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