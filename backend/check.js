const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.personalAppointment.findMany().then(console.log).catch(console.error).finally(()=>prisma.$disconnect());
