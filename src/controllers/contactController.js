import asyncHandler from '../utils/asyncHandler.js';
import ContactMessage from '../models/ContactMessage.js';
import { notifyAdmins } from '../utils/notify.js';

export const submitContact = asyncHandler(async (req, res) => {
  const { name, mobile, email, subject, message } = req.body;
  await ContactMessage.create({ name, mobile, email, subject, message, user: req.user?._id || null });
  notifyAdmins({
    type: 'admin_query',
    title: 'New contact query',
    message: `${name} sent a query${subject ? `: ${subject}` : ''}`,
    meta: { email },
    permission: 'messages',
  });
  res.status(201).json({
    success: true,
    message: "Thanks! We'll get back to you within 24 hours.",
  });
});
