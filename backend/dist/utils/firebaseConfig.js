"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = void 0;
const admin = require('firebase-admin');
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const serviceAccountPath = path_1.default.resolve(__dirname, '../../firebase-adminsdk.json');
let isFirebaseInitialized = false;
if (fs_1.default.existsSync(serviceAccountPath)) {
    try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        isFirebaseInitialized = true;
        console.log('Firebase Admin SDK initialized.');
    }
    catch (error) {
        console.error('Failed to initialize Firebase Admin SDK:', error);
    }
}
else {
    console.warn(`Firebase Admin SDK key not found at ${serviceAccountPath}. Push notifications will be disabled.`);
}
const sendPushNotification = async (tokens, title, body, data) => {
    if (!isFirebaseInitialized || !tokens || tokens.length === 0)
        return;
    const validTokens = tokens.filter(t => t && t.trim() !== '');
    if (validTokens.length === 0)
        return;
    const message = {
        notification: { title, body },
        data: data || {},
        tokens: validTokens,
    };
    try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`Successfully sent message: ${response.successCount} messages were sent successfully`);
    }
    catch (error) {
        console.error('Error sending message:', error);
    }
};
exports.sendPushNotification = sendPushNotification;
