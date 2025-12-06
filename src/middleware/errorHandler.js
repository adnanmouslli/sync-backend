/**
 * Middleware للتعامل مع الأخطاء
 */
const errorHandler = (err, req, res, next) => {
    console.error('❌ خطأ:', err);

    const statusCode = err.statusCode || 500;
    
    res.status(statusCode).json({
        success: false,
        message: err.message || 'خطأ في الخادم',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

/**
 * Middleware للتعامل مع الطرق غير الموجودة
 */
const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `الطريق ${req.originalUrl} غير موجود`
    });
};

/**
 * Middleware لتسجيل الطلبات
 */
const logger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
    });
    
    next();
};

module.exports = {
    errorHandler,
    notFound,
    logger
};