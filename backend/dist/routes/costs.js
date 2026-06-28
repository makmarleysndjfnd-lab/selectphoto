"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Submit a new cost (via Mobile App)
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { amount, category, subcategory, carId, description, paymentMethod, receiptUrl } = req.body;
        // Validate carId format (UUID) - if it's mock, ignore it
        let validCarId = carId;
        if (carId && carId.startsWith('car_'))
            validCarId = null;
        const cost = await prisma.cost.create({
            data: {
                userId: req.user.id,
                teamId: req.user.teamId || null,
                amount: parseFloat(amount),
                category,
                subcategory: subcategory || null,
                carId: validCarId || null,
                description,
                paymentMethod: paymentMethod || 'CASH',
                receiptUrl,
                status: 'PENDING',
                companyId: req.user.companyId
            }
        });
        res.status(201).json(cost);
    }
    catch (error) {
        console.error('Error saving cost:', error);
        res.status(500).json({ error: 'Failed to save cost' });
    }
});
exports.default = router;
