import path from 'path';
import fs from 'fs';
import { isExternalServicesDisabled, recordMockPush } from './externalServices';

let admin: any = null;
let isFirebaseInitialized = false;

const serviceAccountPath = path.resolve(__dirname, '../../firebase-adminsdk.json');

if (!isExternalServicesDisabled() && fs.existsSync(serviceAccountPath)) {
  try {
    const firebaseAdmin = require('firebase-admin');
    const serviceAccount = require(serviceAccountPath);
    if (firebaseAdmin && firebaseAdmin.credential) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount)
      });
      admin = firebaseAdmin;
      isFirebaseInitialized = true;
      console.log('Firebase Admin SDK initialized.');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
  }
} else if (!isExternalServicesDisabled()) {
  console.warn(`Firebase Admin SDK key not found at ${serviceAccountPath}. Push notifications will be disabled.`);
}

export const sendPushNotification = async (tokens: string[], title: string, body: string, data?: any) => {
  if (isExternalServicesDisabled()) {
    recordMockPush(tokens, title, body, data);
    return;
  }

  if (!isFirebaseInitialized || !admin || !tokens || tokens.length === 0) return;

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
