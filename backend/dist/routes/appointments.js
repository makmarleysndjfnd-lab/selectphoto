"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Criar um agendamento pessoal
router.post('/', async (req, res) => {
    try {
        const { sellerId, title, description, dateTime } = req.body;
        if (!sellerId || !title || !dateTime) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const appointment = await prisma.personalAppointment.create({
            data: {
                sellerId,
                title,
                description,
                dateTime: new Date(dateTime),
            },
        });
        res.json(appointment);
    }
    catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});
// Listar agendamentos pessoais de um vendedor (opcionalmente filtrados por data/mes)
router.get('/seller/:sellerId', async (req, res) => {
    try {
        const { sellerId } = req.params;
        const { date, month, year } = req.query; // params opicionais
        let whereClause = { sellerId };
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            whereClause.dateTime = {
                gte: startOfDay,
                lte: endOfDay,
            };
        }
        else if (month && year) {
            const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
            const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
            whereClause.dateTime = {
                gte: startOfMonth,
                lte: endOfMonth,
            };
        }
        const appointments = await prisma.personalAppointment.findMany({
            where: whereClause,
            orderBy: { dateTime: 'asc' },
        });
        res.json(appointments);
    }
    catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});
// Atualizar um agendamento
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, dateTime } = req.body;
        const dataToUpdate = {};
        if (title)
            dataToUpdate.title = title;
        if (description !== undefined)
            dataToUpdate.description = description;
        if (dateTime)
            dataToUpdate.dateTime = new Date(dateTime);
        const appointment = await prisma.personalAppointment.update({
            where: { id },
            data: dataToUpdate,
        });
        res.json(appointment);
    }
    catch (error) {
        console.error('Error updating appointment:', error);
        res.status(500).json({ error: 'Failed to update appointment' });
    }
});
// Deletar um agendamento
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.personalAppointment.delete({
            where: { id },
        });
        res.json({ message: 'Appointment deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting appointment:', error);
        res.status(500).json({ error: 'Failed to delete appointment' });
    }
});
exports.default = router;
