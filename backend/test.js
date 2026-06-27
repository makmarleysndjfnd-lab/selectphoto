const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findUnique({where: {email: 'admin@selectphoto.com.br'}}).then(console.log).finally(() => prisma.$disconnect());
