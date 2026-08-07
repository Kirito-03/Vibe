"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebase_1 = require("../firebase");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// Verify Firebase token and create/update user in DB
router.post('/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { token } = req.body;
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    try {
        const decodedToken = yield firebase_1.admin.auth().verifyIdToken(token);
        const { uid, email } = decodedToken;
        // Check if user exists in our DB
        let user = yield db_1.default.query('SELECT * FROM Users WHERE firebase_uid = $1', [uid]);
        if (user.rows.length === 0) {
            // If not, create a new user
            const newUser = yield db_1.default.query('INSERT INTO Users (firebase_uid, email) VALUES ($1, $2) RETURNING id, email, firebase_uid', [uid, email]);
            user = newUser;
        }
        res.status(200).json(user.rows[0]);
    }
    catch (error) {
        console.error('Firebase token verification failed:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}));
exports.default = router;
