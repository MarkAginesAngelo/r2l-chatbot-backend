const express = require('express');
const authRoutes = require('./authRoutes');
const chatRoutes = require('./chatRoutes');
const documentRoutes = require('./documentRoutes');
const clientRoutes = require('./clientRoutes');
const leadRoutes = require('./leadRoutes');
const conversationRoutes = require('./conversationRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const settingsRoutes = require('./settingsRoutes');
const handoffRoutes = require('./handoffRoutes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/chat', chatRoutes);
router.use('/documents', documentRoutes);
router.use('/clients', clientRoutes);
router.use('/leads', leadRoutes);
router.use('/conversations', conversationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/settings', settingsRoutes);
router.use('/handoffs', handoffRoutes);

// TODO (Week 4): whatsappWebhookRoutes, messengerWebhookRoutes

module.exports = router;
