"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
// This endpoint returns the latest available app version and the download URL.
router.get('/version', (req, res) => {
    // In a real production system, this could be stored in the DB or env vars.
    // We can read from a simple config file or hardcode for now.
    const latestVersion = '1.0.1'; // Update this whenever a new APK is uploaded
    const apkFileName = 'app-release.apk';
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/app/download`;
    res.json({
        version: latestVersion,
        mandatory: false,
        downloadUrl
    });
});
// Endpoint to actually download the APK
router.get('/download', (req, res) => {
    // We assume the APK is placed in a "public/apk" directory in the backend
    const apkPath = path_1.default.join(__dirname, '../../public/apk/app-release.apk');
    if (fs_1.default.existsSync(apkPath)) {
        res.download(apkPath);
    }
    else {
        res.status(404).json({ error: 'APK not found on server' });
    }
});
exports.default = router;
