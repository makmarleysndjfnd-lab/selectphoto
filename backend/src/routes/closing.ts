import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Get Daily Closing for a Seller
router.get('/daily/:sellerId', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sellerId } = req.params;
        const dateParam = req.query.date as string; // Optional specific date

        let startDate = new Date();
        let endDate = new Date();
        
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }

        // Rule: 23:00 previous day to 22:59 current day
        // For simplicity, we assume the 'date' refers to the day it ends
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(23, 0, 0, 0);

        endDate.setHours(22, 59, 59, 999);

        // Fetch sales
        const sales = await prisma.sale.findMany({
            where: {
                sellerId: sellerId as string,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: { client: true }
        });

        // Fetch non-sales
        const nonSales = await prisma.nonSale.findMany({
            where: {
                sellerId: sellerId as string,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: { client: true }
        });

        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const cashValue = sales.filter(s => s.paymentMethod === 'CASH').reduce((acc, curr) => acc + curr.value, 0);
        const pixValue = sales.filter(s => s.paymentMethod === 'PIX').reduce((acc, curr) => acc + curr.value, 0);
        const debitValue = sales.filter(s => s.paymentMethod === 'DEBIT').reduce((acc, curr) => acc + curr.value, 0);
        const creditValue = sales.filter(s => s.paymentMethod === 'CREDIT').reduce((acc, curr) => acc + curr.value, 0);

        // Commission
        const seller = await prisma.user.findUnique({ where: { id: sellerId as string } });
        const commissionPercentage = seller?.usesOwnCar ? 0.25 : 0.20;
        const commission = totalSalesValue * commissionPercentage;

        // Repasse Debt: if cash > commission, seller owes the company
        const repasseDebt = cashValue > commission ? (cashValue - commission) : 0;

        // Also fetch previous unpaid repasses (historical)
        const previousClosings = await prisma.dailyClosing.findMany({
            where: { sellerId: sellerId as string }
        });
        const totalHistoricalDebt = previousClosings.reduce((acc, curr) => acc + curr.repasseDebt, 0);

        res.json({
            startDate,
            endDate,
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalSalesValue,
            cashValue,
            pixValue,
            debitValue,
            creditValue,
            commission,
            commissionPercentage,
            repasseDebt,
            totalHistoricalDebt,
            sales,
            nonSales
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin saves/generates the repasse debt permanently for a day
router.post('/daily', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sellerId, totalSalesValue, cashValue, pixValue, debitValue, creditValue, commission, repasseDebt } = req.body;

        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: parseFloat(totalSalesValue),
                cashValue: parseFloat(cashValue),
                pixValue: parseFloat(pixValue),
                debitValue: parseFloat(debitValue),
                creditValue: parseFloat(creditValue),
                commission: parseFloat(commission),
                repasseDebt: parseFloat(repasseDebt)
            }
        });

        res.status(201).json(closing);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Pay/Clear repasse
router.post('/pay-repasse', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sellerId, amount } = req.body;
        // Negative repasseDebt represents a payment reducing the total debt
        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: 0,
                cashValue: 0,
                pixValue: 0,
                debitValue: 0,
                creditValue: 0,
                commission: 0,
                repasseDebt: -parseFloat(amount) // Deducts from total debt
            }
        });

        res.status(201).json(closing);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Photographer Closing
router.get('/photographer/:photographerId', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { photographerId } = req.params;
        const dateParam = req.query.date as string;

        let startDate = new Date();
        let endDate = new Date();
        
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }

        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        const books = await prisma.bookBatch.findMany({
            where: {
                photographerId: photographerId as string,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        });

        // Sum photos taken in those books (if books have quantities) or just count books
        res.json({
            booksCount: books.length,
            books
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Custom Metrics Overview (by Date Range and Sellers)
router.get('/custom', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const sellerIdsStr = req.query.sellerIds as string;
        const startDateParam = req.query.startDate as string;
        const endDateParam = req.query.endDate as string;

        let whereSale: any = {};
        let whereNonSale: any = {};

        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }

        if (startDateParam && endDateParam) {
            const startDate = new Date(startDateParam);
            const endDate = new Date(endDateParam);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const sales = await prisma.sale.findMany({ where: whereSale });
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });

        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const totalFichas = sales.length + nonSales.length;
        const averageTicket = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0;

        res.json({
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// City Closing
router.get('/city/:city', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { city } = req.params;
        const sellerIdsStr = req.query.sellerIds as string;
        const dateParam = req.query.date as string;

        let whereSale: any = { city };
        let whereNonSale: any = { client: { city } };

        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }

        if (dateParam) {
            const startDate = new Date(dateParam);
            const endDate = new Date(dateParam);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const sales = await prisma.sale.findMany({ where: whereSale });
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });

        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const totalFichas = sales.length + nonSales.length;
        const averageTicket = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0;

        res.json({
            city,
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
