const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} = require('../controllers/clientController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin', 'staff'));

router.get('/', listClients);
router.get('/:id', getClient);
router.post('/', authorize('super_admin', 'admin'), createClient);
router.patch('/:id', updateClient);
router.delete('/:id', authorize('super_admin', 'admin'), deleteClient);

module.exports = router;
