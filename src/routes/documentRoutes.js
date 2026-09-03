const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middlewares/auth');
const {
  uploadDocument,
  listDocuments,
  deleteDocument,
} = require('../controllers/documentController');
const env = require('../config/env');

const upload = multer({
  dest: env.uploads.dir,
  limits: { fileSize: env.uploads.maxMb * 1024 * 1024 },
});

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin'));

router.get('/', listDocuments);
router.post('/', upload.single('file'), uploadDocument);
router.delete('/:id', deleteDocument);

module.exports = router;
