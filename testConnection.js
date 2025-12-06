const { getPool, closePool } = require('./config/database');

/**
 * اختبار الاتصال بقاعدة البيانات
 */
const testConnection = async () => {
    try {
        console.log('🔄 جاري الاتصال بقاعدة البيانات...');
        
        const pool = await getPool();
        
        // استعلام بسيط للتأكد من الاتصال
        const result = await pool.request().query('SELECT DB_NAME() AS DatabaseName, GETDATE() AS CurrentTime');
        
        console.log('📊 معلومات الاتصال:');
        console.log('   - اسم قاعدة البيانات:', result.recordset[0].DatabaseName);
        console.log('   - الوقت الحالي:', result.recordset[0].CurrentTime);
        
        // جلب قائمة الجداول
        const tables = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);
        
        console.log('\n📋 الجداول المتاحة:');
        tables.recordset.forEach((table, index) => {
            console.log(`   ${index + 1}. ${table.TABLE_NAME}`);
        });
        
        console.log('\n✅ الاتصال ناجح!');
        
        await closePool();
        
    } catch (error) {
        console.error('❌ فشل الاتصال:', error.message);
        process.exit(1);
    }
};

// تشغيل الاختبار
testConnection();