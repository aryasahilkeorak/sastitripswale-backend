import asyncHandler from '../utils/asyncHandler.js';
import ContactMessage from '../models/ContactMessage.js';

export const submitContact = asyncHandler(async (req, res) => {
  const { name, mobile, email, subject, message } = req.body;
  await ContactMessage.create({ name, mobile, email, subject, message });
  res.status(201).json({
    success: true,
    message: "Thanks! We'll get back to you within 24 hours.",
  });
});
