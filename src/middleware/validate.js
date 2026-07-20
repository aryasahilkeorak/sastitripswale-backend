// ============================================================
//  express-validator result collector + reusable rule sets.
// ============================================================
import { validationResult, body, query } from 'express-validator';
import ApiError from '../utils/ApiError.js';

// Run after a chain of validators; throws 400 with the first message.
export function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array();
  const err = ApiError.badRequest(errors[0].msg);
  err.details = errors.map((e) => ({ field: e.path, msg: e.msg }));
  next(err);
}

// --- Reusable rule sets ---
export const registerRules = [
  // Full name is now collected during profile completion, not at signup.
  body('fullName').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('mobile').trim().matches(/^[0-9]{10,15}$/).withMessage('Valid mobile number required'),
  body('password')
    .isLength({ min: 6, max: 128 })
    .withMessage('Password must be at least 6 characters'),
  body('coTravelerPreference')
    .optional({ values: 'falsy' })
    .isIn(['male', 'female', 'both'])
    .withMessage('Choose who you want to travel with'),
  body('age').optional({ values: 'falsy' }).isInt({ min: 18, max: 100 }).withMessage('Age must be 18+'),
];

export const loginRules = [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password required'),
];

export const forgotRules = [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
];

export const resetRules = [
  body('token').notEmpty().withMessage('Reset token required'),
  body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
];

export const tripRules = [
  body('origin').trim().isLength({ min: 2, max: 200 }).withMessage('Starting point required'),
  body('destination').trim().isLength({ min: 2, max: 200 }).withMessage('Destination required'),
  body('viaStops').optional().isArray({ max: 6 }).withMessage('Up to 6 stops allowed'),
  body('viaStops.*').trim().isLength({ min: 1, max: 100 }).withMessage('Each stop must be 1-100 characters'),
  body('startDate').isISO8601().withMessage('Valid start date required'),
  body('endDate').isISO8601().withMessage('Valid end date required'),
  body('budgetPerHead').isFloat({ min: 0 }).withMessage('Budget must be a positive number'),
  body('totalSeats').isInt({ min: 1, max: 100 }).withMessage('Seats must be between 1 and 100'),
  body('totalSeats').custom((value, { req }) => {
    const couples = req.body.isCouplesMode === 'true' || req.body.isCouplesMode === true;
    if (couples) {
      const seats = Number(value);
      if (seats < 4 || seats % 2 !== 0) throw new Error('Couples mode needs an even number of seats (4 or more)');
      if (req.body.vehicleType !== 'Car') throw new Error('Couples mode requires vehicle type "Car" (4-seater or bigger)');
    }
    return true;
  }),
];

export const reviewRules = [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
  body('message').trim().isLength({ min: 3, max: 2000 }).withMessage('Review message required'),
];

export const contactRules = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name required'),
  body('message').trim().isLength({ min: 3, max: 2000 }).withMessage('Message required'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Valid email required'),
];

export const paginationRules = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 60 }).toInt(),
];

export { body, query };
