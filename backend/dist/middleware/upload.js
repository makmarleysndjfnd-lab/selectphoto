"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const dir = path_1.default.join(__dirname, '../../uploads');
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const ext = path_1.default.extname(file.originalname) || '.png';
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    }
});
exports.upload = (0, multer_1.default)({ storage: storage });
