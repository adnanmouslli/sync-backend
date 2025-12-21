const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getPool, closePool } = require('../config/database');
const { errorHandler, notFound, logger } = require('./middleware/errorHandler');

// Routes
const databaseRoutes = require('./routes/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger);

// Routes
app.use('/api/excel', databaseRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// بدء الخادم
const startServer = async () => {
    try {
        // الاتصال بقاعدة البيانات
        console.log('🔄 جاري الاتصال بقاعدة البيانات...');
        await getPool();
        
        // بدء الخادم
        app.listen(PORT, () => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`✅ server running on ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`📊 API Docs: http://localhost:${PORT}/api`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });
        
    } catch (error) {
        console.error('❌ فشل بدء الخادم:', error.message);
        process.exit(1);
    }
};

// معالجة الإغلاق
process.on('SIGINT', async () => {
    console.log('\n🔄 جاري إيقاف الخادم...');
    await closePool();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 جاري إيقاف الخادم...');
    await closePool();
    process.exit(0);
});

// بدء التشغيل
startServer();

module.exports = app;