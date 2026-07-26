import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendPushNotification } from '../utils/firebaseConfig';
import { s3 } from '../middleware/upload';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

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

// Solicita o preenchimento do KM toda segunda-feira às 20h
export const requestWeeklyKm = async () => {
  try {
    console.log('[CRON] Iniciando solicitação semanal de KM...');
    
    // Find all users who have an assigned car and usesOwnCar = false
    const cars = await prisma.car.findMany({
      where: {
        status: { not: 'INACTIVE' },
        currentUserId: { not: null }
      },
      include: {
        currentUser: true
      }
    });

    for (const car of cars) {
      if (car.currentUser && car.currentUser.usesOwnCar === false) {
        const title = `Atualização de Quilometragem`;
        const message = `Por favor, informe a quilometragem atual do veículo ${car.plate}.`;
        
        // Avoid creating a new one if there's already a pending KM_REQUEST
        const pendingReq = await prisma.notification.findFirst({
          where: {
            recipientId: car.currentUser.id,
            type: 'KM_REQUEST',
            status: { not: 'RESOLVED' }
          }
        });

        if (!pendingReq) {
          await prisma.notification.create({
            data: {
              title,
              message,
              type: 'KM_REQUEST',
              status: 'UNREAD',
              recipientId: car.currentUser.id,
              companyId: car.companyId,
              actionData: { carId: car.id }
            }
          });

          if (car.currentUser.fcmToken) {
            await sendPushNotification(
              [car.currentUser.fcmToken],
              title,
              message,
              { type: 'KM_REQUEST', carId: car.id }
            );
          }
          console.log(`[CRON] KM_REQUEST criado para usuário ${car.currentUser.name} (Carro: ${car.plate}).`);
        }
      }
    }
    console.log('[CRON] Solicitação semanal de KM finalizada.');
  } catch (error) {
    console.error('[CRON] Erro na solicitação semanal de KM:', error);
  }
};

// Verifica se há pedidos de KM atrasados (mais de 2 dias)
export const checkOverdueKmRequests = async () => {
  try {
    console.log('[CRON] Verificando atrasos na resposta do KM...');
    
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const pendingRequests = await prisma.notification.findMany({
      where: {
        type: 'KM_REQUEST',
        status: { not: 'RESOLVED' },
        createdAt: { lt: twoDaysAgo }
      },
      include: {
        recipient: true
      }
    });

    if (pendingRequests.length > 0) {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' }
      });

      for (const req of pendingRequests) {
        const title = `Atraso no KM: ${req.recipient.name}`;
        const message = `O funcionário ${req.recipient.name} está há mais de 2 dias sem preencher o KM. O aplicativo dele foi bloqueado.`;
        
        // Ensure we don't spam the admins every day for the same overdue request
        // Create an info notification for admins
        const adminAlertKey = `OVERDUE_KM_${req.id}`;
        
        for (const admin of admins) {
          const alreadyAlerted = await prisma.notification.findFirst({
            where: {
              title,
              recipientId: admin.id,
              createdAt: { gt: twoDaysAgo } // Only alert once every 2 days per pending request
            }
          });
          
          if (!alreadyAlerted) {
            await prisma.notification.create({
              data: {
                title,
                message,
                type: 'INFO',
                status: 'UNREAD',
                recipientId: admin.id,
                companyId: admin.companyId
              }
            });
            if (admin.fcmToken) {
              await sendPushNotification(
                [admin.fcmToken],
                title,
                message,
                { type: 'INFO' }
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[CRON] Erro ao verificar atrasos de KM:', error);
  }
};

export const cleanOldCostPhotos = async () => {
  try {
    console.log('[CRON] Iniciando limpeza de comprovantes antigos...');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const oldCosts = await prisma.cost.findMany({
      where: {
        createdAt: { lt: ninetyDaysAgo },
        receiptUrl: { not: null }
      }
    });

    for (const cost of oldCosts) {
      if (!cost.receiptUrl) continue;
      
      try {
        const urlObj = new URL(cost.receiptUrl);
        // Usually backblaze URLs are like https://<endpoint>/<bucket>/<key> or https://<bucket>.<endpoint>/<key>
        // But since we use s3 client, key is just the file name. Let's extract the last path segment:
        const key = urlObj.pathname.split('/').pop();
        
        if (key) {
          const command = new DeleteObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
            Key: key
          });
          await s3.send(command);
          console.log(`[CRON] Deletado do S3: ${key}`);
          
          await prisma.cost.update({
            where: { id: cost.id },
            data: { receiptUrl: null }
          });
        }
      } catch (err) {
        console.error(`[CRON] Falha ao deletar foto do custo ${cost.id}:`, err);
      }
    }
  } catch (error) {
    console.error('[CRON] Erro ao limpar comprovantes antigos:', error);
  }
};

// Start the cron job
export const initWarrantyCron = () => {
  // Check warranties and overdue KMs every day at 08:00 AM
  cron.schedule('0 8 * * *', () => {
    checkWarranties();
    checkOverdueKmRequests();
  }, {
    timezone: "America/Sao_Paulo"
  });
  console.log('⏳ Cron job diário agendado para 08:00 AM (BRT).');

  // Request weekly KM every Monday at 20:00
  cron.schedule('0 20 * * 1', () => {
    requestWeeklyKm();
  }, {
    timezone: "America/Sao_Paulo"
  });
  console.log('⏳ Cron job semanal (KM) agendado para Segunda-feira às 20:00 (BRT).');
  
  // Clean old receipts every Sunday at 02:00 AM
  cron.schedule('0 2 * * 0', () => {
    cleanOldCostPhotos();
  }, {
    timezone: "America/Sao_Paulo"
  });
  console.log('⏳ Cron job de limpeza de comprovantes agendado para Domingo às 02:00 AM (BRT).');
};
