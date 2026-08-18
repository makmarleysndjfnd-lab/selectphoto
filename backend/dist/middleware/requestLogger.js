"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const path = req.path;
    res.on('finish', () => {
        const duration = Date.now() - start;
        const statusCode = res.statusCode;
        const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
        // Log estruturado sem expor payloads ou dados confidenciais
        const logMessage = `[${level}] ${method} ${path} -> ${statusCode} (${duration}ms)`;
        if (statusCode >= 500) {
            console.error(logMessage);
        }
        else if (statusCode >= 400) {
            console.warn(logMessage);
        }
        else if (process.env.NODE_ENV !== 'test') {
            console.log(logMessage);
        }
    });
    next();
}
