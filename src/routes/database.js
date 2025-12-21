const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const xlsx = require('xlsx');

// تكوين multer لحفظ الملفات
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads', 'excel-reports');
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        // حفظ مؤقت بسيط
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        cb(null, `temp_${timestamp}_${random}.xlsx`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('يجب أن يكون الملف من نوع Excel (.xlsx أو .xls)'));
        }
    }
});

/**
 * رفع ملفات Excel للمستودعات
 * POST /api/excel/upload-reports
 * يقوم بحذف الملفات القديمة واستبدالها بالجديدة
 */
router.post('/upload-reports', upload.array('files', 10), async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع أي ملفات'
            });
        }

        const uploadDir = path.join(__dirname, 'uploads', 'excel-reports');

        // 1. حذف جميع الملفات القديمة (فقط ملفات warehouse_*)
        try {
            const oldFiles = await fs.readdir(uploadDir);
            for (const file of oldFiles) {
                if (file.startsWith('warehouse_')) {
                    await fs.unlink(path.join(uploadDir, file));
                }
            }
        } catch (err) {
            console.log('لا توجد ملفات قديمة للحذف');
        }

        // 2. قراءة ومعالجة الملفات الجديدة
        const uploadedFiles = [];
        const fsSync = require('fs'); // استخدام fs العادي للقراءة
        
        for (const file of req.files) {
            try {
                // قراءة محتوى الملف لتحديد نوع المستودع
                const workbook = xlsx.readFile(file.path);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

                let newName = '';
                
                // فحص الصف الثاني للحصول على معلومات المستودع
                if (data.length > 1 && data[1].length > 2) {
                    const storeInfo = String(data[1][2] || '');
                    
                    if (storeInfo.includes('الجاهزة') || storeInfo.includes('جاهز')) {
                        newName = 'warehouse_12.xlsx';
                    } else if (storeInfo.includes('الفعالة') || storeInfo.includes('فعال')) {
                        newName = 'warehouse_102.xlsx';
                    } else if (storeInfo.includes('المساعدة') || storeInfo.includes('مساعد')) {
                        newName = 'warehouse_101.xlsx';
                    }
                }

                // إذا لم يتم التعرف على المستودع، استخدم اسم الملف الأصلي
                if (!newName) {
                    const originalName = file.originalname;
                    if (originalName.includes('جاهز') || originalName.includes('جاهزة')) {
                        newName = 'warehouse_12.xlsx';
                    } else if (originalName.includes('فعال') || originalName.includes('فعالة')) {
                        newName = 'warehouse_102.xlsx';
                    } else if (originalName.includes('مساعد') || originalName.includes('مساعدة')) {
                        newName = 'warehouse_101.xlsx';
                    } else {
                        newName = `warehouse_${Date.now()}.xlsx`;
                    }
                }

                const newPath = path.join(uploadDir, newName);
                
                // نسخ الملف بدلاً من إعادة التسمية
                const fileBuffer = await fs.readFile(file.path);
                await fs.writeFile(newPath, fileBuffer);
                
                // حذف الملف المؤقت
                await fs.unlink(file.path);

                uploadedFiles.push({
                    original_name: file.originalname,
                    saved_name: newName,
                    path: newPath,
                    size: file.size,
                    upload_date: new Date().toISOString()
                });

            } catch (fileError) {
                console.error('خطأ في معالجة الملف:', fileError);
                // محاولة حذف الملف المؤقت في حالة الخطأ
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    // تجاهل خطأ الحذف
                }
            }
        }

        // 3. حذف أي ملفات مؤقتة متبقية
        try {
            const remainingFiles = await fs.readdir(uploadDir);
            for (const file of remainingFiles) {
                if (file.startsWith('temp_')) {
                    await fs.unlink(path.join(uploadDir, file));
                }
            }
        } catch (cleanupErr) {
            console.log('تنظيف الملفات المؤقتة');
        }

        res.json({
            success: true,
            message: 'تم رفع الملفات بنجاح واستبدال الملفات القديمة',
            count: uploadedFiles.length,
            files: uploadedFiles
        });

    } catch (error) {
        next(error);
    }
});

/**
 * جلب المواد من ملفات Excel حسب المستودعات
 * GET /api/excel/materials-by-stores
 * يقرأ فقط من الملفات الثابتة: warehouse_12.xlsx, warehouse_101.xlsx, warehouse_102.xlsx
 */
router.get('/materials-by-stores', async (req, res, next) => {
    try {
        const uploadDir = path.join(__dirname, 'uploads', 'excel-reports');
        
        // التحقق من وجود المجلد
        try {
            await fs.access(uploadDir);
        } catch {
            return res.json({
                success: true,
                message: 'لا توجد ملفات مرفوعة',
                timestamp: new Date().toISOString(),
                total_stores: 0,
                total_materials: 0,
                stores: []
            });
        }

        // الملفات الثابتة المتوقعة
        const warehouseFiles = [
            { filename: 'warehouse_12.xlsx', code: '12', name: 'مستودع المواد الجاهزة' },
            { filename: 'warehouse_101.xlsx', code: '101', name: 'مستودع المواد الاولية المساعدة' },
            { filename: 'warehouse_102.xlsx', code: '102', name: 'مستودع المواد الاولية الفعالة' }
        ];

        const stores = [];
        
        for (const warehouseFile of warehouseFiles) {
            const filePath = path.join(uploadDir, warehouseFile.filename);
            
            try {
                // التحقق من وجود الملف
                await fs.access(filePath);
                
                // قراءة الملف
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

                // استخراج المواد (تبدأ من الصف 3، index 3)
                const materials = [];
                let totalQuantity = 0;

                for (let i = 3; i < data.length; i++) {
                    const row = data[i];
                    
                    // التحقق من وجود بيانات في الصف
                    if (!row || row.length < 3) continue;
                    
                    const materialName = String(row[1] || '').trim();
                    const quantity = parseFloat(row[2]) || 0;
                    
                    // تجاهل الصفوف الفارغة أو رؤوس الأعمدة
                    if (!materialName || materialName === '' || materialName === 'اسم المادة') {
                        continue;
                    }

                    materials.push({
                        code: String(row[0] || ''),
                        name: materialName,
                        quantity: quantity,
                        unity: 'وحدة'
                    });

                    totalQuantity += quantity;
                }

                // إضافة المستودع إلى القائمة
                stores.push({
                    code: warehouseFile.code,
                    name: warehouseFile.name,
                    guid: null,
                    materials_count: materials.length,
                    total_quantity: totalQuantity,
                    materials: materials,
                    source_file: warehouseFile.filename
                });

            } catch (fileError) {
                // الملف غير موجود - تجاهله
                console.log(`الملف ${warehouseFile.filename} غير موجود`);
            }
        }

        res.json({
            success: true,
            message: 'تم جلب المواد من ملفات Excel بنجاح',
            timestamp: new Date().toISOString(),
            total_stores: stores.length,
            total_materials: stores.reduce((sum, store) => sum + store.materials_count, 0),
            stores: stores
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;