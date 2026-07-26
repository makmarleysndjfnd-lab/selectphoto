import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendPushNotification } from '../utils/firebaseConfig';

const prisma = new PrismaClient();

// This function checks the cars and generates notifications
export const checkWarranties = async () => {
  try {
    console.log('[CRON] Iniciando verificação de garantias/trocas de óleo...');
    
    // Fetch all active cars that have some text in warrantyParts
    const cars = await prisma.car.findMany({
      where: {
        status: { not: 'INACTIVE' }
      },
      include: {
        currentUser: true // to get the fcmToken of the current user
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight

    // Get all admin users to send them notifications
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' }
    });

    for (const car of cars) {
      // -- 1. WARRANTY TEXT CHECK --
      if (car.warrantyParts) {
        const warrantyText = car.warrantyParts.toLowerCase();
        // Look for "proxima troca " or "próxima troca " followed by DD/MM/YYYY
        const regex = /pr[oó]xima troca (\d{2})\/(\d{2})\/(\d{4})/g;
        
        let match;
        while ((match = regex.exec(warrantyText)) !== null) {
          const day = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1; // 0-indexed
          const year = parseInt(match[3], 10);
          
          const targetDate = new Date(year, month, day);
          targetDate.setHours(0, 0, 0, 0);
          
          const diffTime = targetDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays === 7 || diffDays === 0) {
            const statusText = diffDays === 0 ? 'HOJE' : 'em 7 dias';
            const title = `Aviso de Manutenção: ${car.plate}`;
            const message = `A manutenção/troca do veículo ${car.plate} (${car.model}) vence ${statusText} (${match[1]}/${match[2]}/${match[3]}).`;
            
            const recipients = [...admins];
            if (car.currentUser) {
              if (!recipients.some(a => a.id === car.currentUser!.id)) {
                recipients.push(car.currentUser);
              }
            }

            for (const recipient of recipients) {
              await prisma.notification.create({
                data: {
                  title,
                  message,
                  type: 'INFO',
                  status: 'UNREAD',
                  recipientId: recipient.id,
                  companyId: recipient.companyId
                }
              });

              if (recipient.fcmToken) {
                await sendPushNotification(
                  [recipient.fcmToken],
                  title,
                  message,
                  { type: 'INFO', carId: car.id }
                );
              }
            }
            
            console.log(`[CRON] Notificação gerada para carro ${car.plate} (vence em ${diffDays} dias).`);
          }
        }
      }
      
      // -- 2. KM CHECK FOR OIL CHANGE --
      if (car.nextOilChangeKm && car.nextOilChangeKm > 0) {
        const diffKm = car.nextOilChangeKm - car.currentKm;
        
        if (diffKm <= 1000) {
          const isOverdue = diffKm <= 0;
          const statusText = isOverdue ? 'VENCIDA (ou atingida)' : `faltam ${diffKm} km`;
          const title = `Troca de Óleo: ${car.plate}`;
          const message = `A troca de óleo do veículo ${car.plate} (${car.model}) está ${statusText}. Alvo: ${car.nextOilChangeKm} km.`;
          
          const lastNotification = await prisma.notification.findFirst({
            where: {
              title,
              message,
            },
            orderBy: { createdAt: 'desc' }
          });
          
          if (!lastNotification) {
            const recipients = [...admins];
            if (car.currentUser && !recipients.some(a => a.id === car.currentUser!.id)) {
              recipients.push(car.currentUser);
            }
            
            for (const recipient of recipients) {
              await prisma.notification.create({
                data: {
                  title,
                  message,
                  type: 'INFO',
                  status: 'UNREAD',
                  recipientId: recipient.id,
                  companyId: recipient.companyId
                }
              });

              if (recipient.fcmToken) {
                await sendPushNotification(
                  [recipient.fcmToken],
                  title,
                  message,
                  { type: 'INFO', carId: car.id }
                );
              }
            }
            console.log(`[CRON] Notificação de Óleo gerada para carro ${car.plate} (Diff: ${diffKm} km).`);
          }
        }
      }
    }
    
    console.log('[CRON] Verificação de garantias/trocas finalizada.');
  } catch (error) {
    console.error('[CRON] Erro ao verificar garantias:', error);
  }
};

// Start the cron job
// Run every day at 08:00 AM
export const initWarrantyCron = () => {
  cron.schedule('0 8 * * *', () => {
    checkWarranties();
  }, {
    timezone: "America/Sao_Paulo"
  });
  console.log('⏳ Cron job de garantia agendado para 08:00 AM (BRT).');
};
