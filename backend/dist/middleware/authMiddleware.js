"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = exports.requireCompanyAdmin = exports.requireAdmin = exports.requireAdminOrSupervisor = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'Access token missing' });
        return;
    }
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            res.status(403).json({ error: 'Invalid token' });
            return;
        }
        req.user = user;
        next();
    });
};
exports.authenticateToken = authenticateToken;
// Middleware to check if user has Admin or Supervisor role
const requireAdminOrSupervisor = (req, res, next) => {
    if (req.user && (['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
        next();
    }
    else {
        res.status(403).json({ error: 'Forbidden: Requires Admin or Supervisor role' });
    }
};
exports.requireAdminOrSupervisor = requireAdminOrSupervisor;
const requireAdmin = (req, res, next) => {
    if (req.user && (['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
        next();
    }
    else {
        res.status(403).json({ error: 'Forbidden: Requires Admin role' });
    }
};
exports.requireAdmin = requireAdmin;
const requireCompanyAdmin = (req, res, next) => {
    if (req.user && (['COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
        next();
    }
    else {
        res.status(403).json({ error: 'Forbidden: Requires Company Admin role' });
    }
};
exports.requireCompanyAdmin = requireCompanyAdmin;
const requireSuperAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') {
        next();
    }
    else {
        res.status(403).json({ error: 'Forbidden: Requires Super Admin role' });
    }
};
exports.requireSuperAdmin = requireSuperAdmin;
