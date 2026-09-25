const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  channel: z.enum(['website', 'whatsapp', 'messenger']).optional().default('website'),
});

const clientCreateSchema = z.object({
  name: z.string().max(150).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  location: z.string().max(150).optional(),
  preferredLanguage: z.enum(['en', 'si', 'ta']).optional().default('en'),
  notes: z.string().optional(),
});

const clientUpdateSchema = clientCreateSchema.partial();

const leadCreateSchema = z.object({
  clientId: z.string().uuid().optional(),
  source: z.enum(['website', 'whatsapp', 'messenger']),
  requestType: z.string().max(100).optional(),
});

const leadStatusSchema = z.object({
  status: z.enum(['new', 'in_progress', 'closed']),
});

const conversationStatusSchema = z.object({
  status: z.enum(['open', 'needs_human', 'resolved', 'closed']),
});

const staffReplySchema = z.object({
  content: z.string().min(1).max(4000),
});

const settingUpdateSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.any())]),
});

module.exports = {
  loginSchema,
  refreshSchema,
  chatSchema,
  clientCreateSchema,
  clientUpdateSchema,
  leadCreateSchema,
  leadStatusSchema,
  conversationStatusSchema,
  staffReplySchema,
  settingUpdateSchema,
};
