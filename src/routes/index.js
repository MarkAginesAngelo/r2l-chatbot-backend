const express = require('express');
const authRoutes = require('./authRoutes');
const chatRoutes = require('./chatRoutes');
const documentRoutes = require('./documentRoutes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/chat', chatRoutes);
router.use('/documents', documentRoutes);

// TODO (Week 3-4): conversationRoutes, clientRoutes, leadRoutes, handoffRoutes,
// analyticsRoutes, whatsappWebhookRoutes, messengerWebhookRoutes, settingsRoutes

module.exports = router;
