import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import User from '../models/User.js';

export const protectAdmin = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const protectUser = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Clients may stay logged in on web + mobile at the same time (no single-device enforcement).

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const generateToken = (id, sessionToken = null) => {
  const secret = process.env.JWT_SECRET;
  if (!secret || String(secret).trim() === '') {
    throw new Error(
      'JWT_SECRET is missing. Add JWT_SECRET to server/.env (see .env.example). Admin/user login cannot issue tokens without it.'
    );
  }
  const payload = { id };
  if (sessionToken) {
    payload.sessionToken = sessionToken;
  }
  return jwt.sign(payload, secret, { expiresIn: '30d' });
};

// Generate a unique session token
export const generateSessionToken = () => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;
};

export const superAdminOnly = (req, res, next) => {
  if (req.admin && req.admin.role === 'SUPER_ADMIN') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Super Admin only.' });
  }
};
