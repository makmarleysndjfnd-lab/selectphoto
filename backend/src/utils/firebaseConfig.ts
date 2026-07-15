const admin = require('firebase-admin');
import path from 'path';
import fs from 'fs';

const serviceAccountPath = path.resolve(__dirname, '../../firebase-adminsdk.json');

let isFirebaseInitialized = false;

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseInitialized = true;
    console.log('Firebase Admin SDK initialized.');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
  }
} else {
  console.warn(`Firebase Admin SDK key not found at ${serviceAccountPath}. Push notifications will be disabled.`);
}

export const sendPushNotification = async (tokens: string[], title: string, body: string, data?: any) => {
  if (!isFirebaseInitialized || !tokens || tokens.length === 0) return;

  const validTokens = tokens.filter(t => t && t.trim() !== '');
  if (validTokens.length === 0) return;

  const message = {
    notification: { title, body },
    data: data || {},
    tokens: validTokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log(`Successfully sent message: ${response.successCount} messages were sent successfully`);
  } catch (error) {
    console.error('Error sending message:', error);
  }
};
